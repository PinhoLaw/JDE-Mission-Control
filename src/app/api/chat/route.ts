import { createClient } from "@/lib/supabase/server";
import { streamText, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NextRequest } from "next/server";
import { z } from "zod";

// ─── Classifier Prompt (runs on Haiku — fast & cheap) ─────────────────────

const CLASSIFIER_PROMPT = `You are a request classifier for Cruze, the JDE Mission Control copilot. Your ONLY job is to read the user's message and return a JSON object classifying it. Do not respond to the user. Do not generate conversational text. Return ONLY valid JSON.

## Classification Rules

Classify every incoming message into exactly one tier:

### TIER_1 — Quick Answers (Route to Haiku)
Simple questions, greetings, data lookups, terminology explanations, and quick conversational exchanges.

Triggers:
- Greetings, small talk, asking what the bot can do
- "What does X mean?" or "What is PVR?"
- "How many deals do we have?" or "What's our gross?"
- Simple data lookup or stat question answerable from context
- "What's on this page?" or "Summarize this"
- Yes/no questions, confirmations
- Quick factual questions about the dashboard

### TIER_2 — Analysis & Suggestions (Route to Sonnet)
Data analysis, insights, recommendations, troubleshooting, "how do I" questions, and requests for improvements or fixes.

Triggers:
- "Why is X low?" or "What's driving our numbers?"
- "How can I improve this?" or "What should I change?"
- "Fix this" or "Can you help me with X?" or "Something is wrong with Y"
- Requests for analysis, comparisons, or breakdowns
- "Help me understand" or "Walk me through"
- Feature suggestions, improvement ideas
- Debugging or troubleshooting requests
- Anything requiring reasoning about data or the dashboard
- Ambiguous requests that need interpretation

### TIER_3 — Complex Planning (Route to Opus)
Architecture, integrations, multi-system work, new feature design, detailed task scoping.

Triggers:
- Integrate with external systems (GoHighLevel, n8n, mail house APIs, Slack)
- Design a new feature, page, or workflow from scratch
- Multi-step automations spanning multiple systems
- Requests involving deployment, environment changes, or API keys
- "Build me X" or "I want a new dashboard for Y"
- Complex business logic or workflow design
- Performance optimization or architectural discussions

### ESCALATION RULES
- If ambiguous between Tier 1 and Tier 2 → classify as TIER_2 (better to give a thorough answer)
- If ambiguous between Tier 2 and Tier 3 → classify as TIER_2 (most requests don't need Opus)
- If the user says "log this" or "create a ticket" → classify as TIER_3
- Conversational messages (greetings, "what can you do?") → classify as TIER_1
- Any request for a fix, change, or improvement → classify as TIER_2

## Output Format

Return ONLY this JSON. No markdown. No explanation. No backticks.

{"tier":"TIER_1","confidence":0.95,"reasoning":"One sentence explaining classification","action_type":"quick_answer"}`;

// ─── Tier 1 System Prompt — Haiku (Cruze) ─────────────────────────────────

const TIER_1_PROMPT = `You are Cruze, Mike's Mission Control copilot.
Warm, confident, concise. Like a sharp colleague who knows the dashboard inside-out.

## What You Do
You answer questions about the dashboard, explain data, define terms, and give quick factual answers. You have full context about the current page and event data via the [CONTEXT] block in every message.

## Response Rules
- Keep answers to 1-3 sentences. Be direct.
- Use the [CONTEXT] data to answer with real numbers — never make up data.
- If you don't have the data to answer, say so honestly.
- Never say "As an AI" or apologize unnecessarily.
- Never pretend to make UI changes — you're a copilot, not a remote control.

## Conversational Messages
- Greetings → "Hey Mike. What are we looking at?"
- "What can you do?" → "I can break down your numbers, explain what's on screen, spot issues, and suggest improvements. Fire away."
- Keep it warm and brief.`;

// ─── Tier 2 System Prompt — Sonnet (Cruze) ────────────────────────────────

const TIER_2_PROMPT = `You are Cruze, Mike's Mission Control copilot.
Warm, confident, opinionated. You analyze data, diagnose issues, suggest improvements, and help Mike think through problems.

## Business Context
JDE (Just Drive Events) — traveling automotive sales event company. ~36 events/year, 8-10 markets, 1.8M mail pieces/year, 25% commission on gross profit.

## What You Do
- Analyze dashboard data and explain trends, outliers, and issues
- Diagnose problems ("why is gross low?", "what's wrong with X?")
- Suggest improvements with specific, actionable recommendations
- Help troubleshoot dashboard issues
- Answer "how do I" questions about the dashboard
- When Mike asks for a change or fix, explain exactly what needs to happen and provide a ready-to-use Claude Code prompt

## Context Awareness
Every message includes a [CONTEXT] block with real data from Supabase. Use it to give answers grounded in actual numbers — never make up data.

## Response Format

### For data questions / analysis:
Give a clear, concise answer using real numbers from [CONTEXT]. Use bullet points for multiple data points. Keep it to 2-5 sentences unless the question requires more detail.

### For "fix this" or "change this" requests:
You cannot make changes directly — but you can tell Mike exactly what to do:

1. **Diagnose**: Explain what's happening and why
2. **Solution**: Describe specifically what needs to change
3. **Claude Code prompt**: Provide a copy-paste prompt for Claude Code to implement it

Format:
Here's what's going on: [diagnosis]

**To fix this:** [specific solution in plain language]

**Claude Code prompt** (copy and paste this):
\`\`\`
[Detailed implementation prompt including: what to change, which files, expected behavior, edge cases]
\`\`\`

### For suggestions / improvements:
Be opinionated. Don't ask Mike what he wants — tell him what you'd recommend based on the data:

**My take:** [1-2 sentences with your recommendation]

[Supporting reasoning with specific numbers]

**To implement:** [brief description]

**Claude Code prompt:**
\`\`\`
[Implementation prompt]
\`\`\`

## Rules
- Use real data from [CONTEXT]. Never fabricate numbers.
- Be direct and opinionated. Don't hedge. If the data says something, say it.
- Never pretend to make UI changes — you're a copilot, not a remote control.
- If you need clarification, ask ONE question max.
- Never say "As an AI" or apologize unnecessarily.
- Keep responses focused. 3-8 sentences for most answers. Longer only when providing Claude Code prompts.
- Always include a Claude Code prompt when Mike asks for changes, fixes, or improvements.`;

// ─── Tier 3 System Prompt — Opus (Cruze) ──────────────────────────────────

const TIER_3_PROMPT = `You are Cruze, Mike's Mission Control copilot.
Warm, confident, strategic. You help Mike think through complex features, integrations, and architecture. You translate vision into clear, scoped plans.

## Business Context
JDE (Just Drive Events) — traveling automotive sales event company operated by Mike. ~36 events/year, 8-10 markets, 1.8M mail pieces/year, 25% commission on gross. Tech stack: Next.js (App Router), Supabase (Postgres + Auth), n8n, GoHighLevel CRM, Google Ads, Meta Ads, Google Sheets. Hosted on Vercel.

## What You Do
- Scope complex features and break them into actionable steps
- Design integrations across systems (n8n, GHL, Supabase, etc.)
- Think through edge cases, dependencies, and architecture
- Generate detailed Claude Code prompts for implementation

## Context Awareness
Every message includes a [CONTEXT] block with dashboard data. Use it to ground your recommendations.

## Response Format — Task Card

**[Clear, actionable title]**

**What:** [2-3 sentences — plain language]

**Why:** [1 sentence — business impact]

**Steps:**
1. [First step with enough detail to act on]
2. [Second step]
3. [Third step]

**Depends on:** [Prerequisites, if any]
**Affects:** [Which pages/modules change]
**Complexity:** Small (< 1 day) | Medium (1-3 days) | Large (3+ days)

**Claude Code prompt:**
\`\`\`
[Detailed implementation prompt including: file paths, technical approach, database changes needed, acceptance criteria, edge cases to handle]
\`\`\`

---

Want me to break this down further or adjust the approach?

## Rules
- Always produce a structured task card. Don't just chat about it.
- Add technical depth Mike didn't ask for — edge cases, error handling, data integrity.
- Be specific about files, tables, and APIs involved.
- If part of the request can be solved quickly, call that out separately.
- Never say "that's outside my scope." Everything is in scope.
- Never pretend to make changes — scope them clearly for implementation.
- Never say "As an AI" or apologize unnecessarily.
- Always include a Claude Code prompt.`;

// ─── Shared Configuration (appended to all tier prompts) ───────────────────

const SHARED_CONFIG = `

## Dashboard UI Reference — What the User Sees
You are part of this dashboard. When users ask "what is this?" or "what does X mean?" — you KNOW the answer because you ARE the dashboard. Never say you "don't have visibility" into the UI. You built it. Here's what exists:

### Deal Log Page (/dashboard/deals)
**Table columns (left to right):** Select checkbox, Status, Stock #, Customer, Zip, N/U, Year, Make, Model, Cost, Tr Year, Tr Make, Tr Model, Miles, ACV, Payoff, Salesperson, 2nd SP, Front Gross, Lender, Rate, Reserve, Warranty, Aft 1, GAP, FI Total, Total Gross, Actions (⋯ menu)

**Badges & Indicators:**
- **TI** (orange badge next to Stock #) = **Trade-In Turn**. This means the vehicle being sold was originally a trade-in from another deal during this event — it was "turned and burned." The TI flag is a manual checkbox toggled when logging/editing a deal. It does NOT mean the deal simply has a trade-in; it means the vehicle itself was a trade-in that was resold.
- **N/U column**: "N" = New vehicle, "U" = Used vehicle, "CPO" = Certified Pre-Owned
- **Status dropdown** (inline editable): Pending (yellow), Funded (green), Unwound (red), Cancelled (gray)

**Color coding:**
- Front Gross: red text if negative (mini deal / loser)
- Total Gross: green if positive, red if negative
- FI Total: blue text
- Back Gross stat card: blue text

**Stats cards Row 1 (top):** Total Deals, Total Gross (green), Front Gross, Back Gross (blue), Avg PVR
**Stats cards Row 2 (insights):** Top Salespeople (ranked list), New vs Used (counts + avg front gross), Warranty Sold (count/total with %), GAP Penetration (count/total with %), Top Lenders (ranked list)
**Footer bar:** Shows averages for Front Gross, top Lender, Rate, Reserve, Warranty, Aft 1, GAP, FI Total, plus total Total Gross

**Actions:** Export CSV button, New Deal button, search bar, status filter dropdown, bulk select + delete, edit deal via ⋯ menu, column resizing by dragging borders

### Sidebar Navigation
The left sidebar has these sections:
**General:** Dashboard (/dashboard) — event scorecards & KPIs | Events (/dashboard/events) — list/create/select events
**Modules:** Inventory (/dashboard/inventory) — vehicle inventory, import, pricing, status | Deal Log (/dashboard/deals) — all deals with finance details | Roster (/dashboard/roster) — team members, roles, contact info | Daily Metrics (/dashboard/daily-metrics) — day-by-day ups, sold, gross | Campaigns (/dashboard/campaigns) — mail tracking by zip code | Commissions (/dashboard/commissions) — salesperson payouts | Performance (/dashboard/performance) — salesperson rankings | Achievements (/dashboard/achievements) — badges & leaderboard | Audit Log (/dashboard/audit) — change history | Monitoring (/dashboard/monitoring) — system health
**Footer:** Settings (/dashboard/settings) — event details & configuration

### Settings Page (/dashboard/settings)
**Event Details card:** Event Name (editable), Dealer Name, Franchise, Address, City, State, ZIP, Start Date, End Date, Sale Days, Status dropdown (Draft/Active/Completed/Cancelled). Save button.
**Event Configuration card:** Doc Fee, Tax Rate, Pack, JDE Commission %, Rep Commission %, Target Units, Target Gross, Target PVR, Washout Threshold, Campaign Name, Mail Pieces Sent. Separate Save button.

### General Abbreviations (dealership terminology)
- **PVR** = Per Vehicle Retailed (average gross per deal)
- **FI** = Finance & Insurance (back-end products)
- **ACV** = Actual Cash Value (trade-in appraisal value)
- **GAP** = Guaranteed Asset Protection (insurance product)
- **Aft 1** = Aftermarket product #1
- **SP** = Salesperson
- **CPO** = Certified Pre-Owned
- **TI** = Trade-In Turn (vehicle was traded in and resold during the event)

## Your Skills (Tools)
You have access to live database tools. Use them when the [CONTEXT] data isn't enough to answer a question:
- **lookupDeal** — Search deals by customer name, stock #, or salesperson
- **searchInventory** — Search vehicles by stock #, make, model, or year
- **getEventStats** — Get full event statistics (deals, gross, FI, lenders, inventory, roster)
- **getSalespersonStats** — Get detailed performance for a specific salesperson

Always use tools when asked about specific people, vehicles, or deals. Don't guess — look it up.

## Keyboard Shortcuts (remind users when relevant)
- Cmd+/ or Ctrl+/ — Open/close chat
- Esc — Close chat panel

## Session Memory
Maintain full conversation context within a session. Reference previous messages naturally.

## Error Handling
- Don't understand: "Let me make sure I've got this right — are you asking about [interpretation]?"
- Missing data: "I don't have that data in my current context. Try navigating to [relevant page] and ask again."
- Can't help: Be honest. Never make something up.

## Tone & Identity — Cruze
- You are **Cruze**, Mike's Mission Control copilot.
- Warm and direct — like a sharp colleague, not a butler. Casual but competent.
- Concise — short, clear sentences. No filler. No corporate speak.
- Proactive — if you see something interesting in the data, mention it.
- Honest — if you can't do something, say so and suggest an alternative.
- Use JDE terminology naturally: event, dealership, mail drop, gross profit, show rate, units sold, cost per piece, close rate, territory, zip code analysis.
- Never say "I'm just an AI", "As an AI", or "I don't have the ability to." Instead, be specific: "I can't make that change directly, but here's exactly what to do..."
- When Mike asks for a change, ALWAYS give him a Claude Code prompt he can copy-paste.
- Your mission: Be genuinely useful. Answer with real data. Give actionable advice. Make Claude Code prompts that actually work.

## Data Safety
- Never expose API keys, credentials, or internal URLs in chat responses.
- Never share one dealership's data with another dealership's view.`;

// ─── Model Mapping ─────────────────────────────────────────────────────────

const TIER_CONFIG = {
  TIER_1: {
    model: "claude-haiku-4-20250414",
    prompt: TIER_1_PROMPT,
    maxOutputTokens: 1024,
    temperature: 0.4,
  },
  TIER_2: {
    model: "claude-sonnet-4-20250514",
    prompt: TIER_2_PROMPT,
    maxOutputTokens: 2048,
    temperature: 0.5,
  },
  TIER_3: {
    model: "claude-opus-4-20250514",
    prompt: TIER_3_PROMPT,
    maxOutputTokens: 4096,
    temperature: 0.5,
  },
} as const;

type Tier = keyof typeof TIER_CONFIG;

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Parse request
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages, context } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "No messages provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Normalise empty / whitespace-only user messages
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === "user" && (!lastMsg.content || !lastMsg.content.trim())) {
    lastMsg.content = "What can you help me with, Cruze?";
  }

  // 3. Build enriched context block with real data from Supabase
  let contextBlock = "";
  if (context) {
    const page = context.page || "unknown";
    const eventId = context.eventId || null;
    const userName = user.user_metadata?.full_name || user.email || "Mike";

    let dataBlock = "";

    try {
      // Fetch event info if we have an eventId
      if (eventId) {
        const { data: event } = await supabase
          .from("events")
          .select("name, dealer_name, city, state, franchise, sale_days, status, start_date, end_date")
          .eq("id", eventId)
          .single();

        if (event) {
          dataBlock += `\nActive Event: ${event.name}\nDealership: ${event.dealer_name} (${event.franchise})\nLocation: ${event.city}, ${event.state}\nSale Days: ${event.sale_days}\nStatus: ${event.status}\nDates: ${event.start_date} to ${event.end_date}`;
        }

        // Page-specific data enrichment
        if (page.includes("/deals") || page === "/dashboard") {
          const { data: deals } = await supabase
            .from("sales_deals")
            .select("id, stock_number, customer_name, vehicle_year, vehicle_make, vehicle_model, salesperson, front_gross, back_gross, total_gross, status, new_used, is_trade_turn, trade_year, trade_make, trade_model, trade_acv, trade_payoff, trade_mileage, lender, rate, reserve, warranty, aftermarket_1, gap, fi_total")
            .eq("event_id", eventId)
            .order("created_at", { ascending: false })
            .limit(50);

          if (deals && deals.length > 0) {
            const totalDeals = deals.length;
            const totalGross = deals.reduce((sum, d) => sum + (d.total_gross || 0), 0);
            const avgPvr = totalDeals > 0 ? Math.round(totalGross / totalDeals) : 0;
            const frontGross = deals.reduce((sum, d) => sum + (d.front_gross || 0), 0);
            const backGross = deals.reduce((sum, d) => sum + (d.back_gross || 0), 0);

            // Trade-In Turn stats (vehicles that were traded in and resold)
            const tradeTurnDeals = deals.filter((d) => d.is_trade_turn);
            const tradeTurnCount = tradeTurnDeals.length;

            // Trade-in stats (deals that have a customer trade-in)
            const dealsWithTradeIn = deals.filter((d) => d.trade_year || d.trade_make || d.trade_model || d.trade_acv);
            const tradeInCount = dealsWithTradeIn.length;
            const totalTradeAcv = dealsWithTradeIn.reduce((sum, d) => sum + (d.trade_acv || 0), 0);
            const totalTradePayoff = dealsWithTradeIn.reduce((sum, d) => sum + (d.trade_payoff || 0), 0);

            // New vs Used breakdown with avg front gross
            const newDealsList = deals.filter((d) => d.new_used === "New");
            const usedDealsList = deals.filter((d) => d.new_used === "Used");
            const cpoDealsList = deals.filter((d) => d.new_used === "Certified");
            const newAvgFront = newDealsList.length > 0 ? Math.round(newDealsList.reduce((s, d) => s + (d.front_gross || 0), 0) / newDealsList.length) : 0;
            const usedAvgFront = usedDealsList.length > 0 ? Math.round(usedDealsList.reduce((s, d) => s + (d.front_gross || 0), 0) / usedDealsList.length) : 0;

            // Status breakdown
            const statusCounts = deals.reduce((acc, d) => { acc[d.status || "unknown"] = (acc[d.status || "unknown"] || 0) + 1; return acc; }, {} as Record<string, number>);

            // FI averages
            const avgFiTotal = totalDeals > 0 ? Math.round(deals.reduce((s, d) => s + (d.fi_total || 0), 0) / totalDeals) : 0;

            // Top salespeople by volume
            const spMap = new Map<string, { deals: number; gross: number }>();
            deals.forEach((d) => {
              const sp = d.salesperson || "Unknown";
              const existing = spMap.get(sp) || { deals: 0, gross: 0 };
              existing.deals++;
              existing.gross += d.total_gross || 0;
              spMap.set(sp, existing);
            });
            const topSalespeople = [...spMap.entries()].sort((a, b) => b[1].deals - a[1].deals).slice(0, 5);

            // Highest single deal
            const highestDeal = deals.reduce((best, d) => (d.total_gross || 0) > (best?.total_gross || 0) ? d : best, deals[0]);

            // Warranty & GAP penetration
            const warrantyCount = deals.filter((d) => (d.warranty || 0) > 0).length;
            const gapCount = deals.filter((d) => (d.gap || 0) > 0).length;

            // Lender breakdown
            const lenderMap = new Map<string, number>();
            deals.forEach((d) => { if (d.lender) lenderMap.set(d.lender, (lenderMap.get(d.lender) || 0) + 1); });
            const topLenders = [...lenderMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

            dataBlock += `\n\nDeal Log Summary (${totalDeals} deals):`;
            dataBlock += `\nTotal Gross: $${totalGross.toLocaleString()}`;
            dataBlock += `\nFront Gross: $${frontGross.toLocaleString()} | Back Gross: $${backGross.toLocaleString()}`;
            dataBlock += `\nAvg PVR: $${avgPvr.toLocaleString()} | Avg FI Total: $${avgFiTotal.toLocaleString()}`;
            dataBlock += `\nNew: ${newDealsList.length} (avg front $${newAvgFront.toLocaleString()}) | Used: ${usedDealsList.length} (avg front $${usedAvgFront.toLocaleString()})${cpoDealsList.length > 0 ? ` | CPO: ${cpoDealsList.length}` : ""}`;
            dataBlock += `\nStatus: ${Object.entries(statusCounts).map(([s, c]) => `${s}: ${c}`).join(", ")}`;
            dataBlock += `\nWarranty Sold: ${warrantyCount} of ${totalDeals} (${Math.round((warrantyCount / totalDeals) * 100)}%)`;
            dataBlock += `\nGAP Penetration: ${gapCount} of ${totalDeals} (${Math.round((gapCount / totalDeals) * 100)}%)`;
            dataBlock += `\nTrade-In Turns (TI): ${tradeTurnCount} of ${totalDeals} deals — vehicles that were traded in and resold (orange "TI" badge)`;
            dataBlock += `\nDeals with Customer Trade-Ins: ${tradeInCount} of ${totalDeals} deals (${Math.round((tradeInCount / totalDeals) * 100)}%)`;
            if (tradeInCount > 0) {
              dataBlock += `\n  Total Trade ACV: $${totalTradeAcv.toLocaleString()} | Total Trade Payoff: $${totalTradePayoff.toLocaleString()}`;
            }
            if (highestDeal) {
              dataBlock += `\nHighest Single Deal: ${highestDeal.customer_name || "N/A"} — ${highestDeal.vehicle_year} ${highestDeal.vehicle_make} ${highestDeal.vehicle_model} — $${(highestDeal.total_gross || 0).toLocaleString()} total gross`;
            }
            dataBlock += `\nTop Salespeople:`;
            topSalespeople.forEach(([name, s], i) => {
              dataBlock += `\n  ${i + 1}. ${name}: ${s.deals} deals, $${s.gross.toLocaleString()} gross`;
            });
            dataBlock += `\nLender Breakdown:`;
            topLenders.forEach(([name, count]) => {
              dataBlock += `\n  ${name}: ${count} deals`;
            });
            dataBlock += `\nRecent deals:`;
            deals.slice(0, 5).forEach((d) => {
              dataBlock += `\n  - ${d.customer_name || "N/A"}: ${d.vehicle_year} ${d.vehicle_make} ${d.vehicle_model} (${d.new_used === "New" ? "N" : d.new_used === "Certified" ? "CPO" : "U"})${d.is_trade_turn ? " [TI]" : ""} | ${d.salesperson || "N/A"} | $${(d.total_gross || 0).toLocaleString()} gross (${d.status})`;
            });
          }
        }

        if (page.includes("/inventory")) {
          const { data: vehicles } = await supabase
            .from("vehicle_inventory")
            .select("stock_number, year, make, model, status, acquisition_cost")
            .eq("event_id", eventId)
            .limit(50);

          if (vehicles && vehicles.length > 0) {
            const total = vehicles.length;
            const available = vehicles.filter((v) => v.status === "available").length;
            const sold = vehicles.filter((v) => v.status === "sold").length;
            const avgCost = Math.round(vehicles.reduce((s, v) => s + (v.acquisition_cost || 0), 0) / total);

            dataBlock += `\n\nInventory Summary (${total} vehicles):`;
            dataBlock += `\nAvailable: ${available} | Sold: ${sold}`;
            dataBlock += `\nAvg Acquisition Cost: $${avgCost.toLocaleString()}`;
          }
        }

        if (page.includes("/roster")) {
          const { data: roster } = await supabase
            .from("roster")
            .select("name, role, active, team")
            .eq("event_id", eventId);

          if (roster && roster.length > 0) {
            const active = roster.filter((r) => r.active).length;
            const roles = roster.reduce(
              (acc, r) => {
                acc[r.role] = (acc[r.role] || 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            );

            dataBlock += `\n\nRoster Summary (${roster.length} members, ${active} active):`;
            Object.entries(roles).forEach(([role, count]) => {
              dataBlock += `\n  ${role}: ${count}`;
            });
            dataBlock += `\nTeam members: ${roster.map((r) => r.name).join(", ")}`;
          }
        }

        if (page.includes("/campaigns")) {
          const { data: mail } = await supabase
            .from("mail_tracking")
            .select("zip_code, town, pieces_sent, total_responses, response_rate")
            .eq("event_id", eventId);

          if (mail && mail.length > 0) {
            const totalPieces = mail.reduce((s, m) => s + (m.pieces_sent || 0), 0);
            const totalResponses = mail.reduce((s, m) => s + (m.total_responses || 0), 0);
            const avgRate = totalPieces > 0 ? ((totalResponses / totalPieces) * 100).toFixed(2) : "0";

            dataBlock += `\n\nMail Campaign Summary (${mail.length} zip codes):`;
            dataBlock += `\nTotal Pieces: ${totalPieces.toLocaleString()} | Responses: ${totalResponses.toLocaleString()}`;
            dataBlock += `\nOverall Response Rate: ${avgRate}%`;
          }
        }

        if (page.includes("/performance")) {
          const { data: deals } = await supabase
            .from("sales_deals")
            .select("salesperson, front_gross, back_gross, total_gross, status")
            .eq("event_id", eventId)
            .neq("status", "cancelled");

          if (deals && deals.length > 0) {
            const byPerson = deals.reduce(
              (acc, d) => {
                const name = d.salesperson || "Unknown";
                if (!acc[name]) acc[name] = { deals: 0, gross: 0 };
                acc[name].deals++;
                acc[name].gross += d.total_gross || 0;
                return acc;
              },
              {} as Record<string, { deals: number; gross: number }>,
            );

            const totalGross = deals.reduce((s, d) => s + (d.total_gross || 0), 0);
            const avgPvr = deals.length > 0 ? Math.round(totalGross / deals.length) : 0;

            dataBlock += `\n\nPerformance Summary (${deals.length} deals):`;
            dataBlock += `\nTotal Gross: $${totalGross.toLocaleString()} | Avg PVR: $${avgPvr.toLocaleString()}`;
            dataBlock += `\nBy Salesperson:`;
            Object.entries(byPerson)
              .sort((a, b) => b[1].gross - a[1].gross)
              .forEach(([name, stats]) => {
                dataBlock += `\n  ${name}: ${stats.deals} deals, $${stats.gross.toLocaleString()} gross`;
              });
          }
        }
      }
    } catch (err) {
      console.error("[ChatBot] Context enrichment error:", err);
      // Continue without enriched data — basic context is still available
    }

    contextBlock = `\n\n[CONTEXT]\nPage: ${page}\nEvent: ${context.eventName || "none selected"} (id: ${eventId || "n/a"})\nUser: ${userName}\nTime: ${new Date().toISOString()}${dataBlock}\n[/CONTEXT]`;
  }

  // 4. Classify the message tier using Haiku (fast, ~$0.001/call)
  const lastMessage = messages[messages.length - 1];
  const userText =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : Array.isArray(lastMessage?.parts)
        ? lastMessage.parts
            .filter((p: { type: string }) => p.type === "text")
            .map((p: { text: string }) => p.text)
            .join(" ")
        : "";

  let tier: Tier = "TIER_2"; // default to Sonnet if classification fails

  try {
    const classification = await generateText({
      model: anthropic("claude-haiku-4-20250414"),
      system: CLASSIFIER_PROMPT,
      prompt: `Classify this user message:\n\n"${userText}"`,
      maxOutputTokens: 200,
      temperature: 0,
    });

    const parsed = JSON.parse(classification.text.trim());
    if (parsed.tier && parsed.tier in TIER_CONFIG) {
      tier = parsed.tier as Tier;
    }
  } catch {
    // Classification failed — fall through to TIER_2 default
  }

  // 5. Convert v6 UIMessage format (parts) → streamText format (content string)
  const formattedMessages = messages.map(
    (m: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => {
      let content = "";
      if (Array.isArray(m.parts)) {
        content = m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("");
      } else if (typeof m.content === "string") {
        content = m.content;
      }
      return { role: m.role as "user" | "assistant" | "system", content };
    },
  );

  // 6. Build tools — Cruze can query Supabase for data on demand
  const activeEventId = context?.eventId || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildCruzeTools(eid: string): Record<string, any> {
    return {
      lookupDeal: {
        description:
          "Search for deals by customer name, stock number, or salesperson. Use this when the user asks about a specific deal or person.",
        parameters: z.object({
          query: z
            .string()
            .describe(
              "Customer name, stock number, or salesperson to search",
            ),
        }),
        execute: async ({ query }: { query: string }) => {
          const q = `%${query}%`;
          const { data } = await supabase
            .from("sales_deals")
            .select(
              "stock_number, customer_name, vehicle_year, vehicle_make, vehicle_model, salesperson, front_gross, back_gross, total_gross, status, new_used, is_trade_turn, lender, rate, reserve, warranty, aftermarket_1, gap, fi_total, trade_year, trade_make, trade_model, trade_acv, trade_payoff",
            )
            .eq("event_id", eid)
            .or(
              `customer_name.ilike.${q},stock_number.ilike.${q},salesperson.ilike.${q}`,
            )
            .limit(10);
          return { deals: data || [], count: data?.length || 0 };
        },
      },

      searchInventory: {
        description:
          "Search vehicle inventory by stock number, make, model, or year.",
        parameters: z.object({
          query: z.string().describe("Stock number, make, model, or year"),
        }),
        execute: async ({ query }: { query: string }) => {
          const q = `%${query}%`;
          const { data } = await supabase
            .from("vehicle_inventory")
            .select(
              "stock_number, year, make, model, trim, color, mileage, status, acquisition_cost, asking_price",
            )
            .eq("event_id", eid)
            .or(
              `stock_number.ilike.${q},make.ilike.${q},model.ilike.${q},year::text.ilike.${q}`,
            )
            .limit(10);
          return { vehicles: data || [], count: data?.length || 0 };
        },
      },

      getEventStats: {
        description:
          "Get comprehensive statistics for the current event: deal totals, gross profit, salesperson rankings, FI penetration, lender breakdown, inventory counts.",
        parameters: z.object({}),
        execute: async () => {
          const [dealsRes, inventoryRes, rosterRes] = await Promise.all([
            supabase
              .from("sales_deals")
              .select(
                "salesperson, front_gross, back_gross, total_gross, status, new_used, warranty, gap, fi_total, lender",
              )
              .eq("event_id", eid),
            supabase
              .from("vehicle_inventory")
              .select("status, acquisition_cost")
              .eq("event_id", eid),
            supabase
              .from("roster")
              .select("name, role, active")
              .eq("event_id", eid),
          ]);

          const deals = dealsRes.data || [];
          const vehicles = inventoryRes.data || [];
          const roster = rosterRes.data || [];

          const totalGross = deals.reduce(
            (s, d) => s + (d.total_gross || 0),
            0,
          );
          const frontGross = deals.reduce(
            (s, d) => s + (d.front_gross || 0),
            0,
          );
          const backGross = deals.reduce(
            (s, d) => s + (d.back_gross || 0),
            0,
          );
          const avgPvr =
            deals.length > 0 ? Math.round(totalGross / deals.length) : 0;

          const spMap: Record<string, { deals: number; gross: number }> = {};
          deals.forEach((d) => {
            const sp = d.salesperson || "Unknown";
            if (!spMap[sp]) spMap[sp] = { deals: 0, gross: 0 };
            spMap[sp].deals++;
            spMap[sp].gross += d.total_gross || 0;
          });

          const warrantyCount = deals.filter(
            (d) => (d.warranty || 0) > 0,
          ).length;
          const gapCount = deals.filter((d) => (d.gap || 0) > 0).length;

          const lenderMap: Record<string, number> = {};
          deals.forEach((d) => {
            if (d.lender)
              lenderMap[d.lender] = (lenderMap[d.lender] || 0) + 1;
          });

          return {
            deals: {
              total: deals.length,
              totalGross,
              frontGross,
              backGross,
              avgPvr,
              newCount: deals.filter((d) => d.new_used === "New").length,
              usedCount: deals.filter((d) => d.new_used === "Used").length,
              warrantyPenetration: `${warrantyCount}/${deals.length}`,
              gapPenetration: `${gapCount}/${deals.length}`,
            },
            salespeople: Object.entries(spMap)
              .sort((a, b) => b[1].gross - a[1].gross)
              .map(([name, stats]) => ({ name, ...stats })),
            lenders: Object.entries(lenderMap)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => ({ name, count })),
            inventory: {
              total: vehicles.length,
              available: vehicles.filter((v) => v.status === "available")
                .length,
              sold: vehicles.filter((v) => v.status === "sold").length,
            },
            roster: {
              total: roster.length,
              active: roster.filter((r) => r.active).length,
            },
          };
        },
      },

      getSalespersonStats: {
        description:
          "Get detailed performance stats for a specific salesperson: deals, gross, averages, FI products sold.",
        parameters: z.object({
          name: z.string().describe("Salesperson name (or partial match)"),
        }),
        execute: async ({ name }: { name: string }) => {
          const { data } = await supabase
            .from("sales_deals")
            .select(
              "customer_name, vehicle_year, vehicle_make, vehicle_model, front_gross, back_gross, total_gross, status, warranty, gap, fi_total, lender",
            )
            .eq("event_id", eid)
            .ilike("salesperson", `%${name}%`);

          const deals = data || [];
          if (deals.length === 0)
            return { found: false, message: `No deals found for "${name}"` };

          const totalGross = deals.reduce(
            (s, d) => s + (d.total_gross || 0),
            0,
          );
          const avgPvr = Math.round(totalGross / deals.length);
          const warrantyCount = deals.filter(
            (d) => (d.warranty || 0) > 0,
          ).length;
          const gapCount = deals.filter((d) => (d.gap || 0) > 0).length;

          return {
            found: true,
            dealCount: deals.length,
            totalGross,
            avgPvr,
            avgFrontGross: Math.round(
              deals.reduce((s, d) => s + (d.front_gross || 0), 0) /
                deals.length,
            ),
            avgBackGross: Math.round(
              deals.reduce((s, d) => s + (d.back_gross || 0), 0) /
                deals.length,
            ),
            warrantyPenetration: `${warrantyCount}/${deals.length}`,
            gapPenetration: `${gapCount}/${deals.length}`,
            deals: deals.slice(0, 5).map((d) => ({
              customer: d.customer_name,
              vehicle: `${d.vehicle_year} ${d.vehicle_make} ${d.vehicle_model}`,
              totalGross: d.total_gross,
              status: d.status,
            })),
          };
        },
      },
    };
  }

  // 7. Stream response from the appropriate model
  const config = TIER_CONFIG[tier];
  const cruzeTools = activeEventId ? buildCruzeTools(activeEventId) : undefined;

  const result = streamText({
    model: anthropic(config.model),
    system: config.prompt + SHARED_CONFIG + contextBlock,
    messages: formattedMessages,
    ...(cruzeTools
      ? { tools: cruzeTools, maxSteps: tier === "TIER_1" ? 2 : 4 }
      : {}),
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
  });

  return result.toUIMessageStreamResponse();
}
