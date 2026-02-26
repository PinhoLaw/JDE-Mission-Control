"use server";

import { createClient } from "@/lib/supabase/server";
import type { AuditLog } from "@/types/database";

// ────────────────────────────────────────────────────────
// Log an audit event (non-blocking — never throws)
// ────────────────────────────────────────────────────────
export async function logAudit(
  eventId: string,
  action: "create" | "update" | "delete",
  entityType: "deal" | "vehicle" | "roster" | "config" | "lender",
  entityId: string | null,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null,
) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("audit_logs").insert({
      event_id: eventId,
      user_id: user?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_values: oldValues,
      new_values: newValues,
    });

    if (error) {
      console.error("[audit] Failed to insert audit log:", error.message);
    }
  } catch (err) {
    console.error("[audit] Unexpected error logging audit event:", err);
  }
}

// ────────────────────────────────────────────────────────
// Retrieve audit logs for an event (owner/manager only)
// ────────────────────────────────────────────────────────
export async function getAuditLogs(
  eventId: string,
  options?: { limit?: number; offset?: number; entityType?: string },
): Promise<{ logs: AuditLog[]; total: number }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Verify membership + role
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");
  if (!["owner", "manager"].includes(membership.role))
    throw new Error("Insufficient permissions");

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  // Build query
  let query = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.entityType) {
    query = query.eq("entity_type", options.entityType);
  }

  const { data, count, error } = await query;

  if (error) throw new Error(error.message);

  return {
    logs: (data ?? []) as AuditLog[],
    total: count ?? 0,
  };
}
