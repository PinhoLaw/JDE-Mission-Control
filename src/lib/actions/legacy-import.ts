"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { ImportResult } from "./import-vehicles";
import type { Database } from "@/types/database";
import { syncInventoryFromDeals, createTradeVehicle } from "./inventory";
import { createClient as createServiceClient } from "@supabase/supabase-js";

type DealInsert = Database["public"]["Tables"]["sales_deals"]["Insert"];
type LenderInsert = Database["public"]["Tables"]["lenders"]["Insert"];
type MailTrackingInsert = Database["public"]["Tables"]["mail_tracking"]["Insert"];

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/**
 * Strip currency symbols, commas, spaces from a string and parse to number.
 * Returns null if the result is NaN.
 */
function parseNum(val: unknown): number | null {
  if (val == null || val === "") return null;
  const cleaned = String(val).replace(/[$,\s%]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Normalize new/used value to "New" | "Used" | "Certified"
 */
function normalizeNewUsed(val: unknown): "New" | "Used" | "Certified" {
  if (!val) return "Used";
  const s = String(val).toLowerCase().trim();
  if (s === "new" || s === "n") return "New";
  if (s === "certified" || s === "cpo" || s.includes("cert")) return "Certified";
  return "Used";
}

/**
 * Normalize finance type to "retail" | "lease" | "cash"
 */
function normalizeFinanceType(val: unknown): "retail" | "lease" | "cash" {
  if (!val) return "retail";
  const s = String(val).toLowerCase().trim();
  if (s === "cash" || s === "c") return "cash";
  if (s === "lease" || s === "l") return "lease";
  return "retail";
}

// ────────────────────────────────────────────────────────
// bulkImportDeals
// ────────────────────────────────────────────────────────

/**
 * Bulk import deal rows into the sales_deals table.
 *
 * Uses REPLACE mode: deletes all existing deals for this event first,
 * then imports fresh. Also filters out note/fluff rows from spreadsheets.
 */
export async function bulkImportDeals(
  rows: Record<string, string>[],
  columnMap: Record<string, string>,
  eventId: string,
): Promise<ImportResult> {
  const supabase = await createClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Membership check (require owner or manager)
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("Only owners and managers can import deals");
  }

  // ── REPLACE MODE: Delete all existing deals for this event first ──
  const { data: deletedRows } = await supabase
    .from("sales_deals")
    .delete()
    .eq("event_id", eventId)
    .select("id");
  const deleted = deletedRows?.length ?? 0;

  const errorDetails: { row: number; message: string }[] = [];
  const validRows: DealInsert[] = [];

  // ── Separate skip counters for detailed breakdown ──
  let emptyRows = 0;
  let fluffRows = 0;
  let duplicates = 0;

  // Build reverse column map: spreadsheet col index → DB field
  const reverseMap: Record<string, string> = {};
  for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
    if (dbField && dbField !== "__skip__") {
      reverseMap[spreadsheetCol] = dbField;
    }
  }

  // Track stock numbers seen in THIS import to skip intra-batch duplicates
  const seenStocks = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, unknown> = {};

    // Map columns
    for (const [spreadsheetCol, dbField] of Object.entries(reverseMap)) {
      mapped[dbField] = raw[spreadsheetCol] ?? null;
    }

    // Skip rows with no customer name (required field)
    const customerName = mapped.customer_name
      ? String(mapped.customer_name).trim()
      : "";
    if (!customerName) {
      emptyRows++;
      continue; // silently skip — not an error, just an empty row
    }

    // ── FLUFF FILTER: Skip note/comment rows ──
    // Notes are long text without a stock number (e.g. "BILLED $1100 TO JDE...")
    const stockNumber = mapped.stock_number
      ? String(mapped.stock_number).trim()
      : "";
    if (!stockNumber) {
      // No stock number — likely a note row, not a real deal
      fluffRows++;
      continue;
    }
    if (customerName.length > 50) {
      // Customer name too long — likely a note/comment row
      fluffRows++;
      continue;
    }

    // ── INTRA-BATCH DEDUP: Skip if we've already seen this stock number ──
    const stockKey = stockNumber.toUpperCase();
    if (seenStocks.has(stockKey)) {
      duplicates++;
      continue;
    }
    seenStocks.add(stockKey);

    // Parse numeric fields
    const dealNumber = parseNum(mapped.deal_number);
    const saleDay = parseNum(mapped.sale_day);
    const vehicleYear = parseNum(mapped.vehicle_year);
    const vehicleCost = parseNum(mapped.vehicle_cost);
    const vehicleAge = parseNum(mapped.vehicle_age);
    const sellingPrice = parseNum(mapped.selling_price);
    const frontGrossRaw = parseNum(mapped.front_gross);
    const rate = parseNum(mapped.rate);
    const reserve = parseNum(mapped.reserve);
    const warranty = parseNum(mapped.warranty);
    const gap = parseNum(mapped.gap);
    const aftermarket1 = parseNum(mapped.aftermarket_1);
    const aftermarket2 = parseNum(mapped.aftermarket_2);
    const docFee = parseNum(mapped.doc_fee);
    const salespersonPct = parseNum(mapped.salesperson_pct);
    const secondSpPct = parseNum(mapped.second_sp_pct);
    const tradeYear = parseNum(mapped.trade_year);
    const tradeMileage = parseNum(mapped.trade_mileage);
    const tradeAcv = parseNum(mapped.trade_acv);
    const tradePayoff = parseNum(mapped.trade_payoff);

    // Derive selling_price if not mapped: cost + front_gross, or cost alone
    let derivedSellingPrice = sellingPrice;
    if (derivedSellingPrice == null && vehicleCost != null && frontGrossRaw != null) {
      derivedSellingPrice = vehicleCost + frontGrossRaw;
    } else if (derivedSellingPrice == null && vehicleCost != null) {
      derivedSellingPrice = vehicleCost; // fallback: use cost as selling price
    }

    // Auto-calculate derived fields (same logic as createDeal in deals.ts)
    // front_gross: explicit value, or selling_price - cost, or 0
    const frontGross =
      frontGrossRaw ??
      (derivedSellingPrice != null && vehicleCost != null
        ? derivedSellingPrice - vehicleCost
        : 0);
    const fiTotal =
      (reserve ?? 0) +
      (warranty ?? 0) +
      (gap ?? 0) +
      (aftermarket1 ?? 0) +
      (aftermarket2 ?? 0);
    const backGross = fiTotal + (docFee ?? 0);
    const totalGross = frontGross + backGross;
    const pvr = totalGross;
    const isWashout = frontGross < 0;
    const washoutAmount = isWashout ? Math.abs(frontGross) : 0;

    const str = (v: unknown): string | null =>
      v ? String(v).trim() || null : null;

    const row: DealInsert = {
      event_id: eventId,
      deal_number: dealNumber,
      sale_day: saleDay,
      sale_date: str(mapped.sale_date),
      customer_name: customerName,
      customer_zip: str(mapped.customer_zip),
      customer_phone: str(mapped.customer_phone),
      stock_number: str(mapped.stock_number),
      vehicle_year: vehicleYear,
      vehicle_make: str(mapped.vehicle_make),
      vehicle_model: str(mapped.vehicle_model),
      vehicle_type: str(mapped.vehicle_type),
      vehicle_cost: vehicleCost,
      vehicle_age: vehicleAge,
      new_used: normalizeNewUsed(mapped.new_used),
      trade_year: tradeYear,
      trade_make: str(mapped.trade_make),
      trade_model: str(mapped.trade_model),
      trade_type: str(mapped.trade_type),
      trade_mileage: tradeMileage,
      trade_acv: tradeAcv,
      trade_payoff: tradePayoff,
      salesperson: str(mapped.salesperson),
      salesperson_pct: salespersonPct,
      second_salesperson: str(mapped.second_salesperson),
      second_sp_pct: secondSpPct,
      selling_price: derivedSellingPrice,
      front_gross: frontGross,
      lender: str(mapped.lender),
      rate: rate,
      finance_type: normalizeFinanceType(mapped.finance_type),
      reserve: reserve,
      warranty: warranty,
      gap: gap,
      aftermarket_1: aftermarket1,
      aftermarket_2: aftermarket2,
      doc_fee: docFee,
      fi_total: fiTotal,
      back_gross: backGross,
      total_gross: totalGross,
      pvr: pvr,
      is_washout: isWashout,
      washout_amount: isWashout ? washoutAmount : null,
      source: str(mapped.source),
      notes: str(mapped.notes),
      status: "pending",
    };
    validRows.push(row);
  }

  // Batch insert in chunks of 250
  let imported = 0;
  const BATCH_SIZE = 250;

  for (let start = 0; start < validRows.length; start += BATCH_SIZE) {
    const batch = validRows.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("sales_deals").insert(batch);

    if (error) {
      // Record the error but continue with next batch
      for (let j = 0; j < batch.length; j++) {
        errorDetails.push({
          row: start + j + 1,
          message: error.message,
        });
      }
    } else {
      imported += batch.length;
    }
  }

  // Sync inventory — mark matching vehicles as sold
  if (imported > 0) {
    await syncInventoryFromDeals(eventId);
    await matchSalespersonIds(eventId, supabase);
    await createTradeVehiclesFromDeals(eventId);
    await syncCampaignStatsFromDeals(eventId);
    await syncDailyMetricsFromDeals(eventId);
  }

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/campaigns");
  revalidatePath("/dashboard");

  const totalSkipped = emptyRows + fluffRows + duplicates;

  return {
    success: errorDetails.length === 0,
    imported,
    deleted,
    errors: errorDetails.length,
    duplicatesSkipped: totalSkipped,
    errorDetails,
    mode: "replace",
    skipBreakdown: {
      emptyRows,
      fluffRows,
      duplicates,
      validationErrors: 0,
    },
  };
}

// ────────────────────────────────────────────────────────
// Match salesperson names → roster IDs after import
// ────────────────────────────────────────────────────────

/**
 * After bulk importing deals, match salesperson text names to roster member IDs.
 * Uses case-insensitive matching within the same event.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function matchSalespersonIds(eventId: string, supabase: any) {
  // 1. Fetch roster for event → build name→id map
  const { data: roster } = await supabase
    .from("roster")
    .select("id, name")
    .eq("event_id", eventId);

  if (!roster || roster.length === 0) return;

  const rosterMap = new Map<string, string>();
  for (const r of roster as Array<{ id: string; name: string }>) {
    rosterMap.set(r.name.trim().toLowerCase(), r.id);
  }

  // 2. Fetch deals missing salesperson_id
  const { data: deals } = await supabase
    .from("sales_deals")
    .select("id, salesperson, second_salesperson, salesperson_id, second_sp_id")
    .eq("event_id", eventId);

  if (!deals) return;

  for (const deal of deals as Array<{
    id: string;
    salesperson: string | null;
    second_salesperson: string | null;
    salesperson_id: string | null;
    second_sp_id: string | null;
  }>) {
    const updates: Record<string, string> = {};

    if (deal.salesperson && !deal.salesperson_id) {
      const id = rosterMap.get(deal.salesperson.trim().toLowerCase());
      if (id) updates.salesperson_id = id;
    }

    if (deal.second_salesperson && !deal.second_sp_id) {
      const id = rosterMap.get(deal.second_salesperson.trim().toLowerCase());
      if (id) updates.second_sp_id = id;
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from("sales_deals")
        .update(updates)
        .eq("id", deal.id);
    }
  }
}

// ────────────────────────────────────────────────────────
// bulkImportLenders
// ────────────────────────────────────────────────────────

/**
 * Bulk import lender rows into the lenders table.
 * Deduplicates against existing lenders by case-insensitive name match.
 */
export async function bulkImportLenders(
  rows: Record<string, string>[],
  columnMap: Record<string, string>,
  eventId: string,
): Promise<ImportResult> {
  const supabase = await createClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Membership check
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("Only owners and managers can import lenders");
  }

  // Build reverse column map
  const reverseMap: Record<string, string> = {};
  for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
    if (dbField && dbField !== "__skip__") {
      reverseMap[spreadsheetCol] = dbField;
    }
  }

  // Fetch existing lender names for dedup
  const { data: existing } = await supabase
    .from("lenders")
    .select("name")
    .eq("event_id", eventId);

  const existingNames = new Set(
    (existing ?? []).map((l) => l.name.toLowerCase().trim()),
  );

  const errorDetails: { row: number; message: string }[] = [];
  const toInsert: LenderInsert[] = [];
  let duplicatesSkipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, unknown> = {};

    for (const [spreadsheetCol, dbField] of Object.entries(reverseMap)) {
      mapped[dbField] = raw[spreadsheetCol] ?? null;
    }

    const name = mapped.name ? String(mapped.name).trim() : "";
    if (!name) continue; // skip empty rows

    // Dedup check
    if (existingNames.has(name.toLowerCase())) {
      duplicatesSkipped++;
      continue;
    }

    // Mark as seen to avoid inserting duplicates within this batch
    existingNames.add(name.toLowerCase());

    toInsert.push({
      event_id: eventId,
      name,
      buy_rate_pct: parseNum(mapped.buy_rate_pct),
      max_advance: parseNum(mapped.max_advance),
      notes: mapped.notes ? String(mapped.notes).trim() || null : null,
      active: true,
    });
  }

  // Single batch insert (lender lists are typically small)
  let imported = 0;
  if (toInsert.length > 0) {
    const { error } = await supabase.from("lenders").insert(toInsert);
    if (error) {
      errorDetails.push({ row: 0, message: error.message });
    } else {
      imported = toInsert.length;
    }
  }

  revalidatePath("/dashboard/roster");

  return {
    success: errorDetails.length === 0,
    imported,
    deleted: 0,
    errors: errorDetails.length,
    duplicatesSkipped,
    errorDetails,
    mode: "append",
  };
}

// ────────────────────────────────────────────────────────
// bulkImportMailTracking
// ────────────────────────────────────────────────────────

/**
 * Bulk import mail tracking rows into the mail_tracking table.
 * Deduplicates against existing rows by zip_code within the same event.
 * Computes response_rate and total_responses automatically if not provided.
 */
export async function bulkImportMailTracking(
  rows: Record<string, string>[],
  columnMap: Record<string, string>,
  eventId: string,
  campaignSource: string = "current",
): Promise<ImportResult> {
  const supabase = await createClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Membership check
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("Only owners and managers can import mail tracking data");
  }

  // Build reverse column map
  const reverseMap: Record<string, string> = {};
  for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
    if (dbField && dbField !== "__skip__") {
      reverseMap[spreadsheetCol] = dbField;
    }
  }

  // Fetch existing zip codes for dedup (scoped by campaign_source)
  const { data: existing } = await supabase
    .from("mail_tracking")
    .select("zip_code")
    .eq("event_id", eventId)
    .eq("campaign_source", campaignSource);

  const existingZips = new Set(
    (existing ?? []).map((r) => String(r.zip_code).trim()),
  );

  const errorDetails: { row: number; message: string }[] = [];
  const toInsert: MailTrackingInsert[] = [];
  let duplicatesSkipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, unknown> = {};

    for (const [spreadsheetCol, dbField] of Object.entries(reverseMap)) {
      mapped[dbField] = raw[spreadsheetCol] ?? null;
    }

    // zip_code is the required field
    const zipCode = mapped.zip_code ? String(mapped.zip_code).trim() : "";
    if (!zipCode) continue; // skip empty rows

    // Dedup check
    if (existingZips.has(zipCode)) {
      duplicatesSkipped++;
      continue;
    }
    existingZips.add(zipCode);

    // Parse day columns + pieces_sent
    const piecesSent = parseNum(mapped.pieces_sent) ?? 0;
    const day1 = parseNum(mapped.day_1) ?? 0;
    const day2 = parseNum(mapped.day_2) ?? 0;
    const day3 = parseNum(mapped.day_3) ?? 0;
    const day4 = parseNum(mapped.day_4) ?? 0;
    const day5 = parseNum(mapped.day_5) ?? 0;
    const day6 = parseNum(mapped.day_6) ?? 0;
    const day7 = parseNum(mapped.day_7) ?? 0;
    const day8 = parseNum(mapped.day_8) ?? 0;
    const day9 = parseNum(mapped.day_9) ?? 0;
    const day10 = parseNum(mapped.day_10) ?? 0;
    const day11 = parseNum(mapped.day_11) ?? 0;
    const day12 = parseNum(mapped.day_12) ?? 0;

    // Auto-compute total_responses if not explicitly mapped
    const explicitTotal = parseNum(mapped.total_responses);
    const totalResponses =
      explicitTotal ??
      day1 + day2 + day3 + day4 + day5 + day6 +
      day7 + day8 + day9 + day10 + day11 + day12;

    // Auto-compute response_rate
    const responseRate =
      piecesSent > 0 ? Math.round((totalResponses / piecesSent) * 10000) / 10000 : 0;

    const town = mapped.town ? String(mapped.town).trim() || null : null;

    // Use mapped sold/gross values from the spreadsheet (fall back to 0)
    const soldFromMail = parseNum(mapped.sold_from_mail) ?? 0;
    const grossFromMail = parseNum(mapped.gross_from_mail) ?? 0;

    toInsert.push({
      event_id: eventId,
      zip_code: zipCode,
      town,
      pieces_sent: piecesSent,
      day_1: day1,
      day_2: day2,
      day_3: day3,
      day_4: day4,
      day_5: day5,
      day_6: day6,
      day_7: day7,
      day_8: day8,
      day_9: day9,
      day_10: day10,
      day_11: day11,
      day_12: day12,
      total_responses: totalResponses,
      response_rate: responseRate,
      sold_from_mail: soldFromMail,
      gross_from_mail: grossFromMail,
      campaign_source: campaignSource,
    });
  }

  // Batch insert in chunks of 250
  let imported = 0;
  const BATCH_SIZE = 250;

  for (let start = 0; start < toInsert.length; start += BATCH_SIZE) {
    const batch = toInsert.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("mail_tracking").insert(batch);

    if (error) {
      for (let j = 0; j < batch.length; j++) {
        errorDetails.push({
          row: start + j + 1,
          message: error.message,
        });
      }
    } else {
      imported += batch.length;
    }
  }

  revalidatePath("/dashboard/campaigns");
  revalidatePath("/dashboard");

  return {
    success: errorDetails.length === 0,
    imported,
    deleted: 0,
    errors: errorDetails.length,
    duplicatesSkipped,
    errorDetails,
    mode: "append",
  };
}

// ────────────────────────────────────────────────────────
// Post-import: Auto-create trade vehicles from deal data
// ────────────────────────────────────────────────────────

async function createTradeVehiclesFromDeals(eventId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;

  const admin = createServiceClient(url, serviceKey);

  // Fetch deals with trade data that don't have trade_vehicle_id yet
  const { data: deals } = await admin
    .from("sales_deals")
    .select(
      "id, trade_year, trade_make, trade_model, trade_type, trade_mileage, trade_acv, trade_vehicle_id",
    )
    .eq("event_id", eventId)
    .is("trade_vehicle_id", null);

  if (!deals || deals.length === 0) return;

  let created = 0;
  for (const deal of deals) {
    // Only create if there's meaningful trade data
    if (!deal.trade_make && !deal.trade_model) continue;

    const tradeVehicleId = await createTradeVehicle(eventId, {
      year: deal.trade_year,
      make: deal.trade_make,
      model: deal.trade_model,
      type: deal.trade_type,
      mileage: deal.trade_mileage,
      acv: deal.trade_acv,
    });

    if (tradeVehicleId) {
      await admin
        .from("sales_deals")
        .update({ trade_vehicle_id: tradeVehicleId })
        .eq("id", deal.id);
      created++;
    }
  }

  if (created > 0) {
    console.log(
      `[createTradeVehiclesFromDeals] Created ${created} trade vehicle records`,
    );
  }
}

// ────────────────────────────────────────────────────────
// Post-import: Auto-sync campaign stats from deals
// ────────────────────────────────────────────────────────

async function syncCampaignStatsFromDeals(eventId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;

  const admin = createServiceClient(url, serviceKey);

  // Get all deals with customer_zip
  const { data: deals } = await admin
    .from("sales_deals")
    .select("customer_zip, total_gross")
    .eq("event_id", eventId)
    .not("customer_zip", "is", null)
    .not("status", "in", '("cancelled","unwound")');

  if (!deals) return;

  // Aggregate by zip: count and sum of total_gross
  const zipStats = new Map<string, { count: number; gross: number }>();
  for (const d of deals) {
    const zip = (d.customer_zip ?? "").trim();
    if (!zip) continue;
    const entry = zipStats.get(zip) ?? { count: 0, gross: 0 };
    entry.count++;
    entry.gross += d.total_gross ?? 0;
    zipStats.set(zip, entry);
  }

  // Get all mail_tracking rows for event
  const { data: mailRows } = await admin
    .from("mail_tracking")
    .select("id, zip_code")
    .eq("event_id", eventId);

  if (!mailRows) return;

  // Update each mail_tracking row with deal stats
  let updated = 0;
  for (const row of mailRows) {
    const stats = zipStats.get(row.zip_code) ?? { count: 0, gross: 0 };
    const { error } = await admin
      .from("mail_tracking")
      .update({
        sold_from_mail: stats.count,
        gross_from_mail: Math.round(stats.gross * 100) / 100,
      })
      .eq("id", row.id);
    if (!error) updated++;
  }

  if (updated > 0) {
    console.log(
      `[syncCampaignStatsFromDeals] Updated ${updated} mail_tracking rows`,
    );
  }
}

// ────────────────────────────────────────────────────────
// Post-import: Auto-sync daily metrics from deal timestamps
// ────────────────────────────────────────────────────────

async function syncDailyMetricsFromDeals(eventId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;

  const admin = createServiceClient(url, serviceKey);

  // Fetch all active deals for event
  const { data: deals } = await admin
    .from("sales_deals")
    .select("created_at, sale_day, total_gross, front_gross, back_gross")
    .eq("event_id", eventId)
    .not("status", "in", '("cancelled","unwound")');

  if (!deals || deals.length === 0) return;

  // Group by DATE(created_at)
  const byDate = new Map<
    string,
    {
      saleDay: number;
      totalGross: number;
      totalFront: number;
      totalBack: number;
      count: number;
    }
  >();

  for (const d of deals) {
    const dateKey = (d.created_at ?? "").split("T")[0]; // YYYY-MM-DD
    if (!dateKey) continue;
    const entry = byDate.get(dateKey) ?? {
      saleDay: d.sale_day ?? 1,
      totalGross: 0,
      totalFront: 0,
      totalBack: 0,
      count: 0,
    };
    entry.totalGross += d.total_gross ?? 0;
    entry.totalFront += d.front_gross ?? 0;
    entry.totalBack += d.back_gross ?? 0;
    entry.count++;
    byDate.set(dateKey, entry);
  }

  // Preserve existing total_ups values
  const { data: existing } = await admin
    .from("daily_metrics")
    .select("sale_date, total_ups")
    .eq("event_id", eventId);

  const existingUps = new Map<string, number>();
  for (const row of existing ?? []) {
    if (row.sale_date) existingUps.set(row.sale_date, row.total_ups ?? 0);
  }

  // Delete existing metrics and re-insert with fresh data
  await admin.from("daily_metrics").delete().eq("event_id", eventId);

  const rows = [...byDate.entries()].map(([date, data]) => ({
    event_id: eventId,
    sale_day: data.saleDay,
    sale_date: date,
    total_ups: existingUps.get(date) ?? 0,
    total_sold: data.count,
    total_gross: Math.round(data.totalGross * 100) / 100,
    total_front: Math.round(data.totalFront * 100) / 100,
    total_back: Math.round(data.totalBack * 100) / 100,
  }));

  if (rows.length > 0) {
    await admin.from("daily_metrics").insert(rows);
    console.log(
      `[syncDailyMetricsFromDeals] Synced ${rows.length} daily metric rows`,
    );
  }
}
