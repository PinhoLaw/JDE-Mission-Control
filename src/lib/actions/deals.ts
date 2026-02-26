"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ────────────────────────────────────────────────────────
// Zod schema for new deal form
// ────────────────────────────────────────────────────────
const newDealSchema = z.object({
  event_id: z.string().uuid(),
  vehicle_id: z.string().uuid().optional().nullable(),
  deal_number: z.coerce.number().int().positive().optional().nullable(),
  sale_day: z.coerce.number().int().min(1).max(12).optional().nullable(),
  sale_date: z.string().optional().nullable(),
  customer_name: z.string().min(1, "Customer name is required"),
  customer_zip: z.string().optional().nullable(),
  customer_phone: z.string().optional().nullable(),
  stock_number: z.string().optional().nullable(),
  vehicle_year: z.coerce.number().int().optional().nullable(),
  vehicle_make: z.string().optional().nullable(),
  vehicle_model: z.string().optional().nullable(),
  vehicle_type: z.string().optional().nullable(),
  vehicle_cost: z.coerce.number().optional().nullable(),
  new_used: z.enum(["New", "Used", "Certified"]).default("Used"),
  trade_year: z.coerce.number().int().optional().nullable(),
  trade_make: z.string().optional().nullable(),
  trade_model: z.string().optional().nullable(),
  trade_type: z.string().optional().nullable(),
  trade_mileage: z.coerce.number().optional().nullable(),
  trade_acv: z.coerce.number().optional().nullable(),
  trade_payoff: z.coerce.number().optional().nullable(),
  salesperson: z.string().optional().nullable(),
  salesperson_id: z.string().uuid().optional().nullable(),
  salesperson_pct: z.coerce.number().optional().nullable(),
  second_salesperson: z.string().optional().nullable(),
  second_sp_id: z.string().uuid().optional().nullable(),
  second_sp_pct: z.coerce.number().optional().nullable(),
  selling_price: z.coerce.number().min(0, "Selling price required"),
  front_gross: z.coerce.number().optional().nullable(),
  lender: z.string().optional().nullable(),
  rate: z.coerce.number().optional().nullable(),
  finance_type: z.enum(["retail", "lease", "cash"]).default("retail"),
  reserve: z.coerce.number().optional().nullable(),
  warranty: z.coerce.number().optional().nullable(),
  gap: z.coerce.number().optional().nullable(),
  aftermarket_1: z.coerce.number().optional().nullable(),
  aftermarket_2: z.coerce.number().optional().nullable(),
  doc_fee: z.coerce.number().optional().nullable(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type NewDealInput = z.infer<typeof newDealSchema>;

// ────────────────────────────────────────────────────────
// Create a new sales deal
// ────────────────────────────────────────────────────────
export async function createDeal(input: NewDealInput) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Verify membership
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", input.event_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  // Parse/validate
  const parsed = newDealSchema.safeParse(input);
  if (!parsed.success) {
    const errs = parsed.error.issues.map((e) => `${e.path}: ${e.message}`);
    throw new Error(errs.join("; "));
  }

  const d = parsed.data;

  // Auto-calculations
  const frontGross =
    d.front_gross ?? (d.selling_price ?? 0) - (d.vehicle_cost ?? 0);
  const fiTotal =
    (d.reserve ?? 0) +
    (d.warranty ?? 0) +
    (d.gap ?? 0) +
    (d.aftermarket_1 ?? 0) +
    (d.aftermarket_2 ?? 0);
  const backGross = fiTotal + (d.doc_fee ?? 0);
  const totalGross = frontGross + backGross;
  const pvr = totalGross; // PVR = total gross per vehicle retailed (single deal = total_gross)

  // Washout detection: front_gross < 0
  const isWashout = frontGross < 0;
  const washoutAmount = isWashout ? Math.abs(frontGross) : 0;

  const { data: deal, error } = await supabase
    .from("sales_deals")
    .insert({
      event_id: d.event_id,
      vehicle_id: d.vehicle_id ?? null,
      deal_number: d.deal_number ?? null,
      sale_day: d.sale_day ?? null,
      sale_date: d.sale_date ?? null,
      customer_name: d.customer_name,
      customer_zip: d.customer_zip ?? null,
      customer_phone: d.customer_phone ?? null,
      stock_number: d.stock_number ?? null,
      vehicle_year: d.vehicle_year ?? null,
      vehicle_make: d.vehicle_make ?? null,
      vehicle_model: d.vehicle_model ?? null,
      vehicle_type: d.vehicle_type ?? null,
      vehicle_cost: d.vehicle_cost ?? null,
      new_used: d.new_used,
      trade_year: d.trade_year ?? null,
      trade_make: d.trade_make ?? null,
      trade_model: d.trade_model ?? null,
      trade_type: d.trade_type ?? null,
      trade_mileage: d.trade_mileage ?? null,
      trade_acv: d.trade_acv ?? null,
      trade_payoff: d.trade_payoff ?? null,
      salesperson: d.salesperson ?? null,
      salesperson_id: d.salesperson_id ?? null,
      salesperson_pct: d.salesperson_pct ?? null,
      second_salesperson: d.second_salesperson ?? null,
      second_sp_id: d.second_sp_id ?? null,
      second_sp_pct: d.second_sp_pct ?? null,
      selling_price: d.selling_price,
      front_gross: frontGross,
      lender: d.lender ?? null,
      rate: d.rate ?? null,
      finance_type: d.finance_type,
      reserve: d.reserve ?? null,
      warranty: d.warranty ?? null,
      gap: d.gap ?? null,
      aftermarket_1: d.aftermarket_1 ?? null,
      aftermarket_2: d.aftermarket_2 ?? null,
      doc_fee: d.doc_fee ?? null,
      fi_total: fiTotal,
      back_gross: backGross,
      total_gross: totalGross,
      pvr: pvr,
      is_washout: isWashout,
      washout_amount: isWashout ? washoutAmount : null,
      source: d.source ?? null,
      notes: d.notes ?? null,
      status: "pending" as const,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  // If there's a vehicle_id, mark it as sold
  if (d.vehicle_id) {
    await supabase
      .from("vehicle_inventory")
      .update({
        status: "sold" as const,
        sold_price: d.selling_price,
        sold_date: d.sale_date ?? new Date().toISOString().split("T")[0],
        sold_to: d.customer_name,
      })
      .eq("id", d.vehicle_id)
      .eq("event_id", d.event_id);
  }

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");

  return { success: true, dealId: deal.id };
}

// ────────────────────────────────────────────────────────
// Look up vehicle by stock number for deal form
// ────────────────────────────────────────────────────────
export async function lookupVehicle(stockNumber: string, eventId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: vehicle } = await supabase
    .from("vehicle_inventory")
    .select("*")
    .eq("event_id", eventId)
    .ilike("stock_number", stockNumber)
    .eq("status", "available")
    .single();

  return vehicle;
}
