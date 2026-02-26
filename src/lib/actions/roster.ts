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
  const { error } = await supabase.from("roster").insert({
    event_id: eventId,
    name: data.name,
    phone: data.phone ?? null,
    email: data.email ?? null,
    role: data.role,
    team: data.team ?? null,
    commission_pct: data.commission_pct ?? null,
    confirmed: false,
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/roster");
  return { success: true };
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
