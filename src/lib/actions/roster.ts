"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireMembership(eventId: string, roles?: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: m } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();
  if (!m) throw new Error("Not a member of this event");
  if (roles && !roles.includes(m.role))
    throw new Error("Insufficient permissions");
  return { supabase, user };
}

export async function addRosterMember(
  eventId: string,
  data: {
    name: string;
    phone?: string;
    email?: string;
    role: "sales" | "team_leader" | "fi_manager" | "closer" | "manager";
    team?: string;
    commission_pct?: number;
  },
) {
  const { supabase } = await requireMembership(eventId, ["owner", "manager"]);
  const { data: inserted, error } = await supabase.from("roster").insert({
    event_id: eventId,
    name: data.name,
    phone: data.phone ?? null,
    email: data.email ?? null,
    role: data.role,
    team: data.team ?? null,
    commission_pct: data.commission_pct ?? null,
    confirmed: false,
    active: true,
  }).select("id").single();
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/roster");
  return { success: true, memberId: inserted.id };
}

export async function updateRosterMember(
  memberId: string,
  eventId: string,
  updates: Record<string, unknown>,
) {
  const { supabase } = await requireMembership(eventId, ["owner", "manager"]);
  const { error } = await supabase
    .from("roster")
    .update(updates)
    .eq("id", memberId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/roster");
  return { success: true };
}

export async function deleteRosterMember(memberId: string, eventId: string) {
  const { supabase } = await requireMembership(eventId, ["owner", "manager"]);
  const { error } = await supabase
    .from("roster")
    .delete()
    .eq("id", memberId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/roster");
  return { success: true };
}

export async function addLender(
  eventId: string,
  data: { name: string; buy_rate_pct?: number; max_advance?: number; notes?: string },
) {
  const { supabase } = await requireMembership(eventId, ["owner", "manager"]);
  const { error } = await supabase.from("lenders").insert({
    event_id: eventId,
    name: data.name,
    buy_rate_pct: data.buy_rate_pct ?? null,
    max_advance: data.max_advance ?? null,
    notes: data.notes ?? null,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/roster");
  return { success: true };
}

export async function updateLender(
  lenderId: string,
  eventId: string,
  updates: {
    name?: string;
    buy_rate_pct?: number | null;
    max_advance?: number | null;
    notes?: string | null;
    active?: boolean;
  },
) {
  const { supabase } = await requireMembership(eventId, ["owner", "manager"]);
  const { error } = await supabase
    .from("lenders")
    .update(updates)
    .eq("id", lenderId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/roster");
  return { success: true };
}

// ────────────────────────────────────────────────────────
// Fetch roster from another event (for "Copy from Event")
// ────────────────────────────────────────────────────────
export async function fetchRosterForEvent(eventId: string) {
  const { supabase } = await requireMembership(eventId);
  const { data, error } = await supabase
    .from("roster")
    .select("id, name, phone, email, role, team, commission_pct, notes")
    .eq("event_id", eventId)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ────────────────────────────────────────────────────────
// Bulk copy roster members from one event to another
// ────────────────────────────────────────────────────────
export async function copyRosterFromEvent(
  sourceEventId: string,
  targetEventId: string,
  memberIds: string[],
) {
  // Require manager/owner on target event
  const { supabase, user } = await requireMembership(targetEventId, [
    "owner",
    "manager",
  ]);

  // Verify membership on source event (read access)
  const { data: sourceMembership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", sourceEventId)
    .eq("user_id", user.id)
    .single();
  if (!sourceMembership) throw new Error("Not a member of source event");

  // 1. Fetch source members by selected IDs
  const { data: sourceMembers, error: fetchErr } = await supabase
    .from("roster")
    .select("id, name, phone, email, role, team, commission_pct, notes")
    .eq("event_id", sourceEventId)
    .in("id", memberIds);
  if (fetchErr) throw new Error(fetchErr.message);
  if (!sourceMembers || sourceMembers.length === 0) {
    return { inserted: [] as Array<{ id: string; name: string; phone: string | null; email: string | null; role: string; team: string | null; commission_pct: number | null; confirmed: boolean; active: boolean; notes: string | null }>, skippedCount: 0 };
  }

  // 2. Fetch existing target roster names for dedup
  const { data: existingMembers } = await supabase
    .from("roster")
    .select("name")
    .eq("event_id", targetEventId);
  const existingNames = new Set(
    (existingMembers ?? []).map((m) => m.name.toLowerCase().trim()),
  );

  // 3. Partition: insertable vs. skipped (by name dedup)
  const toInsert = sourceMembers.filter(
    (m) => !existingNames.has(m.name.toLowerCase().trim()),
  );
  const skippedCount = sourceMembers.length - toInsert.length;

  if (toInsert.length === 0) {
    return { inserted: [] as Array<{ id: string; name: string; phone: string | null; email: string | null; role: string; team: string | null; commission_pct: number | null; confirmed: boolean; active: boolean; notes: string | null }>, skippedCount };
  }

  // 4. Bulk insert
  const rows = toInsert.map((m) => ({
    event_id: targetEventId,
    name: m.name,
    phone: m.phone,
    email: m.email,
    role: m.role,
    team: m.team,
    commission_pct: m.commission_pct,
    notes: m.notes,
    confirmed: false,
    active: true,
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from("roster")
    .insert(rows)
    .select(
      "id, name, phone, email, role, team, commission_pct, confirmed, active, notes",
    );
  if (insertErr) throw new Error(insertErr.message);

  revalidatePath("/dashboard/roster");
  return { inserted: inserted ?? [], skippedCount };
}

// ────────────────────────────────────────────────────────
// Import roster members from a Google Sheet (upsert by ID)
// ────────────────────────────────────────────────────────
export async function importRosterMembers(
  eventId: string,
  members: Array<{
    id?: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    role: "manager" | "team_leader" | "fi_manager" | "sales" | "closer";
    team?: string | null;
    commission_pct?: number | null;
    notes?: string | null;
    confirmed?: boolean;
    active?: boolean;
  }>,
) {
  const { supabase } = await requireMembership(eventId, ["owner", "manager"]);

  // Fetch existing roster for this event (for dedup)
  const { data: existing } = await supabase
    .from("roster")
    .select("id, name")
    .eq("event_id", eventId);

  const existingIds = new Set((existing ?? []).map((m) => m.id));
  const existingNames = new Set(
    (existing ?? []).map((m) => m.name.toLowerCase().trim()),
  );

  const toUpdate: typeof members = [];
  const toInsert: typeof members = [];
  let skippedCount = 0;

  for (const member of members) {
    // If the member has an ID and it exists in our roster → update
    if (member.id && existingIds.has(member.id)) {
      toUpdate.push(member);
      continue;
    }
    // If a member with the same name already exists → skip
    if (existingNames.has(member.name.toLowerCase().trim())) {
      skippedCount++;
      continue;
    }
    // Otherwise → insert
    toInsert.push(member);
  }

  // Batch updates
  let updatedCount = 0;
  for (const member of toUpdate) {
    const { error } = await supabase
      .from("roster")
      .update({
        name: member.name,
        phone: member.phone ?? null,
        email: member.email ?? null,
        role: member.role,
        team: member.team ?? null,
        commission_pct: member.commission_pct ?? null,
        notes: member.notes ?? null,
        confirmed: member.confirmed ?? false,
        active: member.active ?? true,
      })
      .eq("id", member.id!)
      .eq("event_id", eventId);
    if (!error) updatedCount++;
  }

  // Batch insert
  let insertedCount = 0;
  if (toInsert.length > 0) {
    const rows = toInsert.map((m) => ({
      event_id: eventId,
      name: m.name,
      phone: m.phone ?? null,
      email: m.email ?? null,
      role: m.role,
      team: m.team ?? null,
      commission_pct: m.commission_pct ?? null,
      notes: m.notes ?? null,
      confirmed: m.confirmed ?? false,
      active: m.active ?? true,
    }));
    const { data: inserted, error } = await supabase
      .from("roster")
      .insert(rows)
      .select("id");
    if (!error) insertedCount = inserted?.length ?? 0;
  }

  revalidatePath("/dashboard/roster");
  return { insertedCount, updatedCount, skippedCount };
}

export async function deleteLender(lenderId: string, eventId: string) {
  const { supabase } = await requireMembership(eventId, ["owner", "manager"]);
  const { error } = await supabase
    .from("lenders")
    .delete()
    .eq("id", lenderId)
    .eq("event_id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/roster");
  return { success: true };
}
