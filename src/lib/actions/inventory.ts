"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ────────────────────────────────────────────────────────
// Update vehicle status (single or bulk)
// ────────────────────────────────────────────────────────
export async function updateVehicleStatus(
  vehicleIds: string[],
  status: "available" | "sold" | "hold" | "pending" | "wholesale",
  eventId: string,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Verify membership
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  const { error } = await supabase
    .from("vehicle_inventory")
    .update({ status })
    .in("id", vehicleIds)
    .eq("event_id", eventId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { success: true, count: vehicleIds.length };
}

// ────────────────────────────────────────────────────────
// Delete vehicles (bulk)
// ────────────────────────────────────────────────────────
export async function deleteVehicles(vehicleIds: string[], eventId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Only owner/manager can delete
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("Only owners and managers can delete vehicles");
  }

  const { error } = await supabase
    .from("vehicle_inventory")
    .delete()
    .in("id", vehicleIds)
    .eq("event_id", eventId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { success: true, count: vehicleIds.length };
}

// ────────────────────────────────────────────────────────
// Update a single vehicle field (inline edit)
// ────────────────────────────────────────────────────────
export async function updateVehicleField(
  vehicleId: string,
  eventId: string,
  field: string,
  value: unknown,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  const { error } = await supabase
    .from("vehicle_inventory")
    .update({ [field]: value })
    .eq("id", vehicleId)
    .eq("event_id", eventId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/inventory");
  return { success: true };
}
