"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireOwnerOrManager(eventId: string) {
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
  if (!m || !["owner", "manager"].includes(m.role))
    throw new Error("Only owners and managers can change settings");
  return { supabase, user };
}

export async function updateEventConfig(
  eventId: string,
  updates: {
    doc_fee?: number | null;
    tax_rate?: number | null;
    pack?: number | null;
    jde_commission_pct?: number | null;
    rep_commission_pct?: number | null;
    mail_campaign_name?: string | null;
    mail_pieces_sent?: number | null;
    target_units?: number | null;
    target_gross?: number | null;
    target_pvr?: number | null;
    washout_threshold?: number | null;
  },
) {
  const { supabase } = await requireOwnerOrManager(eventId);

  // Upsert: create config if doesn't exist
  const { data: existing } = await supabase
    .from("event_config")
    .select("id")
    .eq("event_id", eventId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("event_config")
      .update(updates)
      .eq("event_id", eventId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("event_config")
      .insert({ event_id: eventId, ...updates });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateEventDetails(
  eventId: string,
  updates: {
    name?: string;
    dealer_name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    franchise?: string | null;
    sale_days?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    status?: "draft" | "active" | "completed" | "cancelled";
  },
) {
  const { supabase } = await requireOwnerOrManager(eventId);
  const { error } = await supabase
    .from("events")
    .update(updates)
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { success: true };
}
