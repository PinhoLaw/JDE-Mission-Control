// CRUZE UPGRADE — OMNISCIENT MODE
// The living brain of JDE Mission Control
// Multi-tier AI with persistent memory, 15+ tools, file analysis

import { createClient } from "@/lib/supabase/server";
import { streamText, generateText, jsonSchema, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getOrCreateConversation,
  saveMessage,
  getRelevantMemories,
  getConversationHistory,
  formatMemoryBlock,
  saveMemory,
} from "@/lib/cruze/memory";
import { hasBackfillRun, backfillCruzeMemories } from "@/lib/cruze/backfill";

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
Data analysis, insights, recommendations, troubleshooting, "how do I" questions, requests for improvements or fixes, AND any request to change/update/edit data. File analysis. Reports. Forecasting.

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
- **File analysis** — "analyze this CSV", user drops a file, questions about uploaded files
- **Anomaly detection** — "anything weird?", "spot check", "flag issues"
- **Forecasting** — "predict", "forecast", "project", "where are we trending?"
- **Reports** — "generate a report", "recap", "summary report"

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
- **File uploads, anomaly detection, forecasting, reports** → **ALWAYS TIER_2**

## Output Format

Return ONLY this JSON. No markdown. No explanation. No backticks.

{"tier":"TIER_1","confidence":0.95,"reasoning":"One sentence explaining classification","action_type":"quick_answer"}`;

// ─── Tier 1 System Prompt — Haiku (Cruze) ─────────────────────────────────

const TIER_1_PROMPT = `You are Cruze, Mike's Mission Control copilot.
Warm, confident, concise. Like a sharp colleague who knows the dashboard inside-out.

## What You Do
You answer questions about the dashboard, explain data, define terms, and give quick factual answers. You have full context about the current page and event data via the [CONTEXT] block in every message. You also have [MEMORY] of past conversations.

## Response Rules
- Keep answers to 1-3 sentences. Be direct.
- Use the [CONTEXT] data to answer with real numbers — never make up data.
- Reference past conversations from [MEMORY] when relevant — show that you remember.
- If you don't have the data to answer, say so honestly.
- Never say "As an AI" or apologize unnecessarily.
- You can look up data but cannot make changes at this tier. If the user wants to change, update, or edit data, tell them: "I can do that — just ask again and I'll make the change for you." (The system will route their next message to a tier that has write tools.)

## Conversational Messages
- Greetings → "Hey Mike. What are we looking at?"
- "What can you do?" → "I can break down your numbers, explain what's on screen, spot issues, suggest improvements, analyze files you drop in, forecast trends, generate reports, and remember everything we talk about. Fire away."
- Keep it warm and brief.`;

// ─── Tier 2 System Prompt — Sonnet (Cruze) ────────────────────────────────

const TIER_2_PROMPT = `You are Cruze, Mike's Mission Control copilot.
Warm, confident, opinionated. You analyze data, diagnose issues, suggest improvements, detect anomalies, forecast trends, analyze files, and help Mike think through problems. You remember everything.

## Business Context
JDE (Just Drive Events) — traveling automotive sales event company. ~36 events/year, 8-10 markets, 1.8M mail pieces/year, 25% commission on gross profit.

## What You Do
- Analyze dashboard data and explain trends, outliers, and issues
- Diagnose problems ("why is gross low?", "what's wrong with X?")
- Suggest improvements with specific, actionable recommendations
- Help troubleshoot dashboard issues
- Answer "how do I" questions about the dashboard
- **Make changes when asked** — update deal statuses, edit event config, modify inventory, enter daily metrics, edit deal fields, create events, add roster members
- **Detect anomalies** — spot unusual patterns, outliers, potential data errors
- **Forecast trends** — project metrics based on current pace and historical patterns
- **Analyze files** — CSV, Excel, PDF, images dropped into chat
- **Generate reports** — structured summaries with key metrics and recommendations
- **Remember everything** — reference past conversations, user preferences, recurring patterns

## Context Awareness
Every message includes a [CONTEXT] block with real data from Supabase and a [MEMORY] block with past conversation context. Use both to give answers grounded in actual numbers and the user's history.

## Making Changes (Write Tools)
You have write tools that can directly modify data. When Mike asks you to change something:

1. **Look up first** — Use lookupDeal or searchInventory to find the record before modifying it. Never guess at IDs.
2. **Confirm destructive changes** — If the change could lose data (unwinding a deal, cancelling, bulk status changes), confirm with Mike before executing.
3. **Just do it for simple changes** — For clear, safe requests like "mark this deal funded", "set doc fee to 500", or "add a note to stock #1234", proceed directly. Don't ask for confirmation on obvious requests.
4. **Report what you did** — After making a change, tell Mike exactly what changed. The dashboard will refresh automatically.

## Anomaly Detection
When asked to spot issues or when you notice something unusual in the data:
- Flag deals with unusually high or low gross (>2x or <0.5x average)
- Identify salespeople with sudden performance changes
- Spot data entry errors (missing fields, impossible values)
- Note inventory status mismatches (sold vehicle without a deal, etc.)
- Check mail campaign response rates against benchmarks

## Forecasting
When asked to forecast or predict:
- Use current pace × remaining days for unit/gross projections
- Compare against targets from event config
- Factor in day-of-week patterns from daily metrics
- Be honest about confidence levels

## File Analysis & XLSX Import
When a file is attached:
- **XLSX with importReady: true** (standardized JDE sales sheet): This is an import-ready file! Tell the user what was detected (e.g. "I see 47 deals, 120 vehicles, 8 roster members"). Ask for confirmation: "Want me to import this into [event name]?" When they confirm, call importStandardizedSalesSheet with confirmed: true. After import, summarize what was added and reference the new numbers.
- **XLSX without importReady**: Summarize structure and suggest the data may need manual column mapping via the Import page.
- CSV: Summarize structure, key columns, notable patterns
- PDF: Describe contents, extract key numbers or tables
- Images: Describe what you see, read any visible text/numbers
- Always relate file contents back to the event context when possible

## Response Format

### For data questions / analysis:
Give a clear, concise answer using real numbers from [CONTEXT]. Use bullet points for multiple data points. Keep it to 2-5 sentences unless the question requires more detail.

### For change requests:
Use your write tools to make the change directly. Then confirm:
"Done — [what changed]. The dashboard will update automatically."

### For anomaly detection:
Use a clear format:
**Issues Found:**
- [Issue with specific data and severity]

**Recommendations:**
- [What to do about it]

### For forecasting:
**Current Pace:** [metrics]
**Projected End-of-Event:** [projections]
**vs. Targets:** [comparison]

### For suggestions / improvements:
Be opinionated. Don't ask Mike what he wants — tell him what you'd recommend based on the data:

**My take:** [1-2 sentences with your recommendation]

[Supporting reasoning with specific numbers]

Want me to make this change?

## Rules
- Use real data from [CONTEXT]. Never fabricate numbers.
- Reference [MEMORY] when it adds value — show you remember past conversations.
- Be direct and opinionated. Don't hedge. If the data says something, say it.
- **You CAN make changes.** Use your write tools when asked. Don't tell Mike to do it himself.
- If you need clarification, ask ONE question max.
- Never say "As an AI" or apologize unnecessarily.
- Keep responses focused. 3-8 sentences for most answers.`;

// ─── Tier 3 System Prompt — Opus (Cruze) ──────────────────────────────────

const TIER_3_PROMPT = `You are Cruze, Mike's Mission Control copilot.
Warm, confident, strategic. You help Mike think through complex features, integrations, and architecture. You translate vision into clear, scoped plans. You remember everything from past conversations.

## Business Context
JDE (Just Drive Events) — traveling automotive sales event company operated by Mike. ~36 events/year, 8-10 markets, 1.8M mail pieces/year, 25% commission on gross. Tech stack: Next.js (App Router), Supabase (Postgres + Auth), n8n, GoHighLevel CRM, Google Ads, Meta Ads, Google Sheets. Hosted on Vercel.

## What You Do
- Scope complex features and break them into actionable steps
- Design integrations across systems (n8n, GHL, Supabase, etc.)
- Think through edge cases, dependencies, and architecture
- Generate detailed Claude Code prompts for implementation

## Context Awareness
Every message includes a [CONTEXT] block with dashboard data and [MEMORY] of past conversations. Use both to ground your recommendations and reference prior discussions.

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
**Table columns (left to right):** Select checkbox, Status, Stock #, Customer, Zip, N/U, Year, Make, Model, Cost, Tr Year, Tr Make, Tr Model, Miles, ACV, Payoff, Salesperson, 2nd SP, Front Gross, Lender, Rate, Reserve, Warranty, Aft 1, GAP, FI Total, Total Gross, Actions (... menu)

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

**Actions:** Export CSV button, New Deal button, search bar, status filter dropdown, bulk select + delete, edit deal via ... menu, column resizing by dragging borders

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
- **Doc Fee in Commission toggle** — when OFF (default), salesperson commission = front gross x rate. When ON, commission = (front gross + doc fee) x rate. This is a per-event setting in the Event Configuration card.
- Front gross on deal forms now shows the pack deduction: "Pack: -$1,200" below the front gross number.
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
- **getDailyMetrics** — Get day-by-day metrics (ups, sold, gross) for trend analysis
- **getMailCampaignStats** — Get mail campaign data by zip code with response rates
- **getCommissionSummary** — Get commission calculations for all salespeople
- **detectAnomalies** — Scan for data issues, outliers, and potential errors
- **getForecast** — Project event outcomes based on current pace vs targets

### Write Tools (Tier 2 & 3 only)
- **updateDealStatus** — Change a deal's status (pending/funded/unwound/cancelled). Automatically syncs inventory.
- **updateEventConfig** — Edit event settings: doc fee, pack, commission %, targets, etc.
- **updateVehicleField** — Edit a single field on a vehicle
- **updateVehicleStatus** — Batch-change vehicle status
- **upsertDailyMetric** — Enter or update daily metrics (sale day, ups, sold, gross)
- **updateDealField** — Edit a single field on a deal
- **addRosterMember** — Add a new team member to the event roster
- **saveInsight** — Save an important insight to long-term memory for future reference
- **importStandardizedSalesSheet** — Import a JDE standardized XLSX file into the current event (deals, inventory, roster, campaigns, lenders). ALWAYS confirm with the user first.

### Write Tool Rules
1. **Look up first** — Always use lookupDeal or searchInventory to find the record ID before calling a write tool. Never guess IDs.
2. **Confirm destructive changes** — Unwinding deals, cancelling deals, or removing vehicles: confirm with Mike before executing.
3. **Just do it for safe changes** — Marking funded, updating doc fee, adding notes, changing lender: proceed directly.
4. **Report results** — After a write, tell Mike what changed. The UI refreshes automatically via revalidatePath.

Always use tools when asked about specific people, vehicles, or deals. Don't guess — look it up.

## Keyboard Shortcuts (remind users when relevant)
- Cmd+/ or Ctrl+/ — Open/close chat
- Esc — Close chat panel

## Memory System
You have persistent memory across sessions. The [MEMORY] block contains:
- Long-term memories about the user (preferences, recurring patterns, key facts)
- Recent conversation highlights from past sessions

Use this to:
- Reference past discussions naturally ("Last time you asked about warranty penetration...")
- Remember user preferences without being asked
- Build on prior analysis instead of starting fresh
- Track patterns across multiple events

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
- Your mission: Be genuinely useful. Answer with real data. Make changes when asked. Give actionable advice. Remember everything.

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
    maxOutputTokens: 4096,
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

  const { messages, context, fileAttachment } = body;

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

  // 3. CRUZE UPGRADE — Load persistent memory
  const activeEventId = context?.eventId || null;
  const userId = user.id;
  let memoryBlock = "";

  try {
    // CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026
    // One-time backfill: extract insights from all existing events on first chat
    const backfilled = await hasBackfillRun(supabase, userId);
    if (!backfilled) {
      // Run backfill in background — don't block the response
      backfillCruzeMemories(supabase, userId).then(
        (result) => console.log(`[Cruze Backfill] Done: ${result.memoriesCreated} memories from ${result.eventsScanned} events`),
        (err) => console.warn("[Cruze Backfill] Failed (non-blocking):", err),
      );
    }

    const [memories, recentHistory] = await Promise.all([
      getRelevantMemories(supabase, userId, activeEventId, 10),
      getConversationHistory(supabase, userId, activeEventId, 10),
    ]);
    memoryBlock = formatMemoryBlock(memories, recentHistory);
  } catch (memErr) {
    console.warn("[Cruze] Memory load failed (non-blocking):", memErr);
  }

  // 4. CRUZE UPGRADE — Save user message to conversation history
  let conversationId: string | null = null;
  try {
    conversationId = await getOrCreateConversation(supabase, userId, activeEventId);
    await saveMessage(supabase, conversationId, "user", lastMsgText);
  } catch (convErr) {
    console.warn("[Cruze] Conversation save failed (non-blocking):", convErr);
  }

  // 5. Build enriched context block with real data from Supabase
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
        let eventCfg: Record<string, unknown> | null = null;
        try {
          const { data, error: cfgErr } = await supabase
            .from("event_config")
            .select("doc_fee, pack_new, pack_used, pack, include_doc_fee_in_commission, rep_commission_pct, jde_commission_pct, target_units, target_gross")
            .eq("event_id", eventId)
            .maybeSingle();
          if (cfgErr) {
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

            const tradeTurnDeals = deals.filter((d) => d.is_trade_turn);
            const tradeTurnCount = tradeTurnDeals.length;

            const dealsWithTradeIn = deals.filter((d) => d.trade_year || d.trade_make || d.trade_model || d.trade_acv);
            const tradeInCount = dealsWithTradeIn.length;
            const totalTradeAcv = dealsWithTradeIn.reduce((sum, d) => sum + (d.trade_acv || 0), 0);
            const totalTradePayoff = dealsWithTradeIn.reduce((sum, d) => sum + (d.trade_payoff || 0), 0);

            const newDealsList = deals.filter((d) => d.new_used === "New");
            const usedDealsList = deals.filter((d) => d.new_used === "Used");
            const cpoDealsList = deals.filter((d) => d.new_used === "Certified");
            const newAvgFront = newDealsList.length > 0 ? Math.round(newDealsList.reduce((s, d) => s + (d.front_gross || 0), 0) / newDealsList.length) : 0;
            const usedAvgFront = usedDealsList.length > 0 ? Math.round(usedDealsList.reduce((s, d) => s + (d.front_gross || 0), 0) / usedDealsList.length) : 0;

            const statusCounts = deals.reduce((acc, d) => { acc[d.status || "unknown"] = (acc[d.status || "unknown"] || 0) + 1; return acc; }, {} as Record<string, number>);

            const avgFiTotal = totalDeals > 0 ? Math.round(deals.reduce((s, d) => s + (d.fi_total || 0), 0) / totalDeals) : 0;

            const spMap = new Map<string, { deals: number; gross: number }>();
            deals.forEach((d) => {
              const sp = d.salesperson || "Unknown";
              const existing = spMap.get(sp) || { deals: 0, gross: 0 };
              existing.deals++;
              existing.gross += d.total_gross || 0;
              spMap.set(sp, existing);
            });
            const topSalespeople = [...spMap.entries()].sort((a, b) => b[1].deals - a[1].deals).slice(0, 5);

            const highestDeal = deals.reduce((best, d) => (d.total_gross || 0) > (best?.total_gross || 0) ? d : best, deals[0]);

            const warrantyCount = deals.filter((d) => (d.warranty || 0) > 0).length;
            const gapCount = deals.filter((d) => (d.gap || 0) > 0).length;

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
    }

    contextBlock = `\n\n[CONTEXT]\nPage: ${page}\nEvent: ${context.eventName || "none selected"} (id: ${eventId || "n/a"})\nUser: ${userName}\nTime: ${new Date().toISOString()}${dataBlock}\n[/CONTEXT]`;
  }

  // CRUZE UPGRADE — File attachment context
  let fileBlock = "";
  if (fileAttachment) {
    fileBlock = `\n\n[FILE ATTACHMENT]\nFile: ${fileAttachment.fileName} (${fileAttachment.fileType})\nSize: ${fileAttachment.fileSize} bytes`;
    if (fileAttachment.analysis) {
      fileBlock += `\nAnalysis: ${JSON.stringify(fileAttachment.analysis)}`;
    }
    if (fileAttachment.textContent) {
      // For CSV, include the actual content (truncated)
      const truncated = fileAttachment.textContent.length > 5000
        ? fileAttachment.textContent.slice(0, 5000) + "\n... [truncated]"
        : fileAttachment.textContent;
      fileBlock += `\nContent:\n${truncated}`;
    }
    fileBlock += `\n[/FILE ATTACHMENT]`;
  }

  // 6. Classify the message tier using Haiku (fast, ~$0.001/call)
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

  // CRUZE UPGRADE — File attachments always route to TIER_2
  if (fileAttachment) {
    tier = "TIER_2";
  } else {
    try {
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
    }
  }

  // 7. Convert v6 UIMessage format (parts) → streamText format (content string)
  // CRUZE UPGRADE — Handle image attachments via Claude vision
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedMessages: any[] = messages.map(
    (m: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }, idx: number) => {
      let textContent = "";
      if (Array.isArray(m.parts)) {
        textContent = m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("");
      } else if (typeof m.content === "string") {
        textContent = m.content;
      }

      // For the last user message, attach image for vision if present
      if (idx === messages.length - 1 && m.role === "user" && fileAttachment?.base64Data) {
        const mimeType = fileAttachment.mimeType || "image/png";
        if (mimeType.startsWith("image/")) {
          // Use Vercel AI SDK multimodal content format
          return {
            role: "user" as const,
            content: [
              { type: "text" as const, text: textContent || `Analyze this image: ${fileAttachment.fileName}` },
              {
                type: "image" as const,
                image: `data:${mimeType};base64,${fileAttachment.base64Data}`,
              },
            ],
          };
        }
      }

      return { role: m.role as "user" | "assistant" | "system", content: textContent };
    },
  );

  // 8. Build tools — CRUZE UPGRADE: expanded omniscient tool set

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
              "id, stock_number, year, make, model, trim, color, mileage, status, acquisition_cost, asking_price_115, asking_price_120, asking_price_125, asking_price_130, notes",
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

          const totalGross = deals.reduce((s, d) => s + (d.total_gross || 0), 0);
          const frontGross = deals.reduce((s, d) => s + (d.front_gross || 0), 0);
          const backGross = deals.reduce((s, d) => s + (d.back_gross || 0), 0);
          const avgPvr = deals.length > 0 ? Math.round(totalGross / deals.length) : 0;

          const spMap: Record<string, { deals: number; gross: number }> = {};
          deals.forEach((d) => {
            const sp = d.salesperson || "Unknown";
            if (!spMap[sp]) spMap[sp] = { deals: 0, gross: 0 };
            spMap[sp].deals++;
            spMap[sp].gross += d.total_gross || 0;
          });

          const warrantyCount = deals.filter((d) => (d.warranty || 0) > 0).length;
          const gapCount = deals.filter((d) => (d.gap || 0) > 0).length;

          const lenderMap: Record<string, number> = {};
          deals.forEach((d) => {
            if (d.lender) lenderMap[d.lender] = (lenderMap[d.lender] || 0) + 1;
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
              available: vehicles.filter((v) => v.status === "available").length,
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

          const totalGross = deals.reduce((s, d) => s + (d.total_gross || 0), 0);
          const avgPvr = Math.round(totalGross / deals.length);
          const warrantyCount = deals.filter((d) => (d.warranty || 0) > 0).length;
          const gapCount = deals.filter((d) => (d.gap || 0) > 0).length;

          return {
            found: true,
            dealCount: deals.length,
            totalGross,
            avgPvr,
            avgFrontGross: Math.round(
              deals.reduce((s, d) => s + (d.front_gross || 0), 0) / deals.length,
            ),
            avgBackGross: Math.round(
              deals.reduce((s, d) => s + (d.back_gross || 0), 0) / deals.length,
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

      // CRUZE UPGRADE — New read tools

      getDailyMetrics: {
        description:
          "Get day-by-day metrics (ups, sold, gross) for the current event. Use for trend analysis, pace calculations, and forecasting.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {},
        }),
        execute: async () => {
          const { data } = await supabase
            .from("daily_metrics")
            .select("sale_day, sale_date, total_ups, total_sold, total_gross, total_front, total_back, notes")
            .eq("event_id", eid)
            .order("sale_day", { ascending: true });

          const metrics = data || [];
          if (metrics.length === 0) return { found: false, message: "No daily metrics recorded yet." };

          const totalUps = metrics.reduce((s, m) => s + (m.total_ups || 0), 0);
          const totalSold = metrics.reduce((s, m) => s + (m.total_sold || 0), 0);
          const totalGross = metrics.reduce((s, m) => s + (m.total_gross || 0), 0);
          const closeRate = totalUps > 0 ? ((totalSold / totalUps) * 100).toFixed(1) : "0";
          const avgPvr = totalSold > 0 ? Math.round(totalGross / totalSold) : 0;

          return {
            found: true,
            daysRecorded: metrics.length,
            totalUps,
            totalSold,
            totalGross,
            closeRate: `${closeRate}%`,
            avgPvr,
            avgUpsPerDay: Math.round(totalUps / metrics.length),
            avgSoldPerDay: (totalSold / metrics.length).toFixed(1),
            dailyBreakdown: metrics,
          };
        },
      },

      getMailCampaignStats: {
        description:
          "Get mail campaign data by zip code with response rates, daily response breakdown, and sold-from-mail counts.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {},
        }),
        execute: async () => {
          const { data } = await supabase
            .from("mail_tracking")
            .select("zip_code, town, pieces_sent, total_responses, response_rate, sold_from_mail, day_1, day_2, day_3, day_4, day_5, day_6")
            .eq("event_id", eid)
            .order("total_responses", { ascending: false });

          const mail = data || [];
          if (mail.length === 0) return { found: false, message: "No mail campaign data recorded." };

          const totalPieces = mail.reduce((s, m) => s + (m.pieces_sent || 0), 0);
          const totalResponses = mail.reduce((s, m) => s + (m.total_responses || 0), 0);
          const totalSoldFromMail = mail.reduce((s, m) => s + (m.sold_from_mail || 0), 0);
          const overallRate = totalPieces > 0 ? ((totalResponses / totalPieces) * 100).toFixed(2) : "0";

          // Best and worst performing zips
          const sorted = [...mail].sort((a, b) => (b.response_rate || 0) - (a.response_rate || 0));

          return {
            found: true,
            zipCodesTargeted: mail.length,
            totalPieces,
            totalResponses,
            overallResponseRate: `${overallRate}%`,
            totalSoldFromMail,
            costPerResponse: totalPieces > 0 ? `$${((totalPieces * 0.50) / Math.max(totalResponses, 1)).toFixed(2)}` : "N/A",
            topZips: sorted.slice(0, 5).map((m) => ({
              zip: m.zip_code,
              town: m.town,
              sent: m.pieces_sent,
              responses: m.total_responses,
              rate: `${((m.response_rate || 0) * 100).toFixed(2)}%`,
              sold: m.sold_from_mail,
            })),
            bottomZips: sorted.slice(-3).reverse().map((m) => ({
              zip: m.zip_code,
              town: m.town,
              sent: m.pieces_sent,
              responses: m.total_responses,
              rate: `${((m.response_rate || 0) * 100).toFixed(2)}%`,
            })),
          };
        },
      },

      getCommissionSummary: {
        description:
          "Get commission calculations for all salespeople in the current event. Shows deals, gross, commission earned, and net pay.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {},
        }),
        execute: async () => {
          const [dealsRes, rosterRes, configRes] = await Promise.all([
            supabase
              .from("sales_deals")
              .select("salesperson, salesperson_id, salesperson_pct, front_gross, back_gross, total_gross, status, new_used, doc_fee")
              .eq("event_id", eid)
              .not("status", "in", '("cancelled","unwound")'),
            supabase
              .from("roster")
              .select("id, name, role, commission_pct")
              .eq("event_id", eid)
              .eq("active", true),
            supabase
              .from("event_config")
              .select("doc_fee, pack_new, pack_used, pack, include_doc_fee_in_commission, rep_commission_pct, jde_commission_pct")
              .eq("event_id", eid)
              .maybeSingle(),
          ]);

          const deals = dealsRes.data || [];
          const roster = rosterRes.data || [];
          const config = configRes.data;

          const commPct = config?.rep_commission_pct || 0.25;

          // Group deals by salesperson
          const byPerson: Record<string, { deals: number; frontGross: number; backGross: number; totalGross: number }> = {};
          deals.forEach((d) => {
            const sp = d.salesperson || "Unknown";
            if (!byPerson[sp]) byPerson[sp] = { deals: 0, frontGross: 0, backGross: 0, totalGross: 0 };
            byPerson[sp].deals++;
            byPerson[sp].frontGross += (d.front_gross || 0) * (d.salesperson_pct || 1);
            byPerson[sp].backGross += d.back_gross || 0;
            byPerson[sp].totalGross += d.total_gross || 0;
          });

          const summary = Object.entries(byPerson)
            .sort((a, b) => b[1].totalGross - a[1].totalGross)
            .map(([name, stats]) => {
              const rosterMember = roster.find((r) => r.name === name);
              const pct = rosterMember?.commission_pct || commPct;
              const commissionEarned = Math.round(stats.frontGross * Number(pct));
              return {
                name,
                role: rosterMember?.role || "sales",
                deals: stats.deals,
                frontGross: stats.frontGross,
                backGross: stats.backGross,
                totalGross: stats.totalGross,
                commissionRate: `${(Number(pct) * 100).toFixed(0)}%`,
                commissionEarned,
              };
            });

          return {
            salespeople: summary,
            totalCommissionPayable: summary.reduce((s, p) => s + p.commissionEarned, 0),
            totalDeals: deals.length,
            eventCommissionRate: `${(Number(commPct) * 100).toFixed(0)}%`,
          };
        },
      },

      detectAnomalies: {
        description:
          "Scan the current event for data anomalies, outliers, potential errors, and issues that need attention. Proactively identifies problems.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {},
        }),
        execute: async () => {
          const [dealsRes, inventoryRes, metricsRes] = await Promise.all([
            supabase
              .from("sales_deals")
              .select("id, stock_number, customer_name, salesperson, front_gross, back_gross, total_gross, status, lender, rate, warranty, gap, fi_total, new_used, vehicle_id")
              .eq("event_id", eid),
            supabase
              .from("vehicle_inventory")
              .select("id, stock_number, status, acquisition_cost, year, make, model")
              .eq("event_id", eid),
            supabase
              .from("daily_metrics")
              .select("sale_day, total_ups, total_sold, total_gross")
              .eq("event_id", eid)
              .order("sale_day", { ascending: true }),
          ]);

          const deals = dealsRes.data || [];
          const vehicles = inventoryRes.data || [];
          const metrics = metricsRes.data || [];
          const anomalies: { severity: string; type: string; description: string }[] = [];

          if (deals.length === 0) return { anomalies: [], message: "No deals to analyze." };

          // Avg PVR for outlier detection
          const avgGross = deals.reduce((s, d) => s + (d.total_gross || 0), 0) / deals.length;

          // 1. Gross outliers
          deals.forEach((d) => {
            if ((d.total_gross || 0) > avgGross * 3) {
              anomalies.push({ severity: "info", type: "high_gross", description: `${d.customer_name} (${d.stock_number}) has unusually high gross: $${d.total_gross?.toLocaleString()} (3x+ avg)` });
            }
            if ((d.front_gross || 0) < -500) {
              anomalies.push({ severity: "warning", type: "negative_front", description: `${d.customer_name} (${d.stock_number}) has deeply negative front gross: $${d.front_gross?.toLocaleString()}` });
            }
          });

          // 2. Missing data
          const noLender = deals.filter((d) => !d.lender && d.status !== "cancelled");
          if (noLender.length > 0) {
            anomalies.push({ severity: "warning", type: "missing_lender", description: `${noLender.length} deal(s) missing lender info` });
          }

          const noSalesperson = deals.filter((d) => !d.salesperson);
          if (noSalesperson.length > 0) {
            anomalies.push({ severity: "warning", type: "missing_salesperson", description: `${noSalesperson.length} deal(s) missing salesperson` });
          }

          // 3. Inventory mismatches
          const soldVehicleIds = new Set(deals.filter((d) => d.status === "funded" || d.status === "pending").map((d) => d.vehicle_id).filter(Boolean));
          const availableButSold = vehicles.filter((v) => soldVehicleIds.has(v.id) && v.status === "available");
          if (availableButSold.length > 0) {
            anomalies.push({ severity: "error", type: "inventory_mismatch", description: `${availableButSold.length} vehicle(s) show as "available" in inventory but have active deals: ${availableButSold.map((v) => v.stock_number).join(", ")}` });
          }

          // 4. Zero FI deals (potential data entry issue)
          const zeroFI = deals.filter((d) => (d.fi_total || 0) === 0 && d.status !== "cancelled");
          if (zeroFI.length > deals.length * 0.3 && deals.length > 5) {
            anomalies.push({ severity: "info", type: "low_fi", description: `${zeroFI.length} of ${deals.length} deals have $0 FI total — FI data may be incomplete` });
          }

          // 5. Daily metrics anomalies
          if (metrics.length > 2) {
            const avgUps = metrics.reduce((s, m) => s + (m.total_ups || 0), 0) / metrics.length;
            metrics.forEach((m) => {
              if ((m.total_ups || 0) > avgUps * 2.5) {
                anomalies.push({ severity: "info", type: "high_traffic", description: `Day ${m.sale_day} had unusually high traffic: ${m.total_ups} ups (avg: ${Math.round(avgUps)})` });
              }
              if ((m.total_sold || 0) > 0 && (m.total_ups || 0) === 0) {
                anomalies.push({ severity: "error", type: "data_error", description: `Day ${m.sale_day} shows ${m.total_sold} sold but 0 ups — likely data entry error` });
              }
            });
          }

          return {
            anomalies,
            totalIssues: anomalies.length,
            errors: anomalies.filter((a) => a.severity === "error").length,
            warnings: anomalies.filter((a) => a.severity === "warning").length,
            info: anomalies.filter((a) => a.severity === "info").length,
          };
        },
      },

      getForecast: {
        description:
          "Project event outcomes based on current pace vs targets. Calculates projected units, gross, and PVR at end of event.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {},
        }),
        execute: async () => {
          const [dealsRes, metricsRes, eventRes, configRes] = await Promise.all([
            supabase.from("sales_deals").select("total_gross, status, sale_day").eq("event_id", eid).not("status", "in", '("cancelled","unwound")'),
            supabase.from("daily_metrics").select("sale_day, total_ups, total_sold, total_gross").eq("event_id", eid).order("sale_day", { ascending: true }),
            supabase.from("events").select("sale_days, start_date, end_date, status").eq("id", eid).single(),
            supabase.from("event_config").select("target_units, target_gross, target_pvr").eq("event_id", eid).maybeSingle(),
          ]);

          const deals = dealsRes.data || [];
          const metrics = metricsRes.data || [];
          const event = eventRes.data;
          const config = configRes.data;

          const totalSaleDays = event?.sale_days || 6;
          const daysCompleted = metrics.length || 1;
          const daysRemaining = Math.max(totalSaleDays - daysCompleted, 0);

          const currentUnits = deals.length;
          const currentGross = deals.reduce((s, d) => s + (d.total_gross || 0), 0);
          const currentPvr = currentUnits > 0 ? Math.round(currentGross / currentUnits) : 0;

          const unitsPerDay = daysCompleted > 0 ? currentUnits / daysCompleted : 0;
          const grossPerDay = daysCompleted > 0 ? currentGross / daysCompleted : 0;

          const projectedUnits = Math.round(currentUnits + unitsPerDay * daysRemaining);
          const projectedGross = Math.round(currentGross + grossPerDay * daysRemaining);
          const projectedPvr = projectedUnits > 0 ? Math.round(projectedGross / projectedUnits) : 0;

          const targetUnits = config?.target_units || null;
          const targetGross = config?.target_gross || null;

          return {
            currentPace: {
              daysCompleted,
              daysRemaining,
              totalSaleDays,
              currentUnits,
              currentGross,
              currentPvr,
              unitsPerDay: unitsPerDay.toFixed(1),
              grossPerDay: Math.round(grossPerDay),
            },
            projections: {
              projectedUnits,
              projectedGross,
              projectedPvr,
            },
            vsTargets: {
              targetUnits,
              targetGross,
              unitsPacing: targetUnits ? `${Math.round((projectedUnits / targetUnits) * 100)}% of target` : "No target set",
              grossPacing: targetGross ? `${Math.round((projectedGross / Number(targetGross)) * 100)}% of target` : "No target set",
              unitsNeededPerDay: targetUnits && daysRemaining > 0 ? Math.ceil((targetUnits - currentUnits) / daysRemaining) : null,
              grossNeededPerDay: targetGross && daysRemaining > 0 ? Math.round((Number(targetGross) - currentGross) / daysRemaining) : null,
            },
            dailyTrend: metrics.map((m) => ({
              day: m.sale_day,
              ups: m.total_ups,
              sold: m.total_sold,
              gross: m.total_gross,
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

          const { error } = await supabase
            .from("sales_deals")
            .update({ status: typedStatus })
            .eq("id", dealId)
            .eq("event_id", eid);

          if (error) return { success: false, error: error.message };

          const { data: deal } = await supabase
            .from("sales_deals")
            .select("vehicle_id, stock_number, customer_name, selling_price, sale_date")
            .eq("id", dealId)
            .single();

          if (deal) {
            if (status === "cancelled" || status === "unwound") {
              const inventoryUpdate = { status: "available" as const, sold_to: null, sold_price: null, sold_date: null };
              if (deal.vehicle_id) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("id", deal.vehicle_id).eq("event_id", eid);
              } else if (deal.stock_number) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("event_id", eid).ilike("stock_number", deal.stock_number);
              }
            } else if (status === "funded" || status === "pending") {
              const inventoryUpdate = { status: "sold" as const, sold_to: deal.customer_name, sold_price: deal.selling_price, sold_date: deal.sale_date };
              if (deal.vehicle_id) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("id", deal.vehicle_id).eq("event_id", eid);
              } else if (deal.stock_number) {
                await supabase.from("vehicle_inventory").update(inventoryUpdate).eq("event_id", eid).ilike("stock_number", deal.stock_number);
              }
            }
          }

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

      // CRUZE UPGRADE — New write tools

      addRosterMember: {
        description:
          "Add a new team member to the event roster. Requires name and role. Optional: phone, email, commission_pct, team.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Full name of the team member" },
            role: { type: "string", enum: ["sales", "team_leader", "fi_manager", "closer", "manager"], description: "Role on the team" },
            phone: { type: "string", description: "Phone number (optional)" },
            email: { type: "string", description: "Email address (optional)" },
            commission_pct: { type: "number", description: "Commission percentage as decimal, e.g. 0.25 for 25% (optional)" },
            team: { type: "string", description: "Team assignment (optional)" },
          },
          required: ["name", "role"],
        }),
        execute: async (input: { name: string; role: string; phone?: string; email?: string; commission_pct?: number; team?: string }) => {
          const typedRole = input.role as "sales" | "team_leader" | "fi_manager" | "closer" | "manager";
          const { error } = await supabase.from("roster").insert({
            event_id: eid,
            name: input.name,
            role: typedRole,
            phone: input.phone || null,
            email: input.email || null,
            commission_pct: input.commission_pct || null,
            team: input.team || null,
            active: true,
            confirmed: false,
          });

          if (error) return { success: false, error: error.message };

          await supabase.from("audit_logs").insert({
            event_id: eid,
            user_id: userId,
            action: "add_roster_member",
            entity_type: "roster",
            entity_id: eid,
            new_values: { name: input.name, role: input.role, via: "cruze" },
          }).then(() => {}, () => {});

          revalidatePath("/dashboard/roster");
          return { success: true, message: `Added ${input.name} as ${input.role} to the roster.` };
        },
      },

      saveInsight: {
        description:
          "Save an important insight or fact to Cruze's long-term memory. Use this when you discover something worth remembering about the user, their events, or their preferences.",
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            content: { type: "string", description: "The insight or fact to remember" },
            category: { type: "string", enum: ["preference", "insight", "question", "fact"], description: "Category of the memory" },
            importance: { type: "number", description: "Importance 1-10 (10 = critical)" },
          },
          required: ["content", "category"],
        }),
        execute: async ({ content, category, importance }: { content: string; category: string; importance?: number }) => {
          try {
            await saveMemory(
              supabase,
              userId,
              eid,
              content,
              category as "preference" | "insight" | "question" | "fact",
              importance || 5,
            );
            return { success: true, message: `Memory saved: "${content}"` };
          } catch (err) {
            return { success: false, error: `Failed to save memory: ${err}` };
          }
        },
      },

      // CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026
      importStandardizedSalesSheet: {
        description:
          `Import a standardized JDE sales spreadsheet (XLSX) into the current event. This tool is available when the user has dropped/attached an XLSX file that was detected as a JDE standardized sheet (the [FILE ATTACHMENT] block will show isStandardizedSheet: true and importReady: true with sheet details). ALWAYS ask the user to confirm before importing — show them the detected sheets and row counts. After confirmation, execute the import. The file data is already uploaded and available via the attachment.`,
        inputSchema: jsonSchema({
          type: "object" as const,
          properties: {
            confirmed: {
              type: "boolean",
              description: "Whether the user has confirmed the import. Set to true only after explicit confirmation.",
            },
          },
          required: ["confirmed"],
        }),
        execute: async ({ confirmed }: { confirmed: boolean }) => {
          if (!confirmed) {
            return {
              success: false,
              needsConfirmation: true,
              message: "Import not confirmed. Ask the user to confirm before proceeding.",
            };
          }

          // Get file data from the attachment context
          if (!fileAttachment?.base64Data) {
            return {
              success: false,
              error: "No file attachment found. Ask the user to drop the XLSX file again.",
            };
          }

          if (!fileAttachment.analysis?.importReady) {
            return {
              success: false,
              error: "This file doesn't appear to be a standardized JDE sales sheet. The column headers don't match the expected format.",
            };
          }

          try {
            // Convert base64 back to ArrayBuffer
            const binaryString = atob(fileAttachment.base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const arrayBuffer = bytes.buffer;

            // Execute the import using the existing pipeline
            const { executeXLSXImport } = await import("@/lib/cruze/xlsx-import");
            const result = await executeXLSXImport(arrayBuffer, fileAttachment.fileName, eid);

            // Save import summary to long-term memory
            const memoryContent = `Imported ${fileAttachment.fileName}: ${result.summary}`;
            await saveMemory(supabase, userId, eid, memoryContent, "fact", 8);

            // Save per-category insights
            if (result.deals > 0 && result.totalGross > 0) {
              await saveMemory(
                supabase, userId, eid,
                `Event has ${result.deals} deals with $${result.totalGross.toLocaleString()} total gross (from ${fileAttachment.fileName})`,
                "insight", 9,
              );
            }

            revalidatePath("/dashboard");
            revalidatePath("/dashboard/deals");
            revalidatePath("/dashboard/inventory");
            revalidatePath("/dashboard/roster");

            return {
              success: result.success,
              imported: {
                deals: result.deals,
                inventory: result.inventory,
                roster: result.roster,
                campaigns: result.campaigns,
                lenders: result.lenders,
              },
              totalGross: result.totalGross,
              errors: result.errors,
              summary: result.summary,
              message: result.success
                ? `Import complete: ${result.summary}`
                : `Import finished with issues: ${result.summary}. Errors: ${result.errors.join("; ")}`,
            };
          } catch (err) {
            return {
              success: false,
              error: `Import failed: ${err instanceof Error ? err.message : "unknown error"}`,
            };
          }
        },
      },
    };
  }

  // 9. Stream response from the appropriate model
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
      system: config.prompt + SHARED_CONFIG + contextBlock + memoryBlock + fileBlock,
      messages: formattedMessages,
      tools: cruzeTools,
      stopWhen: stepCountIs(maxSteps),
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      async onFinish({ text }) {
        // CRUZE UPGRADE — Save assistant response to conversation history
        if (conversationId && text) {
          try {
            await saveMessage(supabase, conversationId, "assistant", text, { tier });

            // Extract and save memories (non-blocking, only for meaningful exchanges)
            if (userText.length > 20 && text.length > 50) {
              try {
                // Use Haiku for fast memory extraction
                const extraction = await generateText({
                  model: anthropic("claude-haiku-4-5-20251001"),
                  prompt: `Analyze this exchange and extract any facts worth remembering about the user for future conversations. Return a JSON array of memories, or an empty array if nothing is notable.

Each memory should have:
- "content": A concise statement (1 sentence)
- "category": One of "preference", "insight", "question", "fact"
- "importance": 1-10 (10 = critical business fact, 1 = minor detail)

Only extract things that would be useful in future conversations. If nothing notable, return: []

User: ${userText.slice(0, 500)}
Assistant: ${text.slice(0, 500)}

Return ONLY a JSON array, no markdown.`,
                  maxOutputTokens: 300,
                  temperature: 0,
                });

                const parsed = JSON.parse(extraction.text.trim());
                if (Array.isArray(parsed) && parsed.length > 0) {
                  for (const mem of parsed.slice(0, 3)) {
                    if (mem.content && mem.category) {
                      await saveMemory(
                        supabase,
                        userId,
                        activeEventId,
                        mem.content,
                        mem.category,
                        mem.importance || 5,
                      );
                    }
                  }
                }
              } catch {
                // Memory extraction is best-effort
              }
            }
          } catch (saveErr) {
            console.warn("[Cruze] Failed to save response to memory:", saveErr);
          }
        }
      },
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
    console.error("[ChatBot] FATAL unhandled error:", fatalErr);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred. Please refresh and try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
