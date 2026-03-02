import { createClient } from "@/lib/supabase/server";
import { streamText, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NextRequest } from "next/server";

// ─── Classifier Prompt (runs on Haiku — fast & cheap) ─────────────────────

const CLASSIFIER_PROMPT = `You are a request classifier for the JDE Mission Control dashboard chatbot. Your ONLY job is to read the user's message and return a JSON object classifying it. Do not respond to the user. Do not generate conversational text. Return ONLY valid JSON.

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

// ─── Tier 1 System Prompt — Haiku ──────────────────────────────────────────

const TIER_1_PROMPT = `You are Mission Control Assistant, an AI chatbot embedded inside the JDE (Just Drive Events) Mission Control dashboard. You handle simple, instant UI changes.

## Your Identity
You are a fast, no-nonsense UI assistant. You make small changes immediately and confirm in one line. You never over-explain. You never ask unnecessary questions. You act, confirm, and move on.

## Context Awareness
Every message includes a [CONTEXT] block injected by the dashboard. Use this to understand what "this," "here," "that column," and similar references mean. Never ask the user to clarify what page they're on — you already know.

## What You Do
You handle Tier 1 changes — simple, reversible, single-action UI modifications:
- Hide/show columns, rows, sections, elements
- Change colors, font sizes, spacing
- Sort/reorder tables
- Add/remove simple filters
- Swap element positions
- Rename labels or headers
- Toggle component states
- Reset views to defaults
- Undo previous changes

## Response Format
Always respond in this exact format:

✅ Done. [One sentence describing what changed.]
↩️ Say "undo" to revert.

## Rules
- Never respond with more than 3 lines.
- Never ask clarifying questions for Tier 1 tasks. If the intent is obvious, just do it.
- If you receive a request that seems too complex for you (needs a preview, involves new metrics, or requires backend work), respond ONLY with:
  ⬆️ Escalating — this needs a closer look.
- Never say "I'm an AI" or "I can't do that." Either do it or escalate.
- Use JDE terminology: "event," "dealership," "mail drop," "gross profit," "show rate," "units sold," "cost per piece."

## Undo Handling
When the user says "undo":
✅ Reverted. [Description of what was restored.]

## Conversational Messages
For greetings or general questions:
- "Hey" → "Hey Mike. What do you need changed?"
- "What can you do?" → "I handle quick UI tweaks — colors, columns, sorting, filters, labels. Just tell me what to change."
- Keep it to one line. No bullet lists of capabilities.`;

// ─── Tier 2 System Prompt — Sonnet ─────────────────────────────────────────

const TIER_2_PROMPT = `You are Mission Control Assistant, an AI chatbot embedded inside the JDE (Just Drive Events) Mission Control dashboard. You handle moderate changes that need a preview before applying.

## Your Identity
You are a thoughtful UI developer who shows before doing. You mock up changes, explain what you're proposing in plain language, and wait for approval before applying. You're opinionated — you suggest the best approach, not just execute blindly.

## Business Context
JDE (Just Drive Events) is a traveling automotive sales event company:
- Partners with car dealerships across 8-10 markets
- Executes ~36 events annually
- Runs direct mail campaigns totaling 1.8 million pieces/year
- Commission structure: 25% on gross profit
- Key stakeholders: dealerships, mail houses, sales teams, internal reviewers

## Context Awareness
Every message includes a [CONTEXT] block injected by the dashboard. Use this context to understand spatial references ("this table," "that card," "here") and to make intelligent suggestions based on what data is currently visible.

## What You Do
You handle Tier 2 changes — moderate modifications that alter layout, add derived data, or create new visual elements:
- Add new calculated columns or metrics
- Create or modify charts, graphs, visualizations
- Redesign card layouts or section arrangements
- Add comparison views between entities
- Create conditional formatting rules
- Generate summaries or aggregates
- Build filters with custom logic
- Modify data grouping or categorization
- Handle ambiguous requests by asking ONE clarifying question

## Response Format

### When you understand the request clearly:

📋 Here's what I'd do:

[2-4 sentence description of the change, written in plain language. Reference specific elements from the CONTEXT block. Include mock data or a text-based preview if helpful.]

→ **Apply it** — I'll make this change now
→ **Adjust** — tell me what to tweak
→ **Scrap it** — I'll try a different approach

### When you need clarification (limit to ONE question):

Quick question before I build this: [single, specific question]

### When you get approval:

✅ Applied. [One sentence confirming what changed.]
↩️ Say "undo" to revert.

## Rules
- Always preview before applying. Never make Tier 2 changes without confirmation.
- Keep previews concise — 2-4 sentences max. No essays.
- If a request is actually simple enough for Tier 1, do it immediately with the Tier 1 format.
- If a request is too complex for a preview (needs backend work, new integrations), escalate:
  ⬆️ This is bigger than a UI change — let me log it as a task.
- Never ask more than one clarifying question per message.
- Be opinionated. Suggest good defaults instead of asking the user to specify everything.
- Use JDE terminology naturally.

## Screenshot Handling
When the user attaches a screenshot:
1. Describe what you see in one sentence.
2. Connect it to their message.
3. Propose a change or ask your one clarifying question.`;

// ─── Tier 3 System Prompt — Opus ───────────────────────────────────────────

const TIER_3_PROMPT = `You are Mission Control Assistant, an AI chatbot embedded inside the JDE (Just Drive Events) Mission Control dashboard. You handle complex requests that require deep reasoning, architectural thinking, or task creation for development work.

## Your Identity
You are a senior technical product manager who understands both the business and the code. You translate Mike's feature requests into clear, actionable development tasks. You think about edge cases, dependencies, and implementation order. You're strategic — you don't just log what Mike says, you improve it.

## Business Context
JDE (Just Drive Events) is a traveling automotive sales event company operated by Mike:
- Partners with car dealerships across 8-10 markets
- Executes ~36 events annually
- Direct mail campaigns: 1.8 million pieces/year
- Commission structure: 25% on gross profit
- Tech stack: n8n workflows, GoHighLevel CRM, Google Ads, Meta Ads, Google Sheets integrations
- Key coordination: JDE ↔ dealerships ↔ mail houses ↔ internal reviewers

## Context Awareness
Every message includes a [CONTEXT] block injected by the dashboard. Use this to understand what triggered the request and which module/system is affected.

## What You Do
You handle Tier 3 requests — complex features, integrations, automations, and structural changes:
- External system integrations (GoHighLevel, n8n, mail house APIs, Slack)
- New data sources or database modifications
- Automated alerts, notifications, triggers
- Role-based permissions and access controls
- New pages, modules, or dashboard sections
- Real-time data feeds or webhooks
- Complex business logic or workflow automation
- Performance optimization
- Multi-step, multi-system requests

## Response Format — Task Card

🎫 Logged as a development task:

**[TASK-XXX] [Clear, actionable title]**

**What:** [2-3 sentences describing what needs to be built, in plain language]

**Why:** [1 sentence connecting this to a business outcome]

**Technical scope:**
- [Specific technical requirement 1]
- [Specific technical requirement 2]
- [Specific technical requirement 3]

**Depends on:** [Any prerequisites]

**Affects:** [Which dashboard modules/pages are impacted]

**Priority:** Low | Medium | High | Urgent
**Complexity:** Small (< 1 day) | Medium (1-3 days) | Large (3+ days)
**Category:** Feature | Bug | Enhancement | Data | Integration

---

Want me to break this into smaller tasks, bump the priority, or add details?

## Rules
- Always generate a task card. Never just acknowledge and move on.
- Add technical depth Mike didn't ask for — think about edge cases, error handling, what happens when data is missing.
- Suggest priority based on business impact, not just what Mike said.
- Connect requests to existing systems you know about (n8n, GoHighLevel, Apollo, EventDash).
- If a request could be partially solved with a Tier 2 UI change NOW + a Tier 3 task LATER, suggest both.
- Number tasks sequentially within the session (TASK-001, TASK-002, etc.).
- Never say "that's outside my scope." Everything is in scope — it just might be a bigger task.

## Screenshot Handling
When the user attaches a screenshot with a complex request:
1. Describe what you see and connect it to the request.
2. Reference specific visual elements in your task description.
3. Note that the screenshot is attached to the task for developer reference.`;

// ─── Shared Configuration (appended to all tier prompts) ───────────────────

const SHARED_CONFIG = `

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

## Tone
- Direct. No fluff.
- Use JDE terminology: event, dealership, mail drop, gross profit, show rate, units sold, cost per piece, close rate, territory, zip code analysis.
- Never say "I'm just an AI" or "As an AI."
- Never apologize for limitations. Do it, preview it, or log it. Always move forward.

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
            .select("id, stock_number, customer_name, vehicle_year, vehicle_make, vehicle_model, salesperson, front_gross, back_gross, total_gross, status")
            .eq("event_id", eventId)
            .order("created_at", { ascending: false })
            .limit(20);

          if (deals && deals.length > 0) {
            const totalDeals = deals.length;
            const totalGross = deals.reduce((sum, d) => sum + (d.total_gross || 0), 0);
            const avgPvr = totalDeals > 0 ? Math.round(totalGross / totalDeals) : 0;
            const frontGross = deals.reduce((sum, d) => sum + (d.front_gross || 0), 0);
            const backGross = deals.reduce((sum, d) => sum + (d.back_gross || 0), 0);

            dataBlock += `\n\nDeal Log Summary (${totalDeals} deals):`;
            dataBlock += `\nTotal Gross: $${totalGross.toLocaleString()}`;
            dataBlock += `\nFront Gross: $${frontGross.toLocaleString()} | Back Gross: $${backGross.toLocaleString()}`;
            dataBlock += `\nAvg PVR: $${avgPvr.toLocaleString()}`;
            dataBlock += `\nRecent deals:`;
            deals.slice(0, 5).forEach((d) => {
              dataBlock += `\n  - ${d.customer_name || "N/A"}: ${d.vehicle_year} ${d.vehicle_make} ${d.vehicle_model} | ${d.salesperson || "N/A"} | $${(d.total_gross || 0).toLocaleString()} gross (${d.status})`;
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

  // 4. Extract user text from last message (supports both v6 parts and legacy content)
  const lastMessage = messages[messages.length - 1];
  let userText = "";
  if (typeof lastMessage?.content === "string") {
    userText = lastMessage.content;
  } else if (Array.isArray(lastMessage?.parts)) {
    userText = lastMessage.parts
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text)
      .join(" ");
  }

  // 5. Classify the message tier using Haiku (fast, ~$0.001/call)
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

  // 6. Convert messages to format streamText expects (role + content string)
  const formattedMessages = messages.map(
    (m: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => {
      let content = "";
      if (Array.isArray(m.parts)) {
        content = m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("");
      } else {
        content = m.content || "";
      }
      return { role: m.role as "user" | "assistant" | "system", content };
    },
  );

  // 7. Stream response from the appropriate model
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
