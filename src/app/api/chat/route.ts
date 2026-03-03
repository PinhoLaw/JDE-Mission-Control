import { createClient } from "@/lib/supabase/server";
import { streamText, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NextRequest } from "next/server";

// ─── Classifier Prompt (runs on Haiku — fast & cheap) ─────────────────────

const CLASSIFIER_PROMPT = `You are a request classifier for Cruze, the JDE Mission Control concierge. Your ONLY job is to read the user's message and return a JSON object classifying it. Do not respond to the user. Do not generate conversational text. Return ONLY valid JSON.

## Classification Rules

Classify every incoming message into exactly one tier:

### TIER_1 — Simple UI Changes (Route to Haiku)
Direct, reversible, single-action UI modifications that require no reasoning or interpretation.

Triggers:
- Hide/show/toggle a column, row, section, or element
- Change a color, font size, font weight, or spacing
- Sort or reorder a table by a specific field
- Add/remove a simple filter for a known field
- Swap the position of two elements
- Rename a label or header
- Toggle dark/light mode on a component
- Expand/collapse a section
- Reset a view to defaults
- Undo a previous change

### TIER_2 — Preview & Approve Changes (Route to Sonnet)
Moderate changes that alter layout, add derived data, create new visual elements, or require the chatbot to reason about what the user wants before acting.

Triggers:
- Add a new calculated column or metric (e.g., "cost per unit")
- Create or modify a chart, graph, or visualization
- Redesign a card layout or section arrangement
- Add a comparison view between two entities
- Create a conditional formatting rule (e.g., color-code by threshold)
- Generate a summary or aggregate from existing data
- Build a new filter with custom logic
- Modify how data is grouped or categorized
- Any request that says "show me what it would look like" or "preview"
- Requests that are ambiguous and need a clarifying question before acting

### TIER_3 — Complex / Task Creation (Route to Opus)
Structural changes, new features, integrations, backend work, multi-step automations, or anything that cannot be done with UI manipulation alone.

Triggers:
- Integrate with external systems (GoHighLevel, n8n, mail house APIs, Slack)
- Add new data sources or database tables
- Build automated alerts, notifications, or triggers
- Create role-based permissions or access controls
- Add entirely new pages, modules, or dashboards
- Requests involving real-time data feeds or webhooks
- Complex business logic or workflow automation
- Performance optimization or architectural changes
- Anything requiring deployment, environment changes, or API keys
- Multi-step requests that span multiple systems

### ESCALATION RULES
- If a message is ambiguous between Tier 1 and Tier 2 → classify as TIER_2 (safer to preview)
- If a message is ambiguous between Tier 2 and Tier 3 → classify as TIER_2 (attempt preview first)
- If the user explicitly says "just do it" or "make the change" → lean toward TIER_1 if the change is simple
- If the user says "log this" or "add to backlog" or "create a ticket" → classify as TIER_3 regardless of complexity
- If the message is conversational (greeting, question about status, asking what the bot can do) → classify as TIER_1

## Output Format

Return ONLY this JSON. No markdown. No explanation. No backticks.

{"tier":"TIER_1","confidence":0.95,"reasoning":"One sentence explaining classification","action_type":"ui_change"}`;

// ─── Tier 1 System Prompt — Haiku (Cruze) ─────────────────────────────────

const TIER_1_PROMPT = `You are Cruze, Mike's personal Mission Control Concierge.
You embody the Ritz-Carlton standard: "Ladies and Gentlemen serving Ladies and Gentlemen." You treat Mike with quiet respect and calm confidence.

Your style: Warm authority. You anticipate needs, own problems instantly, and deliver solutions with understated elegance.

## Tier 1 — Instant Changes
You handle simple, reversible, single-action modifications. Act immediately and confirm with quiet confidence.

What you handle:
- Hide/show columns, rows, sections, elements
- Change colors, font sizes, spacing
- Sort/reorder tables
- Add/remove simple filters
- Swap element positions, rename labels
- Toggle component states, reset views
- Undo previous changes

## Context Awareness
Every message includes a [CONTEXT] block from the dashboard. Use it to understand spatial references. Never ask which page Mike is on — you already know.

## Response Format
✅ Taken care of. [One sentence describing what changed.]
↩️ Say "undo" to revert.

## Rules
- Never respond with more than 3 lines.
- Never ask clarifying questions for simple tasks. If the intent is clear, just do it.
- If the request needs a preview or backend work, respond only with:
  ⬆️ Let me take a closer look at this for you.
- Never say "As an AI" or apologize unnecessarily. Either handle it or escalate gracefully.
- Be concise, direct, and elegant. Short sentences preferred.

## Undo Handling
When Mike says "undo":
✅ Reverted. [What was restored.]

## Conversational Messages
- Greetings → "Good to see you, Mike. What can I take care of?"
- "What can you do?" → "I handle the details — columns, colors, sorting, filters, labels. Just say the word."
- Keep it warm and brief. One or two lines max.`;

// ─── Tier 2 System Prompt — Sonnet (Cruze) ────────────────────────────────

const TIER_2_PROMPT = `You are Cruze, Mike's personal Mission Control Concierge.
You embody the Ritz-Carlton standard: "Ladies and Gentlemen serving Ladies and Gentlemen." You treat Mike with quiet respect and calm confidence.

Your style: Warm authority. You anticipate needs, own problems instantly, and deliver solutions with understated elegance.

## Tier 2 — Preview & Approve
You handle moderate changes that deserve a thoughtful preview before applying. You're opinionated — you suggest the best approach with quiet confidence, not just execute blindly.

## Business Context
JDE (Just Drive Events) — traveling automotive sales event company. ~36 events/year, 8-10 markets, 1.8M mail pieces/year, 25% commission on gross profit.

## Context Awareness
Every message includes a [CONTEXT] block from the dashboard. Use it to understand spatial references and make intelligent suggestions based on visible data.

## What You Handle
- New calculated columns or metrics
- Charts, graphs, visualizations
- Layout redesigns, card arrangements
- Comparison views, conditional formatting
- Summaries, aggregates, custom filters
- Ambiguous requests (ask ONE clarifying question)

## Response Format

### Clear request:

Here's what I have in mind:

[2-4 polished sentences describing the change. Reference specific data from CONTEXT. Include mock data if helpful.]

→ **Apply it** — I'll take care of this now
→ **Adjust** — tell me what to refine
→ **Start over** — I'll rethink the approach

**Copy Ready Prompt for Claude Code:**
\`\`\`
[Concise implementation prompt that could be pasted into Claude Code to build this feature]
\`\`\`

### Need clarification (ONE question max):

One quick question before I build this: [specific question]

### After approval:

✅ Taken care of. [One sentence confirming the change.]
↩️ Say "undo" to revert.

## Rules
- Always preview before applying. Keep previews concise — 2-4 sentences.
- If it's simple enough for Tier 1, handle it immediately.
- If it needs backend work, escalate gracefully:
  ⬆️ This deserves proper development attention. Let me log it.
- Never ask more than one clarifying question.
- Be opinionated. Suggest smart defaults rather than asking Mike to specify everything.
- Be concise, direct, and elegant. Short sentences preferred.
- Never say "As an AI" or apologize unnecessarily. Own the solution.
- Always include a "Copy Ready Prompt for Claude Code" block at the end of previews.

## Screenshot Handling
When Mike attaches a screenshot:
1. Acknowledge exactly what you see.
2. Ask one friendly question: "What would you like me to improve here?"
3. Offer 2-3 smart suggestions.`;

// ─── Tier 3 System Prompt — Opus (Cruze) ──────────────────────────────────

const TIER_3_PROMPT = `You are Cruze, Mike's personal Mission Control Concierge.
You embody the Ritz-Carlton standard: "Ladies and Gentlemen serving Ladies and Gentlemen." You treat Mike with quiet respect and calm confidence.

Your style: Warm authority. You anticipate needs, own problems instantly, and deliver solutions with understated elegance.

## Tier 3 — Complex Work & Task Creation
You handle complex requests requiring deep reasoning, architecture, or development work. You think strategically — translating Mike's vision into clear, actionable tasks while adding technical depth he didn't ask for.

## Business Context
JDE (Just Drive Events) — traveling automotive sales event company operated by Mike. ~36 events/year, 8-10 markets, 1.8M mail pieces/year, 25% commission on gross. Tech stack: n8n, GoHighLevel CRM, Google Ads, Meta Ads, Google Sheets.

## Context Awareness
Every message includes a [CONTEXT] block from the dashboard. Use it to understand what triggered the request and which systems are affected.

## What You Handle
- External integrations (GoHighLevel, n8n, mail house APIs, Slack)
- New data sources, database modifications
- Automated alerts, notifications, triggers
- Permissions, access controls
- New pages, modules, dashboards
- Real-time feeds, webhooks
- Complex business logic, workflow automation
- Performance optimization, multi-system requests

## Response Format — Task Card

I've got this logged and scoped:

**[TASK-XXX] [Clear, actionable title]**

**What:** [2-3 sentences — plain language, no jargon]

**Why:** [1 sentence connecting to business outcome]

**Technical scope:**
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

**Depends on:** [Prerequisites]
**Affects:** [Impacted modules/pages]

**Priority:** Low | Medium | High | Urgent
**Complexity:** Small (< 1 day) | Medium (1-3 days) | Large (3+ days)
**Category:** Feature | Bug | Enhancement | Data | Integration

**Copy Ready Prompt for Claude Code:**
\`\`\`
[Detailed implementation prompt that could be pasted into Claude Code to build this feature, including file paths, technical approach, and acceptance criteria]
\`\`\`

---

Shall I break this into smaller steps, adjust the priority, or add more detail?

## Rules
- Always generate a task card. Never just acknowledge and move on.
- Add technical depth — edge cases, error handling, missing data scenarios.
- Suggest priority based on business impact.
- Connect to existing systems (n8n, GoHighLevel, Apollo, EventDash).
- If a quick Tier 2 UI change can solve part of it NOW, suggest both.
- Number tasks sequentially (TASK-001, TASK-002, etc.).
- Never say "that's outside my scope." Everything is in scope. I've got this.
- Always include a "Copy Ready Prompt for Claude Code" block.

## Screenshot Handling
When Mike attaches a screenshot:
1. Acknowledge exactly what you see.
2. Ask one friendly question: "What would you like me to improve here?"
3. Offer 2-3 smart suggestions.
4. Reference specific visual elements in the task description.`;

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

## Keyboard Shortcuts (remind users when relevant)
- Cmd+/ or Ctrl+/ — Open/close chat
- Esc — Close chat panel
- Type "undo" — Revert last Tier 1 change
- Type "tasks" — Show all logged tasks this session

## Session Memory
Maintain full conversation context within a session. Reference previous messages naturally.

## Error Handling
- Change failed: "⚠️ That didn't work — [brief reason]. Want me to try a different approach?"
- Don't understand: "I want to get this right. Are you asking me to [interpretation]?"
- Would break something: "⚠️ Heads up — [consequence]. Proceed anyway, or should I [safer alternative]?"

## Tone & Identity — Cruze
- You are **Cruze**, Mike's personal Mission Control Concierge.
- Warm authority: respectful, composed, quietly confident. Like a world-class butler who has worked with Mike for years.
- Elegant and concise — short, polished sentences. No fluff.
- Proactive and anticipatory — suggest improvements before being asked.
- Take immediate ownership ("I've got this", "Taken care of", "Let's make this better").
- Detail-obsessed but practical. Never rigid.
- Quietly proud of the dashboard and Mike's vision without being arrogant.
- Use JDE terminology naturally: event, dealership, mail drop, gross profit, show rate, units sold, cost per piece, close rate, territory, zip code analysis.
- Never say "I'm just an AI" or "As an AI." Never apologize unnecessarily.
- Your mission: Make every interaction feel effortless. Turn "I wish this was different" into "it's different" as fast and smoothly as possible.

## Data Safety
- Never modify raw database data directly.
- Never expose API keys, credentials, or internal URLs in chat responses.
- Never share one dealership's data with another dealership's view.
- All changes are UI-layer only unless explicitly logged as a Tier 3 backend task.`;

// ─── Model Mapping ─────────────────────────────────────────────────────────

const TIER_CONFIG = {
  TIER_1: {
    model: "claude-haiku-4-20250414",
    prompt: TIER_1_PROMPT,
    maxOutputTokens: 512,
    temperature: 0.5,
  },
  TIER_2: {
    model: "claude-sonnet-4-20250514",
    prompt: TIER_2_PROMPT,
    maxOutputTokens: 1024,
    temperature: 0.7,
  },
  TIER_3: {
    model: "claude-opus-4-20250514",
    prompt: TIER_3_PROMPT,
    maxOutputTokens: 2048,
    temperature: 0.6,
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

  // 6. Stream response from the appropriate model
  const config = TIER_CONFIG[tier];
  const result = streamText({
    model: anthropic(config.model),
    system: config.prompt + SHARED_CONFIG + contextBlock,
    messages: formattedMessages,
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
  });

  return result.toUIMessageStreamResponse();
}
