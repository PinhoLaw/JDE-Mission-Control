"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
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
// Allowlist of fields that can be inline-edited to prevent arbitrary field injection
const EDITABLE_VEHICLE_FIELDS = new Set([
  "hat_number", "stock_number", "vin", "year", "make", "model", "trim",
  "body_style", "color", "mileage", "age_days", "drivetrain", "location",
  "acquisition_cost", "jd_trade_clean", "jd_retail_clean",
  "asking_price_115", "asking_price_120", "asking_price_125", "asking_price_130",
  "profit_115", "profit_120", "profit_125", "profit_130",
  "retail_spread", "sold_price", "sold_date", "sold_to",
  "status", "label", "notes", "photo_url",
]);

export async function updateVehicleField(
  vehicleId: string,
  eventId: string,
  field: string,
  value: unknown,
) {
  // Input sanitization: only allow known fields
  if (!EDITABLE_VEHICLE_FIELDS.has(field)) {
    throw new Error(`Field "${field}" is not editable`);
  }

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

// ────────────────────────────────────────────────────────
// Sync inventory status from deals (batch cross-reference)
// ────────────────────────────────────────────────────────

/**
 * Cross-references deal stock numbers against vehicle_inventory
 * and marks matching vehicles as "sold". Uses the service role
 * client to bypass RLS (same pattern as getDealsPerZip).
 *
 * Call this after bulk importing deals or to run a one-time sync.
 */
export async function syncInventoryFromDeals(eventId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("[syncInventoryFromDeals] Missing Supabase env vars");
    return { markedSold: 0 };
  }

  const admin = createServiceClient(url, serviceKey);

  // 1. Get all deal stock numbers for this event (exclude cancelled/unwound)
  const { data: deals } = await admin
    .from("sales_deals")
    .select("stock_number, customer_name, selling_price, sale_date, status")
    .eq("event_id", eventId)
    .not("stock_number", "is", null)
    .not("status", "in", '("cancelled","unwound")');

  if (!deals || deals.length === 0) return { markedSold: 0 };

  // 2. Get all inventory vehicles for this event
  const { data: vehicles } = await admin
    .from("vehicle_inventory")
    .select("id, stock_number, status")
    .eq("event_id", eventId);

  if (!vehicles || vehicles.length === 0) return { markedSold: 0 };

  // 3. Build lookup: stock_number (uppercase) → deal info
  const dealByStock = new Map<string, (typeof deals)[number]>();
  for (const d of deals) {
    const key = d.stock_number?.trim().toUpperCase();
    if (key) dealByStock.set(key, d);
  }

  // 4. For each vehicle, check if it has a matching active deal
  type DealInfo = (typeof deals)[number];
  const toMarkSold: { id: string; deal: DealInfo }[] = [];
  for (const v of vehicles) {
    const key = v.stock_number?.trim().toUpperCase();
    if (!key) continue;
    const deal = dealByStock.get(key);
    if (deal && v.status !== "sold") {
      toMarkSold.push({ id: v.id, deal });
    }
  }

  // 5. Batch update — mark matched vehicles as sold
  let markedSold = 0;
  for (const item of toMarkSold) {
    const { error } = await admin
      .from("vehicle_inventory")
      .update({
        status: "sold" as const,
        sold_to: item.deal.customer_name,
        sold_price: item.deal.selling_price,
        sold_date:
          item.deal.sale_date ?? new Date().toISOString().split("T")[0],
      })
      .eq("id", item.id);

    if (!error) markedSold++;
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");

  return { markedSold };
}

// ────────────────────────────────────────────────────────
// Auto-create trade vehicle in inventory from deal data
// ────────────────────────────────────────────────────────

/**
 * Create a vehicle_inventory record for a trade-in from deal data.
 * Returns the new vehicle ID, or null if insufficient data.
 */
export async function createTradeVehicle(
  eventId: string,
  trade: {
    year: number | null;
    make: string | null;
    model: string | null;
    type: string | null;
    mileage: number | null;
    acv: number | null;
  },
): Promise<string | null> {
  // Require at least make or model to create a vehicle record
  if (!trade.make && !trade.model) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const admin = createServiceClient(url, serviceKey);

  const { data, error } = await admin
    .from("vehicle_inventory")
    .insert({
      event_id: eventId,
      year: trade.year,
      make: trade.make,
      model: trade.model,
      body_style: trade.type,
      mileage: trade.mileage,
      acquisition_cost: trade.acv,
      status: "available" as const,
      label: "TRADE",
      notes: "Auto-created from trade-in",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createTradeVehicle]", error.message);
    return null;
  }
  return data?.id ?? null;
}
