import { createClient } from "@/lib/supabase/server";
import { streamText, generateText, jsonSchema, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

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

### TIER_2 — Analysis, Suggestions & Mutations (Route to Sonnet)
Data analysis, insights, recommendations, troubleshooting, "how do I" questions, requests for improvements or fixes, AND any request to change/update/edit data.

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
- **ANY request to change, update, edit, set, mark, or modify data** — "mark this deal funded", "change doc fee to 500", "update the lender", "set target units to 80", "add a note to stock #1234"
- **Data entry / logging** — "Day 3: 22 ups, 9 sold, $45k gross", "log today's numbers", entering daily metrics or ups/sold/gross data

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
- **ANY data mutation or data entry request** (mark, change, update, set, edit, add, delete, log, enter, record) → **ALWAYS TIER_2** (never TIER_1)

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
- You can look up data but cannot make changes at this tier. If the user wants to change, update, or edit data, tell them: "I can do that — just ask again and I'll make the change for you." (The system will route their next message to a tier that has write tools.)

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
- **Make changes when asked** — update deal statuses, edit event config, modify inventory, enter daily metrics, and edit deal fields

## Context Awareness
Every message includes a [CONTEXT] block with real data from Supabase. Use it to give answers grounded in actual numbers — never make up data.

## Making Changes (Write Tools)
You have write tools that can directly modify data. When Mike asks you to change something:

1. **Look up first** — Use lookupDeal or searchInventory to find the record before modifying it. Never guess at IDs.
2. **Confirm destructive changes** — If the change could lose data (unwinding a deal, cancelling, bulk status changes), confirm with Mike before executing.
3. **Just do it for simple changes** — For clear, safe requests like "mark this deal funded", "set doc fee to 500", or "add a note to stock #1234", proceed directly. Don't ask for confirmation on obvious requests.
4. **Report what you did** — After making a change, tell Mike exactly what changed. The dashboard will refresh automatically.

## Response Format

### For data questions / analysis:
Give a clear, concise answer using real numbers from [CONTEXT]. Use bullet points for multiple data points. Keep it to 2-5 sentences unless the question requires more detail.

### For change requests:
Use your write tools to make the change directly. Then confirm:
"Done — [what changed]. The dashboard will update automatically."

### For suggestions / improvements:
Be opinionated. Don't ask Mike what he wants — tell him what you'd recommend based on the data:

**My take:** [1-2 sentences with your recommendation]

[Supporting reasoning with specific numbers]

Want me to make this change?

## Rules
- Use real data from [CONTEXT]. Never fabricate numbers.
- Be direct and opinionated. Don't hedge. If the data says something, say it.
- **You CAN make changes.** Use your write tools when asked. Don't tell Mike to do it himself.
- If you need clarification, ask ONE question max.
- Never say "As an AI" or apologize unnecessarily.
- Keep responses focused. 3-8 sentences for most answers.`;

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
- **You CAN make data changes.** Use your write tools when asked. Don't tell Mike to do it himself or generate a Claude Code prompt for simple data changes.
- Never say "As an AI" or apologize unnecessarily.
- For complex feature requests, include a Claude Code prompt. For simple data changes, just use your write tools.`;

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
**Event Configuration card:** Doc Fee, Tax Rate, Pack — New ($), Pack — Used ($), "Include Doc Fee in Salesperson Commission" toggle, JDE Commission %, Rep Commission %, Target Units, Target Gross, Target PVR, Washout Threshold, Campaign Name, Mail Pieces Sent. Separate Save button.

### Pack & Doc Fee Commission (new)
- **Pack** is a fixed cost added to the vehicle cost, deducted from front gross. It's split by New vs Used — each can have a different dollar amount. Pack is set per-event in Settings.
- **Doc Fee in Commission toggle** — when OFF (default), salesperson commission = front gross × rate. When ON, commission = (front gross + doc fee) × rate. This is a per-event setting in the Event Configuration card.
- Front gross on deal forms now shows the pack deduction: "Pack: −$1,200" below the front gross number.
- The Commissions page and Recap P&L both respect these settings.

### General Abbreviations (dealership terminology)
- **PVR** = Per Vehicle Retailed (average gross per deal)
- **FI** = Finance & Insurance (back-end products)
- **ACV** = Actual Cash Value (trade-in appraisal value)
- **GAP** = Guaranteed Asset Protection (insurance product)
- **Aft 1** = Aftermarket product #1
- **SP** = Salesperson
- **CPO** = Certified Pre-Owned
- **TI** = Trade-In Turn (vehicle was traded in and resold during the event)
- **Pack** = Dealer pack — fixed cost added to vehicle cost, deducted from front gross. Split into New and Used amounts.

## Your Skills (Tools)

### Read Tools (all tiers)
- **lookupDeal** — Search deals by customer name, stock #, or salesperson
- **searchInventory** — Search vehicles by stock #, make, model, or year
- **getEventStats** — Get full event statistics (deals, gross, FI, lenders, inventory, roster)
- **getSalespersonStats** — Get detailed performance for a specific salesperson

### Write Tools (Tier 2 & 3 only)
- **updateDealStatus** — Change a deal's status (pending/funded/unwound/cancelled). Automatically syncs inventory (funded→vehicle marked sold, unwound→vehicle restored to available).
- **updateEventConfig** — Edit event settings: doc fee, pack (new/used), commission %, targets, etc.
- **updateVehicleField** — Edit a single field on a vehicle (notes, status, asking price, color, etc.)
- **updateVehicleStatus** — Batch-change vehicle status (available/sold/hold/removed)
- **upsertDailyMetric** — Enter or update daily metrics (sale day, ups, sold, gross)
- **updateDealField** — Edit a single field on a deal (lender, rate, salesperson, front gross, etc.)

### Write Tool Rules
1. **Look up first** — Always use lookupDeal or searchInventory to find the record ID before calling a write tool. Never guess IDs.
2. **Confirm destructive changes** — Unwinding deals, cancelling deals, or removing vehicles: confirm with Mike before executing.
3. **Just do it for safe changes** — Marking funded, updating doc fee, adding notes, changing lender: proceed directly.
4. **Report results** — After a write, tell Mike what changed. The UI refreshes automatically via revalidatePath.

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
- Never say "I'm just an AI", "As an AI", or "I don't have the ability to."
- When Mike asks for a data change, **use your write tools to make it happen**. Don't generate Claude Code prompts for simple data edits.
- For complex feature requests (new pages, integrations, UI changes), provide a Claude Code prompt.
- Your mission: Be genuinely useful. Answer with real data. Make changes when asked. Give actionable advice.

## Data Safety
- Never expose API keys, credentials, or internal URLs in chat responses.
- Never share one dealership's data with another dealership's view.`;

// ─── Model Mapping ─────────────────────────────────────────────────────────

const TIER_CONFIG = {
  TIER_1: {
    model: "claude-haiku-4-5-20251001",
    prompt: TIER_1_PROMPT,
    maxOutputTokens: 1024,
    temperature: 0.4,
  },
  TIER_2: {
    model: "claude-sonnet-4-6",
    prompt: TIER_2_PROMPT,
    maxOutputTokens: 2048,
    temperature: 0.5,
  },
  TIER_3: {
    model: "claude-opus-4-6",
    prompt: TIER_3_PROMPT,
    maxOutputTokens: 4096,
    temperature: 0.5,
  },
} as const;

type Tier = keyof typeof TIER_CONFIG;

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
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

  // Normalise empty / whitespace-only user messages (handles v6 parts format too)
  const lastMsg = messages[messages.length - 1];
  const lastMsgText = typeof lastMsg?.content === "string"
    ? lastMsg.content
    : Array.isArray(lastMsg?.parts)
      ? lastMsg.parts.filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("")
      : "";
  if (lastMsg && lastMsg.role === "user" && !lastMsgText.trim()) {
    if (typeof lastMsg.content === "string") lastMsg.content = "What can you help me with, Cruze?";
    else if (Array.isArray(lastMsg.parts)) lastMsg.parts = [{ type: "text", text: "What can you help me with, Cruze?" }];
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

        // Fetch event config for financial settings context
        // Try full column set first, fall back to safe columns if migration hasn't run
        let eventCfg: Record<string, unknown> | null = null;
        try {
          const { data, error: cfgErr } = await supabase
            .from("event_config")
            .select("doc_fee, pack_new, pack_used, pack, include_doc_fee_in_commission, rep_commission_pct, jde_commission_pct, target_units, target_gross")
            .eq("event_id", eventId)
            .maybeSingle();
          if (cfgErr) {
            // Columns may not exist yet — fall back to safe columns
            console.warn("[ChatBot] event_config full query failed, trying safe columns:", cfgErr.message);
            const { data: safeData } = await supabase
              .from("event_config")
              .select("doc_fee, pack, rep_commission_pct, jde_commission_pct, target_units, target_gross")
              .eq("event_id", eventId)
              .maybeSingle();
            eventCfg = safeData as Record<string, unknown> | null;
          } else {
            eventCfg = data as Record<string, unknown> | null;
          }
        } catch (cfgError) {
          console.warn("[ChatBot] event_config query error:", cfgError);
        }

        if (eventCfg) {
          const packNew = (eventCfg.pack_new as number) ?? (eventCfg.pack as number) ?? 0;
          const packUsed = (eventCfg.pack_used as number) ?? (eventCfg.pack as number) ?? 0;
          dataBlock += `\n\nEvent Config:`;
          dataBlock += `\nDoc Fee: $${(eventCfg.doc_fee as number) ?? 0}`;
          dataBlock += `\nPack — New: $${packNew} | Pack — Used: $${packUsed}`;
          dataBlock += `\nDoc Fee in Commission: ${eventCfg.include_doc_fee_in_commission ? "ON (commission includes doc fee)" : "OFF (front gross only)"}`;
          if (eventCfg.rep_commission_pct != null) dataBlock += `\nDefault Rep Commission: ${(Number(eventCfg.rep_commission_pct) * 100).toFixed(0)}%`;
          if (eventCfg.jde_commission_pct != null) dataBlock += `\nJDE Commission: ${(Number(eventCfg.jde_commission_pct) * 100).toFixed(0)}%`;
          if (eventCfg.target_units) dataBlock += `\nTarget Units: ${eventCfg.target_units}`;
          if (eventCfg.target_gross) dataBlock += `\nTarget Gross: $${Number(eventCfg.target_gross).toLocaleString()}`;
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
    // Race classifier against a timeout — never let classification block the response
    const classifyPromise = generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: CLASSIFIER_PROMPT,
      prompt: `Classify this user message:\n\n"${userText}"`,
      maxOutputTokens: 200,
      temperature: 0,
    });

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    const classification = await Promise.race([classifyPromise, timeoutPromise]);

    if (classification && "text" in classification) {
      const parsed = JSON.parse(classification.text.trim());
      if (parsed.tier && parsed.tier in TIER_CONFIG) {
        tier = parsed.tier as Tier;
      }
    } else {
      console.warn("[ChatBot] Classifier timed out after 5s, defaulting to TIER_2");
    }
  } catch (classifyErr) {
    console.warn("[ChatBot] Classification failed, defaulting to TIER_2:", classifyErr);
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

  // 6. Build tools — Cruze can query and write to Supabase
  const activeEventId = context?.eventId || null;
  const userId = user.id;

  // ── Read Tools (all tiers) ────────────────────────────────────────────────
  function buildCruzeReadTools(eid: string) {
    return {
      lookupDeal: {
        description:
          "Search for deals by customer name, stock number, or salesperson. Returns deal IDs needed for write tools. Use this when the user asks about a specific deal or person.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Customer name, stock number, or salesperson to search" },
          },
          required: ["query"],
        }),
        execute: async ({ query }: { query: string }) => {
          const q = `%${query}%`;
          const { data } = await supabase
            .from("sales_deals")
            .select(
              "id, stock_number, customer_name, vehicle_year, vehicle_make, vehicle_model, salesperson, front_gross, back_gross, total_gross, status, new_used, is_trade_turn, lender, rate, reserve, warranty, aftermarket_1, gap, fi_total, trade_year, trade_make, trade_model, trade_acv, trade_payoff",
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
          "Search vehicle inventory by stock number, make, model, or year. Returns vehicle IDs needed for write tools.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            query: { type: "string", description: "Stock number, make, model, or year" },
          },
          required: ["query"],
        }),
        execute: async ({ query }: { query: string }) => {
          const q = `%${query}%`;
          const { data } = await supabase
            .from("vehicle_inventory")
            .select(
              "id, stock_number, year, make, model, trim, color, mileage, status, acquisition_cost, asking_price",
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
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {},
        }),
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
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Salesperson name (or partial match)" },
          },
          required: ["name"],
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

  // ── Write Tools (Tier 2 & 3 only) ────────────────────────────────────────
  const VALID_DEAL_STATUSES = ["pending", "funded", "unwound", "cancelled"];
  const EDITABLE_VEHICLE_FIELDS = [
    "hat_number", "stock_number", "vin", "year", "make", "model", "trim",
    "body_style", "color", "mileage", "age_days", "drivetrain",
    "acquisition_cost", "jd_trade_clean", "jd_retail_clean",
    "asking_price_115", "asking_price_120", "asking_price_125", "asking_price_130",
    "profit_115", "profit_120", "profit_125", "profit_130",
    "retail_spread", "sold_price", "sold_date", "sold_to",
    "status", "label", "notes", "photo_url",
  ];
  const VALID_VEHICLE_STATUSES = ["available", "sold", "hold", "removed"];
  const EDITABLE_DEAL_FIELDS = [
    "customer_name", "customer_zip", "customer_phone", "salesperson",
    "second_salesperson", "lender", "rate", "reserve", "warranty",
    "aftermarket_1", "gap", "fi_total", "front_gross", "selling_price",
    "new_used", "is_trade_turn", "notes",
  ];

  function buildCruzeWriteTools(eid: string) {
    return {
      updateDealStatus: {
        description:
          "Change a deal's status. Valid statuses: pending, funded, unwound, cancelled. Automatically syncs inventory (funded/pending → vehicle marked sold; unwound/cancelled → vehicle restored to available). Use lookupDeal first to get the dealId.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            dealId: { type: "string", description: "The deal UUID (get this from lookupDeal)" },
            status: { type: "string", enum: VALID_DEAL_STATUSES, description: "New status: pending, funded, unwound, or cancelled" },
          },
          required: ["dealId", "status"],
        }),
        execute: async ({ dealId, status }: { dealId: string; status: string }) => {
          if (!VALID_DEAL_STATUSES.includes(status)) {
            return { success: false, error: `Invalid status "${status}". Must be: ${VALID_DEAL_STATUSES.join(", ")}` };
          }

          const typedStatus = status as "pending" | "funded" | "unwound" | "cancelled";

          // Update deal status
          const { error } = await supabase
            .from("sales_deals")
            .update({ status: typedStatus })
            .eq("id", dealId)
            .eq("event_id", eid);

          if (error) return { success: false, error: error.message };

          // Sync inventory based on status change
          const { data: deal } = await supabase
            .from("sales_deals")
            .select("vehicle_id, stock_number, customer_name, selling_price, sale_date")
            .eq("id", dealId)
            .single();

          if (deal) {
            if (status === "cancelled" || status === "unwound") {
              // Restore vehicle to available
              const inventoryUpdate = { status: "available" as const, sold_to: null, sold_price: null, sold_date: null };
              if (deal.vehicle_id) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("id", deal.vehicle_id).eq("event_id", eid);
              } else if (deal.stock_number) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("event_id", eid).ilike("stock_number", deal.stock_number);
              }
            } else if (status === "funded" || status === "pending") {
              // Mark vehicle as sold
              const inventoryUpdate = { status: "sold" as const, sold_to: deal.customer_name, sold_price: deal.selling_price, sold_date: deal.sale_date };
              if (deal.vehicle_id) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("id", deal.vehicle_id).eq("event_id", eid);
              } else if (deal.stock_number) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("event_id", eid).ilike("stock_number", deal.stock_number);
              }
            }
          }

          // Audit log
          await supabase.from("audit_logs").insert({
            event_id: eid,
            user_id: userId,
            action: "update_deal_status",
            entity_type: "deal",
            entity_id: dealId,
            new_values: { status, via: "cruze" },
          }).then(() => {}, () => {});

          revalidatePath("/dashboard/deals");
          revalidatePath("/dashboard/inventory");
          revalidatePath("/dashboard");

          return { success: true, message: `Deal status changed to "${status}". Inventory synced.` };
        },
      },

      updateEventConfig: {
        description:
          "Edit event configuration settings. Can update: doc_fee, pack_new, pack_used, include_doc_fee_in_commission, jde_commission_pct, rep_commission_pct, target_units, target_gross, target_pvr, washout_threshold, tax_rate, mail_campaign_name, mail_pieces_sent. Only pass the fields you want to change.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            doc_fee: { type: "number", description: "Doc fee amount in dollars" },
            tax_rate: { type: "number", description: "Tax rate as decimal (e.g., 0.07 for 7%)" },
            pack_new: { type: "number", description: "Pack amount for new vehicles in dollars" },
            pack_used: { type: "number", description: "Pack amount for used vehicles in dollars" },
            include_doc_fee_in_commission: { type: "boolean", description: "Whether to include doc fee when calculating salesperson commission" },
            jde_commission_pct: { type: "number", description: "JDE commission percentage as decimal (e.g., 0.25 for 25%)" },
            rep_commission_pct: { type: "number", description: "Rep commission percentage as decimal (e.g., 0.25 for 25%)" },
            target_units: { type: "number", description: "Target number of units to sell" },
            target_gross: { type: "number", description: "Target total gross profit in dollars" },
            target_pvr: { type: "number", description: "Target PVR (per vehicle retailed) in dollars" },
            washout_threshold: { type: "number", description: "Washout threshold in dollars" },
            mail_campaign_name: { type: "string", description: "Mail campaign name" },
            mail_pieces_sent: { type: "number", description: "Number of mail pieces sent" },
          },
        }),
        execute: async (updates: Record<string, unknown>) => {
          // Filter to only allowed config fields
          const ALLOWED = new Set([
            "doc_fee", "tax_rate", "pack_new", "pack_used", "include_doc_fee_in_commission",
            "jde_commission_pct", "rep_commission_pct", "target_units", "target_gross",
            "target_pvr", "washout_threshold", "mail_campaign_name", "mail_pieces_sent",
          ]);
          const filtered: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(updates)) {
            if (ALLOWED.has(k) && v !== undefined) filtered[k] = v;
          }

          if (Object.keys(filtered).length === 0) {
            return { success: false, error: "No valid fields to update" };
          }

          // Upsert pattern: create config if it doesn't exist
          const { data: existing } = await supabase
            .from("event_config")
            .select("id")
            .eq("event_id", eid)
            .single();

          if (existing) {
            const { error } = await supabase.from("event_config").update(filtered).eq("event_id", eid);
            if (error) return { success: false, error: error.message };
          } else {
            const { error } = await supabase.from("event_config").insert({ event_id: eid, ...filtered });
            if (error) return { success: false, error: error.message };
          }

          // Audit log
          await supabase.from("audit_logs").insert({
            event_id: eid,
            user_id: userId,
            action: "update_event_config",
            entity_type: "event_config",
            entity_id: eid,
            new_values: { ...filtered, via: "cruze" },
          }).then(() => {}, () => {});

          revalidatePath("/dashboard/settings");
          revalidatePath("/dashboard");

          const summary = Object.entries(filtered).map(([k, v]) => `${k}: ${v}`).join(", ");
          return { success: true, message: `Event config updated: ${summary}` };
        },
      },

      updateVehicleField: {
        description:
          `Edit a single field on a vehicle. Allowed fields: ${EDITABLE_VEHICLE_FIELDS.join(", ")}. Use searchInventory first to get the vehicleId.`,
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            vehicleId: { type: "string", description: "The vehicle UUID (get from searchInventory)" },
            field: { type: "string", enum: EDITABLE_VEHICLE_FIELDS, description: "Field name to update" },
            value: { description: "New value for the field (string, number, or boolean depending on field)" },
          },
          required: ["vehicleId", "field", "value"],
        }),
        execute: async ({ vehicleId, field, value }: { vehicleId: string; field: string; value: unknown }) => {
          if (!EDITABLE_VEHICLE_FIELDS.includes(field)) {
            return { success: false, error: `Field "${field}" is not editable. Allowed: ${EDITABLE_VEHICLE_FIELDS.join(", ")}` };
          }

          const { error } = await supabase
            .from("vehicle_inventory")
            .update({ [field]: value })
            .eq("id", vehicleId)
            .eq("event_id", eid);

          if (error) return { success: false, error: error.message };

          await supabase.from("audit_logs").insert({
            event_id: eid,
            user_id: userId,
            action: "update_vehicle_field",
            entity_type: "vehicle",
            entity_id: vehicleId,
            new_values: { field, value, via: "cruze" },
          }).then(() => {}, () => {});

          revalidatePath("/dashboard/inventory");
          return { success: true, message: `Vehicle ${field} updated to "${value}".` };
        },
      },

      updateVehicleStatus: {
        description:
          "Change vehicle status (available, sold, hold, removed). Can update multiple vehicles at once. Use searchInventory first to get vehicleIds.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            vehicleIds: {
              type: "array",
              items: { type: "string" },
              description: "Array of vehicle UUIDs to update",
            },
            status: { type: "string", enum: VALID_VEHICLE_STATUSES, description: "New status: available, sold, hold, or removed" },
          },
          required: ["vehicleIds", "status"],
        }),
        execute: async ({ vehicleIds, status }: { vehicleIds: string[]; status: string }) => {
          if (!VALID_VEHICLE_STATUSES.includes(status)) {
            return { success: false, error: `Invalid status "${status}". Must be: ${VALID_VEHICLE_STATUSES.join(", ")}` };
          }

          const typedVehicleStatus = status as "available" | "sold" | "hold" | "pending";

          let updated = 0;
          for (const vid of vehicleIds) {
            const { error } = await supabase
              .from("vehicle_inventory")
              .update({ status: typedVehicleStatus })
              .eq("id", vid)
              .eq("event_id", eid);
            if (!error) updated++;
          }

          await supabase.from("audit_logs").insert({
            event_id: eid,
            user_id: userId,
            action: "update_vehicle_status",
            entity_type: "vehicle",
            entity_id: vehicleIds[0] || null,
            new_values: { status, count: vehicleIds.length, via: "cruze" },
          }).then(() => {}, () => {});

          revalidatePath("/dashboard/inventory");
          return { success: true, message: `${updated} of ${vehicleIds.length} vehicle(s) set to "${status}".` };
        },
      },

      upsertDailyMetric: {
        description:
          "Enter or update a daily metric row. Provide the sale day number and the metrics. If a row already exists for that sale day, it will be updated; otherwise a new row is created.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            sale_day: { type: "number", description: "Sale day number (1, 2, 3, ...)" },
            sale_date: { type: "string", description: "Date in YYYY-MM-DD format (optional)" },
            total_ups: { type: "number", description: "Total ups (customer visits) for the day" },
            total_sold: { type: "number", description: "Total units sold for the day" },
            total_gross: { type: "number", description: "Total gross profit for the day in dollars" },
            total_front: { type: "number", description: "Total front gross for the day in dollars (optional)" },
            total_back: { type: "number", description: "Total back gross for the day in dollars (optional)" },
            notes: { type: "string", description: "Notes for the day (optional)" },
          },
          required: ["sale_day", "total_ups", "total_sold"],
        }),
        execute: async (input: {
          sale_day: number; sale_date?: string; total_ups: number; total_sold: number;
          total_gross?: number; total_front?: number; total_back?: number; notes?: string;
        }) => {
          // Check if row exists for this sale day
          const { data: existing } = await supabase
            .from("daily_metrics")
            .select("id")
            .eq("event_id", eid)
            .eq("sale_day", input.sale_day)
            .maybeSingle();

          const row = {
            sale_day: input.sale_day,
            sale_date: input.sale_date ?? null,
            total_ups: input.total_ups,
            total_sold: input.total_sold,
            total_gross: input.total_gross ?? null,
            total_front: input.total_front ?? null,
            total_back: input.total_back ?? null,
            notes: input.notes ?? null,
            updated_at: new Date().toISOString(),
          };

          if (existing) {
            const { error } = await supabase.from("daily_metrics").update(row).eq("id", existing.id).eq("event_id", eid);
            if (error) return { success: false, error: error.message };
          } else {
            const { error } = await supabase.from("daily_metrics").insert({ event_id: eid, ...row });
            if (error) return { success: false, error: error.message };
          }

          await supabase.from("audit_logs").insert({
            event_id: eid,
            user_id: userId,
            action: "upsert_daily_metric",
            entity_type: "daily_metric",
            entity_id: eid,
            new_values: { sale_day: input.sale_day, via: "cruze" },
          }).then(() => {}, () => {});

          revalidatePath("/dashboard/daily-metrics");
          revalidatePath("/dashboard/performance");
          revalidatePath("/dashboard");

          return { success: true, message: `Day ${input.sale_day} metrics ${existing ? "updated" : "created"}: ${input.total_ups} ups, ${input.total_sold} sold${input.total_gross ? `, $${input.total_gross.toLocaleString()} gross` : ""}.` };
        },
      },

      updateDealField: {
        description:
          `Edit a single field on a deal. Allowed fields: ${EDITABLE_DEAL_FIELDS.join(", ")}. Use lookupDeal first to get the dealId.`,
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            dealId: { type: "string", description: "The deal UUID (get from lookupDeal)" },
            field: { type: "string", enum: EDITABLE_DEAL_FIELDS, description: "Field name to update" },
            value: { description: "New value for the field (string, number, or boolean depending on field)" },
          },
          required: ["dealId", "field", "value"],
        }),
        execute: async ({ dealId, field, value }: { dealId: string; field: string; value: unknown }) => {
          if (!EDITABLE_DEAL_FIELDS.includes(field)) {
            return { success: false, error: `Field "${field}" is not editable. Allowed: ${EDITABLE_DEAL_FIELDS.join(", ")}` };
          }

          const { error } = await supabase
            .from("sales_deals")
            .update({ [field]: value })
            .eq("id", dealId)
            .eq("event_id", eid);

          if (error) return { success: false, error: error.message };

          await supabase.from("audit_logs").insert({
            event_id: eid,
            user_id: userId,
            action: "update_deal_field",
            entity_type: "deal",
            entity_id: dealId,
            new_values: { field, value, via: "cruze" },
          }).then(() => {}, () => {});

          revalidatePath("/dashboard/deals");
          revalidatePath("/dashboard");

          return { success: true, message: `Deal ${field} updated to "${value}".` };
        },
      },
    };
  }

  // 7. Stream response from the appropriate model
  const config = TIER_CONFIG[tier];
  const readTools = activeEventId ? buildCruzeReadTools(activeEventId) : undefined;
  const writeTools = activeEventId ? buildCruzeWriteTools(activeEventId) : undefined;

  // TIER_1 gets read tools only; TIER_2 & TIER_3 get read + write tools
  const cruzeTools = readTools
    ? tier === "TIER_1"
      ? readTools
      : { ...readTools, ...writeTools }
    : undefined;

  try {
    const maxSteps = cruzeTools ? (tier === "TIER_1" ? 3 : 8) : 1;

    const result = streamText({
      model: anthropic(config.model),
      system: config.prompt + SHARED_CONFIG + contextBlock,
      messages: formattedMessages,
      tools: cruzeTools,
      stopWhen: stepCountIs(maxSteps),
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
    });

    return result.toUIMessageStreamResponse();
  } catch (streamErr) {
    console.error("[ChatBot] streamText / response error:", streamErr);
    return new Response(
      JSON.stringify({ error: "Cruze failed to generate a response. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  } catch (fatalErr) {
    // Outermost catch — nothing should reach here, but if it does, return a clean error
    console.error("[ChatBot] FATAL unhandled error:", fatalErr);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please refresh and try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
