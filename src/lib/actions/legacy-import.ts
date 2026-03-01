"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { ImportResult } from "./import-vehicles";
import type { Database } from "@/types/database";

type DealInsert = Database["public"]["Tables"]["sales_deals"]["Insert"];
type LenderInsert = Database["public"]["Tables"]["lenders"]["Insert"];

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
 * Follows the same pattern as executeImport in import-vehicles.ts:
 * auth → membership check → map rows → sanitize → batch insert.
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

  const errorDetails: { row: number; message: string }[] = [];
  const validRows: DealInsert[] = [];

  // Build reverse column map: spreadsheet col index → DB field
  const reverseMap: Record<string, string> = {};
  for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
    if (dbField && dbField !== "__skip__") {
      reverseMap[spreadsheetCol] = dbField;
    }
  }

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
      continue; // silently skip — not an error, just an empty row
    }

    // Parse numeric fields
    const dealNumber = parseNum(mapped.deal_number);
    const saleDay = parseNum(mapped.sale_day);
    const vehicleYear = parseNum(mapped.vehicle_year);
    const vehicleCost = parseNum(mapped.vehicle_cost);
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

    // selling_price is required for deal calculations
    if (sellingPrice == null) {
      errorDetails.push({
        row: i + 1,
        message: `Missing selling price for "${customerName}"`,
      });
      continue;
    }

    // Auto-calculate derived fields (same logic as createDeal in deals.ts)
    const frontGross =
      frontGrossRaw ?? sellingPrice - (vehicleCost ?? 0);
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
      selling_price: sellingPrice,
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

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");

  return {
    success: errorDetails.length === 0,
    imported,
    deleted: 0,
    errors: errorDetails.length,
    duplicatesSkipped: 0,
    errorDetails,
    mode: "append",
  };
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
