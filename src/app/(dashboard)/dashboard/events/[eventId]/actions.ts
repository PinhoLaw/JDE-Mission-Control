"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ── Membership check helper ──
async function requireMembership(eventId: string, requiredRoles?: string[]) {
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

  if (requiredRoles && !requiredRoles.includes(membership.role)) {
    throw new Error(`Requires one of: ${requiredRoles.join(", ")}`);
  }

  return { supabase, user, role: membership.role };
}

export async function addVehicle(formData: FormData) {
  const eventId = formData.get("event_id") as string;
  if (!eventId) throw new Error("Event ID is required");

  const { supabase } = await requireMembership(eventId);

  const { error } = await supabase.from("vehicle_inventory").insert({
    event_id: eventId,
    stock_number: (formData.get("stock_number") as string) || null,
    vin: (formData.get("vin") as string) || null,
    year: formData.get("year") ? parseInt(formData.get("year") as string) : null,
    make: (formData.get("make") as string) || null,
    model: (formData.get("model") as string) || null,
    trim: (formData.get("trim") as string) || null,
    body_style: (formData.get("body_style") as string) || null,
    color: (formData.get("color") as string) || null,
    mileage: formData.get("mileage")
      ? parseInt(formData.get("mileage") as string)
      : null,
    acquisition_cost: formData.get("acquisition_cost")
      ? parseFloat(formData.get("acquisition_cost") as string)
      : null,
    notes: (formData.get("notes") as string) || null,
    status: "available" as const,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}

export async function updateVehicleStatus(
  vehicleId: string,
  status: "available" | "sold" | "hold" | "pending" | "wholesale",
  eventId: string,
) {
  const { supabase } = await requireMembership(eventId);

  const { error } = await supabase
    .from("vehicle_inventory")
    .update({ status })
    .eq("id", vehicleId)
    .eq("event_id", eventId); // SECURITY: always scope by event_id

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}

export async function addDeal(formData: FormData) {
  const eventId = formData.get("event_id") as string;
  if (!eventId) throw new Error("Event ID is required");

  const { supabase } = await requireMembership(eventId);

  const { error } = await supabase.from("sales_deals").insert({
    event_id: eventId,
    customer_name: (formData.get("customer_name") as string) || null,
    customer_zip: (formData.get("customer_zip") as string) || null,
    stock_number: (formData.get("stock_number") as string) || null,
    vehicle_year: formData.get("vehicle_year")
      ? parseInt(formData.get("vehicle_year") as string)
      : null,
    vehicle_make: (formData.get("vehicle_make") as string) || null,
    vehicle_model: (formData.get("vehicle_model") as string) || null,
    salesperson: (formData.get("salesperson") as string) || null,
    selling_price: formData.get("selling_price")
      ? parseFloat(formData.get("selling_price") as string)
      : null,
    front_gross: formData.get("front_gross")
      ? parseFloat(formData.get("front_gross") as string)
      : null,
    lender: (formData.get("lender") as string) || null,
    notes: (formData.get("notes") as string) || null,
    status: "pending" as const,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}
