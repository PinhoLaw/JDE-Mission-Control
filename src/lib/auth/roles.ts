/**
 * Shared role-based authorization helper for JDE Mission Control.
 *
 * Works in both API routes and server actions — accepts a Supabase
 * client instance so the caller controls how it's created.
 *
 * Usage:
 *   const role = await requireEventRole(supabase, userId, eventId);
 *   const role = await requireEventRole(supabase, userId, eventId, ["owner", "manager"]);
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type EventRole = "owner" | "manager" | "member";

// ────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────

export class NotMemberError extends Error {
  constructor(eventId: string) {
    super(`Not a member of event ${eventId}`);
    this.name = "NotMemberError";
  }
}

export class InsufficientRoleError extends Error {
  /** The user's actual role */
  actualRole: EventRole;
  /** The roles that were required */
  requiredRoles: EventRole[];

  constructor(actualRole: EventRole, requiredRoles: EventRole[]) {
    super(
      `Insufficient permissions: role "${actualRole}" not in [${requiredRoles.join(", ")}]`,
    );
    this.name = "InsufficientRoleError";
    this.actualRole = actualRole;
    this.requiredRoles = requiredRoles;
  }
}

// ────────────────────────────────────────────────────────────
// Main helper
// ────────────────────────────────────────────────────────────

/**
 * Verify a user is a member of the given event, optionally
 * requiring specific roles.
 *
 * @param supabase - Authenticated Supabase client
 * @param userId   - The user's UUID (from auth.getUser())
 * @param eventId  - The event to check membership for
 * @param allowedRoles - If provided, the user's role must be
 *                       in this list or an InsufficientRoleError
 *                       is thrown.
 * @returns The user's role for the event
 * @throws NotMemberError if the user is not a member
 * @throws InsufficientRoleError if the role doesn't match
 */
export async function requireEventRole(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  allowedRoles?: EventRole[],
): Promise<EventRole> {
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .single();

  if (!membership) {
    throw new NotMemberError(eventId);
  }

  const role = membership.role as EventRole;

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new InsufficientRoleError(role, allowedRoles);
  }

  return role;
}
