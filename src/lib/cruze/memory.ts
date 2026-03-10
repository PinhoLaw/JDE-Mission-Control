// CRUZE UPGRADE — OMNISCIENT MODE
// Persistent memory system: conversations + long-term memory extraction
//
// NOTE: The cruze_* tables are created by migration 20260310120000.
// Until database.ts types are regenerated, we use `as never` casts
// for Supabase queries on the new tables. This is safe and expected.

import { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CruzeConversation {
  id: string;
  user_id: string;
  event_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface CruzeMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CruzeMemory {
  id: string;
  user_id: string;
  event_id: string | null;
  content: string;
  category: "preference" | "insight" | "question" | "fact" | "general";
  importance: number;
  access_count: number;
  created_at: string;
}

// Helper to bypass Supabase type checking for new tables
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromTable(supabase: SupabaseClient, table: string): any {
  return supabase.from(table as never);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpcCall(supabase: SupabaseClient, fn: string, params: Record<string, unknown>): any {
  return supabase.rpc(fn as never, params as never);
}

// ─── Conversation Management ────────────────────────────────────────────────

/** Get or create a conversation for the current session */
export async function getOrCreateConversation(
  supabase: SupabaseClient,
  userId: string,
  eventId: string | null,
): Promise<string> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  let query = fromTable(supabase, "cruze_conversations")
    .select("id")
    .eq("user_id", userId)
    .gte("updated_at", twoHoursAgo)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (eventId) {
    query = query.eq("event_id", eventId);
  }

  const { data: existing } = await query;

  if (existing && existing.length > 0) {
    await fromTable(supabase, "cruze_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", existing[0].id);
    return existing[0].id;
  }

  const { data: created, error } = await fromTable(supabase, "cruze_conversations")
    .insert({ user_id: userId, event_id: eventId })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[Cruze Memory] Failed to create conversation:", error);
    throw new Error("Failed to create conversation");
  }

  return created.id;
}

/** Save a message to the conversation */
export async function saveMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const { error } = await fromTable(supabase, "cruze_messages").insert({
    conversation_id: conversationId,
    role,
    content,
    metadata: metadata || {},
  });

  if (error) {
    console.error("[Cruze Memory] Failed to save message:", error);
  }
}

/** Get recent messages from past conversations for memory context */
export async function getConversationHistory(
  supabase: SupabaseClient,
  userId: string,
  eventId: string | null,
  limit = 20,
): Promise<CruzeMessage[]> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: conversations } = await fromTable(supabase, "cruze_conversations")
    .select("id")
    .eq("user_id", userId)
    .gte("created_at", weekAgo)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (!conversations || conversations.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convIds = conversations.map((c: any) => c.id);

  const { data: messages } = await fromTable(supabase, "cruze_messages")
    .select("*")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (messages || []).reverse() as CruzeMessage[];
}

// ─── Long-Term Memory ───────────────────────────────────────────────────────

/** Get relevant memories for the current context */
export async function getRelevantMemories(
  supabase: SupabaseClient,
  userId: string,
  eventId: string | null,
  limit = 10,
): Promise<CruzeMemory[]> {
  const { data, error } = await rpcCall(supabase, "get_recent_cruze_memories", {
    p_user_id: userId,
    p_event_id: eventId,
    p_limit: limit,
  });

  if (error) {
    console.warn("[Cruze Memory] RPC failed, falling back to direct query:", error.message);
    const { data: fallback } = await fromTable(supabase, "cruze_memories")
      .select("*")
      .eq("user_id", userId)
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);
    return (fallback || []) as CruzeMemory[];
  }

  return (data || []) as CruzeMemory[];
}

/** Save a new memory */
export async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  eventId: string | null,
  content: string,
  category: CruzeMemory["category"] = "general",
  importance = 5,
): Promise<void> {
  // Check for duplicate/similar memory (simple text match)
  const { data: existing } = await fromTable(supabase, "cruze_memories")
    .select("id, content, access_count")
    .eq("user_id", userId)
    .ilike("content", `%${content.slice(0, 50)}%`)
    .limit(1);

  if (existing && existing.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prev = (existing[0] as any).access_count;
    await fromTable(supabase, "cruze_memories")
      .update({
        content,
        importance: Math.min(importance + 1, 10),
        access_count: typeof prev === "number" ? prev + 1 : 1,
      })
      .eq("id", existing[0].id);
    return;
  }

  const { error } = await fromTable(supabase, "cruze_memories").insert({
    user_id: userId,
    event_id: eventId,
    content,
    category,
    importance,
  });

  if (error) {
    console.error("[Cruze Memory] Failed to save memory:", error);
  }
}

// ─── Memory Extraction ─────────────────────────────────────────────────────

/**
 * Extract memorable facts from a conversation exchange.
 * Called after each assistant response to identify things worth remembering.
 * Returns extraction prompt for Claude to process inline.
 */
export function buildMemoryExtractionPrompt(
  userMessage: string,
  assistantResponse: string,
): string {
  return `Analyze this exchange and extract any facts worth remembering about the user for future conversations. Return a JSON array of memories, or an empty array if nothing is notable.

Each memory should have:
- "content": A concise statement (1 sentence)
- "category": One of "preference", "insight", "question", "fact"
- "importance": 1-10 (10 = critical business fact, 1 = minor detail)

Only extract things that would be useful in future conversations:
- User preferences ("Mike prefers seeing gross before FI")
- Business insights ("Michigan City Ford averages 60 units per event")
- Recurring questions (patterns the user asks about often)
- Key facts ("Doc fee is typically $599 for this market")

DO NOT extract:
- Generic greetings or small talk
- One-time data lookups
- Information already in the database

User: ${userMessage}
Assistant: ${assistantResponse}

Return ONLY a JSON array. Example: [{"content":"Mike tracks warranty penetration daily","category":"preference","importance":6}]
If nothing notable, return: []`;
}

// ─── Format Memory Context ──────────────────────────────────────────────────

/** Format memories into a context block for the system prompt */
export function formatMemoryBlock(
  memories: CruzeMemory[],
  recentHistory: CruzeMessage[],
): string {
  if (memories.length === 0 && recentHistory.length === 0) return "";

  let block = "\n\n[MEMORY]";

  if (memories.length > 0) {
    block += "\nLong-term memories about this user:";
    memories.forEach((m) => {
      block += `\n- [${m.category}] ${m.content}`;
    });
  }

  if (recentHistory.length > 0) {
    block += "\n\nRecent conversation highlights (past sessions):";
    const recentPairs = recentHistory.slice(-6);
    recentPairs.forEach((msg) => {
      const prefix = msg.role === "user" ? "User asked" : "You answered";
      const truncated = msg.content.length > 150
        ? msg.content.slice(0, 150) + "..."
        : msg.content;
      block += `\n- ${prefix}: ${truncated}`;
    });
  }

  block += "\n[/MEMORY]";
  return block;
}
