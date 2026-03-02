"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { evaluateBadges, updateStreak } from "@/lib/actions/gamification";
import type { EarnedBadge } from "@/lib/actions/gamification";

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
  ups_count: z.coerce.number().int().min(1).default(1),
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

  // Resolve salesperson name from roster ID (ensures text cache is always correct)
  if (d.salesperson_id) {
    const { data: member } = await supabase
      .from("roster")
      .select("name")
      .eq("id", d.salesperson_id)
      .single();
    if (member) d.salesperson = member.name;
  }
  if (d.second_sp_id) {
    const { data: member } = await supabase
      .from("roster")
      .select("name")
      .eq("id", d.second_sp_id)
      .single();
    if (member) d.second_salesperson = member.name;
  }

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
      ups_count: d.ups_count ?? 1,
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
  // Fallback: match by stock_number if no vehicle_id
  else if (d.stock_number) {
    await supabase
      .from("vehicle_inventory")
      .update({
        status: "sold" as const,
        sold_price: d.selling_price,
        sold_date: d.sale_date ?? new Date().toISOString().split("T")[0],
        sold_to: d.customer_name,
      })
      .eq("event_id", d.event_id)
      .ilike("stock_number", d.stock_number);
  }

  // ── Gamification: evaluate badges & update streak ──
  let newBadges: EarnedBadge[] = [];
  if (d.salesperson_id) {
    try {
      const saleDate = d.sale_date ?? new Date().toISOString().split("T")[0];
      const [evalResult] = await Promise.all([
        evaluateBadges(d.event_id, d.salesperson_id),
        updateStreak(d.event_id, d.salesperson_id, saleDate),
      ]);
      newBadges = evalResult.newBadges;
    } catch (err) {
      // Gamification failure NEVER blocks deal creation
      console.error("[gamification] createDeal:", err);
    }
  }
  // Also evaluate for second salesperson on split deals
  if (d.second_sp_id) {
    try {
      const saleDate = d.sale_date ?? new Date().toISOString().split("T")[0];
      await Promise.all([
        evaluateBadges(d.event_id, d.second_sp_id),
        updateStreak(d.event_id, d.second_sp_id, saleDate),
      ]);
    } catch (err) {
      console.error("[gamification] createDeal second_sp:", err);
    }
  }

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/achievements");

  return { success: true, dealId: deal.id, newBadges };
}

// ────────────────────────────────────────────────────────
// Update an existing sales deal
// ────────────────────────────────────────────────────────
const updateDealSchema = newDealSchema.extend({
  id: z.string().uuid(),
});

export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export async function updateDeal(input: UpdateDealInput) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", input.event_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  const parsed = updateDealSchema.safeParse(input);
  if (!parsed.success) {
    const errs = parsed.error.issues.map((e) => `${e.path}: ${e.message}`);
    throw new Error(errs.join("; "));
  }

  const d = parsed.data;

  // Resolve salesperson name from roster ID (ensures text cache is always correct)
  if (d.salesperson_id) {
    const { data: member } = await supabase
      .from("roster")
      .select("name")
      .eq("id", d.salesperson_id)
      .single();
    if (member) d.salesperson = member.name;
  }
  if (d.second_sp_id) {
    const { data: member } = await supabase
      .from("roster")
      .select("name")
      .eq("id", d.second_sp_id)
      .single();
    if (member) d.second_salesperson = member.name;
  }

  // Auto-calculations (same as createDeal)
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
  const pvr = totalGross;

  const isWashout = frontGross < 0;
  const washoutAmount = isWashout ? Math.abs(frontGross) : 0;

  const { data: deal, error } = await supabase
    .from("sales_deals")
    .update({
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
      ups_count: d.ups_count ?? 1,
      source: d.source ?? null,
      notes: d.notes ?? null,
    })
    .eq("id", d.id)
    .eq("event_id", d.event_id)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  // Sync inventory — mark matched vehicle as sold
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
  } else if (d.stock_number) {
    await supabase
      .from("vehicle_inventory")
      .update({
        status: "sold" as const,
        sold_price: d.selling_price,
        sold_date: d.sale_date ?? new Date().toISOString().split("T")[0],
        sold_to: d.customer_name,
      })
      .eq("event_id", d.event_id)
      .ilike("stock_number", d.stock_number);
  }

  // ── Gamification: re-evaluate badges after update ──
  let newBadges: EarnedBadge[] = [];
  if (d.salesperson_id) {
    try {
      const saleDate = d.sale_date ?? new Date().toISOString().split("T")[0];
      const [evalResult] = await Promise.all([
        evaluateBadges(d.event_id, d.salesperson_id),
        updateStreak(d.event_id, d.salesperson_id, saleDate),
      ]);
      newBadges = evalResult.newBadges;
    } catch (err) {
      console.error("[gamification] updateDeal:", err);
    }
  }
  if (d.second_sp_id) {
    try {
      const saleDate = d.sale_date ?? new Date().toISOString().split("T")[0];
      await Promise.all([
        evaluateBadges(d.event_id, d.second_sp_id),
        updateStreak(d.event_id, d.second_sp_id, saleDate),
      ]);
    } catch (err) {
      console.error("[gamification] updateDeal second_sp:", err);
    }
  }

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/achievements");

  return { success: true, dealId: deal.id, newBadges };
}

// ────────────────────────────────────────────────────────
// Quick status update (for inline dropdown)
// ────────────────────────────────────────────────────────
const VALID_STATUSES = ["pending", "funded", "unwound", "cancelled"] as const;

export async function updateDealStatus(
  dealId: string,
  eventId: string,
  status: string,
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

  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new Error(`Invalid status: ${status}`);
  }

  const { error } = await supabase
    .from("sales_deals")
    .update({ status: status as "pending" | "funded" | "unwound" | "cancelled" })
    .eq("id", dealId)
    .eq("event_id", eventId);

  if (error) throw new Error(error.message);

  // Sync inventory based on deal status change
  if (status === "cancelled" || status === "unwound") {
    // Restore vehicle to "available"
    const { data: deal } = await supabase
      .from("sales_deals")
      .select("vehicle_id, stock_number")
      .eq("id", dealId)
      .single();

    if (deal?.vehicle_id) {
      await supabase
        .from("vehicle_inventory")
        .update({
          status: "available" as const,
          sold_to: null,
          sold_price: null,
          sold_date: null,
        })
        .eq("id", deal.vehicle_id)
        .eq("event_id", eventId);
    } else if (deal?.stock_number) {
      await supabase
        .from("vehicle_inventory")
        .update({
          status: "available" as const,
          sold_to: null,
          sold_price: null,
          sold_date: null,
        })
        .eq("event_id", eventId)
        .ilike("stock_number", deal.stock_number);
    }
  } else if (status === "funded" || status === "pending") {
    // Re-mark vehicle as sold (e.g. after un-unwinding)
    const { data: deal } = await supabase
      .from("sales_deals")
      .select("vehicle_id, stock_number, selling_price, sale_date, customer_name")
      .eq("id", dealId)
      .single();

    if (deal?.vehicle_id) {
      await supabase
        .from("vehicle_inventory")
        .update({
          status: "sold" as const,
          sold_to: deal.customer_name,
          sold_price: deal.selling_price,
          sold_date: deal.sale_date,
        })
        .eq("id", deal.vehicle_id)
        .eq("event_id", eventId);
    } else if (deal?.stock_number) {
      await supabase
        .from("vehicle_inventory")
        .update({
          status: "sold" as const,
          sold_to: deal.customer_name,
          sold_price: deal.selling_price,
          sold_date: deal.sale_date,
        })
        .eq("event_id", eventId)
        .ilike("stock_number", deal.stock_number);
    }
  }

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");

  return { success: true };
}

// ────────────────────────────────────────────────────────
// Fetch deal counts per zip code (for Campaigns page)
// Uses service role to bypass RLS — this is a read-only
// aggregate query and runs server-side only.
// ────────────────────────────────────────────────────────
export async function getDealsPerZip(eventId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("[getDealsPerZip] Missing Supabase env vars");
    return {};
  }

  const admin = createServiceClient(url, serviceKey);

  const { data: deals } = await admin
    .from("sales_deals")
    .select("customer_zip")
    .eq("event_id", eventId)
    .not("customer_zip", "is", null);

  const counts: Record<string, number> = {};
  for (const d of deals ?? []) {
    const zip = (d.customer_zip ?? "").trim();
    if (zip) counts[zip] = (counts[zip] ?? 0) + 1;
  }
  return counts;
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

  // Verify membership before allowing vehicle lookup
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  const { data: vehicle } = await supabase
    .from("vehicle_inventory")
    .select("*")
    .eq("event_id", eventId)
    .ilike("stock_number", stockNumber)
    .eq("status", "available")
    .single();

  return vehicle;
}

// ── Bulk deal operations ────────────────────────────────

export async function bulkDeleteDeals(
  dealIds: string[],
  eventId: string,
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

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("Only owners and managers can delete deals");
  }

  if (dealIds.length === 0) return { success: true, count: 0 };

  const { error } = await supabase
    .from("sales_deals")
    .delete()
    .in("id", dealIds)
    .eq("event_id", eventId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  return { success: true, count: dealIds.length };
}

// ────────────────────────────────────────────────────────
// Save recap financial configuration
// ────────────────────────────────────────────────────────
export async function saveRecapConfig(
  eventId: string,
  config: {
    marketing_cost?: number | null;
    jde_commission_tiers?: { min: number; max: number | null; pct: number }[] | null;
    misc_expenses?: number | null;
    prize_giveaways?: number | null;
  },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("event_config")
    .update({
      marketing_cost: config.marketing_cost,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jde_commission_tiers: config.jde_commission_tiers as any,
      misc_expenses: config.misc_expenses,
      prize_giveaways: config.prize_giveaways,
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);

  if (error) throw new Error(error.message);

  revalidatePath(`/dashboard/events/${eventId}/recap`);
  return { success: true };
}
