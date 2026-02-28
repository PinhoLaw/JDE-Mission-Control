"use server";

import { createClient } from "@/lib/supabase/server";
import type { AuditLog } from "@/types/database";

// ────────────────────────────────────────────────────────
// Action / entity type unions
// ────────────────────────────────────────────────────────

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "sheet_read"
  | "sheet_append"
  | "sheet_update"
  | "sheet_delete"
  | "sheet_write";

export type AuditEntityType =
  | "deal"
  | "vehicle"
  | "roster"
  | "config"
  | "lender"
  | "sheet";

// ────────────────────────────────────────────────────────
// Log an audit event (non-blocking — never throws)
// Called from server actions
// ────────────────────────────────────────────────────────
export async function logAudit(
  eventId: string,
  action: AuditAction,
  entityType: AuditEntityType,
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
// Log a sheet audit event (used from /api/sheets route)
// Accepts userId directly so it works outside server actions
// ────────────────────────────────────────────────────────
export async function logSheetAudit(params: {
  userId: string;
  eventId: string | null;
  action: AuditAction;
  sheetTitle: string;
  spreadsheetId?: string;
  changes?: Record<string, unknown> | null;
  /** The user's event role at the time of the action */
  role?: string;
}) {
  try {
    if (!params.eventId) return; // Can't log without an event scope

    const supabase = await createClient();

    const { error } = await supabase.from("audit_logs").insert({
      event_id: params.eventId,
      user_id: params.userId,
      action: params.action,
      entity_type: "sheet" as const,
      entity_id: params.spreadsheetId ?? null,
      old_values: null,
      new_values: {
        sheetTitle: params.sheetTitle,
        ...(params.role ? { role: params.role } : {}),
        ...(params.changes ?? {}),
      },
    });

    if (error) {
      console.error("[audit] Sheet audit insert failed:", error.message);
    }
  } catch (err) {
    console.error("[audit] Sheet audit unexpected error:", err);
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
