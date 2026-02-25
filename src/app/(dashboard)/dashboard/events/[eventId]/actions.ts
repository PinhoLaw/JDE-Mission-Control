"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function addInventoryItem(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const eventId = formData.get("event_id") as string;
  const name = formData.get("name") as string;
  const category = formData.get("category") as string;
  const quantity = parseInt(formData.get("quantity") as string) || 1;
  const unitCost = formData.get("unit_cost") as string;
  const description = (formData.get("description") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!name || !eventId) throw new Error("Name and event are required");

  const { error } = await supabase.from("inventory").insert({
    event_id: eventId,
    name,
    category: category as "vehicle" | "equipment" | "swag" | "signage" | "other",
    quantity,
    unit_cost: unitCost ? parseFloat(unitCost) : null,
    description,
    notes,
    status: "available",
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}

export async function markAsSold(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const eventId = formData.get("event_id") as string;
  const inventoryId = formData.get("inventory_id") as string;
  const vehicleName = formData.get("vehicle_name") as string;
  const salePrice = parseFloat(formData.get("sale_price") as string);
  const buyerName = (formData.get("buyer_name") as string) || null;
  const buyerEmail = (formData.get("buyer_email") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!eventId || !inventoryId || isNaN(salePrice)) {
    throw new Error("Missing required fields");
  }

  // Create a deal record for the sale
  const { error: dealError } = await supabase.from("deals").insert({
    event_id: eventId,
    company_name: vehicleName,
    contact_name: buyerName,
    contact_email: buyerEmail,
    stage: "paid",
    value: salePrice,
    deal_type: "vendor",
    notes: notes ? `Inventory: ${inventoryId}\n${notes}` : `Inventory: ${inventoryId}`,
    closed_at: new Date().toISOString(),
    created_by: user.id,
  });

  if (dealError) throw new Error(dealError.message);

  // Mark inventory item as sold (retired)
  const { error: invError } = await supabase
    .from("inventory")
    .update({ status: "retired" })
    .eq("id", inventoryId);

  if (invError) throw new Error(invError.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}

type InventoryStatus = "available" | "in_use" | "reserved" | "damaged" | "retired";

export async function updateInventoryStatus(
  inventoryId: string,
  status: InventoryStatus,
  eventId: string,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory")
    .update({ status })
    .eq("id", inventoryId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}
