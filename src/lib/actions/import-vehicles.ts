"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
// NOTE: ExcelJS is loaded via dynamic import() inside parseExcel() only.
// Top-level import crashes Vercel serverless functions because ExcelJS
// pulls in Node.js stream/crypto modules that fail to bundle.

// ────────────────────────────────────────────────────────
// Cell value → string helper (handles ALL ExcelJS value types)
// ────────────────────────────────────────────────────────
function cellToString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // ExcelJS rich text: { richText: [{ text: "..." }, ...] }
    if ("richText" in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((s) => s.text).join("");
    }
    // ExcelJS formula: { formula: "...", result: ... }
    // Try result first — it's the cached displayed value
    if ("result" in obj) {
      const r = obj.result;
      if (r instanceof Date) return r.toISOString();
      if (r != null) return String(r);
    }
    // ExcelJS shared formula: { sharedFormula: "...", result: ... }
    if ("sharedFormula" in obj && "result" in obj) {
      const r = obj.result;
      if (r != null) return String(r);
    }
    // ExcelJS hyperlink: { text: "...", hyperlink: "..." }
    if ("text" in obj && obj.text != null) {
      return String(obj.text);
    }
    // Last resort: if there's a formula key but no result, the value is uncalculated
    if ("formula" in obj || "sharedFormula" in obj) {
      return null; // formula without cached result — can't resolve
    }
  }
  return String(value);
}

// Extract displayed value from an ExcelJS cell object using every available approach
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCellValue(cell: any): string | null {
  if (!cell) return null;

  // Approach 1: cell.text — the formatted display string (best for formulas)
  try {
    if (cell.text != null) {
      const t = String(cell.text).trim();
      if (t !== "" && t !== "undefined" && t !== "null") return t;
    }
  } catch { /* ignore */ }

  // Approach 2: cell.result — formula cached result (direct property)
  try {
    if (cell.result != null) {
      if (cell.result instanceof Date) return cell.result.toISOString();
      const r = String(cell.result).trim();
      if (r !== "" && r !== "undefined") return r;
    }
  } catch { /* ignore */ }

  // Approach 3: cell.value — raw value (may be primitive, formula obj, or rich text)
  try {
    const v = cell.value;
    if (v != null) {
      return cellToString(v);
    }
  } catch { /* ignore */ }

  // Approach 4: cell.model — internal model (last resort)
  try {
    const m = cell.model;
    if (m?.result != null) return String(m.result);
    if (m?.value != null) return cellToString(m.value);
  } catch { /* ignore */ }

  return null;
}

// ────────────────────────────────────────────────────────
// Parse spreadsheet (server action — accepts FormData)
// Supports .xlsx and .csv files
// ────────────────────────────────────────────────────────
export interface ParsedSheet {
  name: string;
  index: number;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ParsedSpreadsheet {
  headers: string[];
  rows: Record<string, unknown>[];
  fileName: string;
  rowCount: number;
  sheets: ParsedSheet[];
}

export async function parseSpreadsheet(
  formData: FormData,
): Promise<ParsedSpreadsheet> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    throw new Error("No file provided");
  }

  const fileName = file.name.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();

  // Max 10 MB guard
  if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
    throw new Error("File too large — maximum 10 MB");
  }

  if (fileName.endsWith(".csv")) {
    return parseCSV(Buffer.from(arrayBuffer), file.name);
  }

  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    return parseExcel(arrayBuffer, file.name);
  }

  throw new Error("Unsupported file type — upload .xlsx or .csv");
}

function parseOneSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worksheet: any,
  sheetIndex: number,
): ParsedSheet | null {
  const sheetName: string = worksheet.name ?? `Sheet ${sheetIndex + 1}`;

  if (!worksheet || worksheet.rowCount < 2) return null;

  // Extract headers from row 1 (row.values works fine for headers — they're plain text)
  const rawHeaderValues = worksheet.getRow(1).values;
  const headers: string[] = [];
  if (Array.isArray(rawHeaderValues)) {
    for (let i = 1; i < rawHeaderValues.length; i++) {
      const val = rawHeaderValues[i];
      headers.push(val != null ? String(val).trim() : `col${i}`);
    }
  }

  if (headers.length === 0) return null;

  // Extract data rows using getCell() + extractCellValue for formula support
  const rows: Record<string, unknown>[] = [];
  const debugRowLimit = 3; // log first N data rows in detail

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
    if (rowNumber === 1) return; // skip header row

    const rowObj: Record<string, unknown> = {};
    const shouldDebug = rows.length < debugRowLimit;

    // Also grab row.values as fallback
    const sparseValues = Array.isArray(row.values) ? row.values : [];

    headers.forEach((header, index) => {
      const colIdx = index + 1; // ExcelJS is 1-indexed
      let val: string | null = null;

      try {
        const cell = row.getCell(colIdx);
        val = extractCellValue(cell);

        // Debug: dump EVERYTHING for first N rows
        if (shouldDebug) {
          const sparseVal = sparseValues[colIdx];
          console.log(
            `[CELL DEBUG] sheet="${sheetName}" row=${rowNumber} col=${colIdx} header="${header}"` +
            ` | type=${cell?.type}` +
            ` | text=${JSON.stringify(cell?.text)}` +
            ` | value=${JSON.stringify(cell?.value)}` +
            ` | result=${JSON.stringify(cell?.result)}` +
            ` | formula=${JSON.stringify(cell?.formula)}` +
            ` | sparse=${JSON.stringify(sparseVal)}` +
            ` | EXTRACTED="${val}"`,
          );
        }
      } catch (err) {
        // Fallback to sparse array
        val = cellToString(sparseValues[colIdx]) ?? null;
        if (shouldDebug) {
          console.log(
            `[CELL DEBUG] sheet="${sheetName}" row=${rowNumber} col=${colIdx} header="${header}"` +
            ` | GETCEL_ERROR=${err instanceof Error ? err.message : String(err)}` +
            ` | sparse_fallback=${JSON.stringify(sparseValues[colIdx])}` +
            ` | EXTRACTED="${val}"`,
          );
        }
      }

      rowObj[header] = val;
    });

    const hasData = Object.values(rowObj).some((v) => v != null && v !== "");
    if (hasData) {
      rows.push(rowObj);
    }
  });

  if (rows.length === 0) return null;

  return { name: sheetName, index: sheetIndex, headers, rows, rowCount: rows.length };
}

async function parseExcel(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): Promise<ParsedSpreadsheet> {
  // Dynamic import — only loaded when actually parsing Excel.
  // This prevents ExcelJS from crashing Vercel serverless functions
  // that never touch this code path (e.g., /dashboard, /deals).
  const ExcelJS = (await import("@protobi/exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(arrayBuffer as any);

  // Parse ALL worksheets
  const sheets: ParsedSheet[] = [];
  for (let i = 0; i < workbook.worksheets.length; i++) {
    const parsed = parseOneSheet(workbook.worksheets[i], i);
    if (parsed) {
      sheets.push(parsed);
    }
  }

  if (sheets.length === 0) {
    throw new Error("Spreadsheet is empty or has no data rows in any sheet");
  }

  // Default: use first sheet for backward compatibility
  const first = sheets[0];
  return {
    headers: first.headers,
    rows: first.rows,
    fileName,
    rowCount: first.rowCount,
    sheets,
  };
}

function parseCSV(buffer: Buffer, fileName: string): ParsedSpreadsheet {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("CSV is empty or has no data rows");
  }

  // Simple CSV parser that handles quoted fields
  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          cells.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }
    cells.push(current.trim());
    return cells;
  }

  const headers = parseLine(lines[0]);
  if (headers.length === 0 || headers.every((h) => h === "")) {
    throw new Error("No column headers found in the first row");
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const rowObj: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const val = cells[index]?.trim();
      rowObj[header] = val && val !== "" ? val : null;
    });

    const hasData = Object.values(rowObj).some((v) => v != null);
    if (hasData) {
      rows.push(rowObj);
    }
  }

  if (rows.length === 0) {
    throw new Error("CSV has headers but no data rows");
  }

  const sheet: ParsedSheet = { name: "CSV", index: 0, headers, rows, rowCount: rows.length };
  return { headers, rows, fileName, rowCount: rows.length, sheets: [sheet] };
}

// ────────────────────────────────────────────────────────
// Zod schema for a single vehicle row
// ────────────────────────────────────────────────────────
const vehicleRowSchema = z.object({
  hat_number: z.coerce.number().int().positive().optional().nullable(),
  stock_number: z.string().optional().nullable(),
  vin: z.string().optional().nullable(),
  year: z.coerce.number().int().min(1900).max(2030).optional().nullable(),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  trim: z.string().optional().nullable(),
  body_style: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  mileage: z.coerce.number().int().min(0).optional().nullable(),
  age_days: z.coerce.number().int().min(0).optional().nullable(),
  drivetrain: z.string().optional().nullable(),
  acquisition_cost: z.coerce.number().min(0).optional().nullable(),
  jd_trade_clean: z.coerce.number().optional().nullable(),
  jd_retail_clean: z.coerce.number().optional().nullable(),
  asking_price_115: z.coerce.number().optional().nullable(),
  asking_price_120: z.coerce.number().optional().nullable(),
  asking_price_125: z.coerce.number().optional().nullable(),
  asking_price_130: z.coerce.number().optional().nullable(),
  profit_115: z.coerce.number().optional().nullable(),
  profit_120: z.coerce.number().optional().nullable(),
  profit_125: z.coerce.number().optional().nullable(),
  profit_130: z.coerce.number().optional().nullable(),
  retail_spread: z.coerce.number().optional().nullable(),
  label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type VehicleRow = z.infer<typeof vehicleRowSchema>;

export interface ImportValidationResult {
  valid: boolean;
  row: number;
  data: Record<string, unknown>;
  errors: string[];
}

export type ImportMode = "replace" | "append";

export interface ImportResult {
  success: boolean;
  imported: number;
  deleted: number;
  errors: number;
  duplicatesSkipped: number;
  errorDetails: { row: number; message: string }[];
  mode: ImportMode;
}

// ────────────────────────────────────────────────────────
// Validate rows (dry-run)
// ────────────────────────────────────────────────────────
export async function validateImportRows(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
  eventId: string,
  mode: ImportMode = "replace",
): Promise<ImportValidationResult[]> {
  const supabase = await createClient();

  // Auth + membership check (must be owner/manager to validate imports)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("You must be an owner or manager to validate imports");
  }

  // Get existing stock numbers for duplicate detection (only in append mode)
  let existingStocks = new Set<string>();
  if (mode === "append") {
    const { data: existing } = await supabase
      .from("vehicle_inventory")
      .select("stock_number")
      .eq("event_id", eventId);

    existingStocks = new Set(
      (existing ?? []).map((v) => v.stock_number?.toLowerCase()).filter(Boolean) as string[],
    );
  }

  // Track stock numbers within the file itself (detect intra-file duplicates)
  const seenStocks = new Set<string>();
  const results: ImportValidationResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, unknown> = {};

    // Apply column mapping
    for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
      if (dbField && dbField !== "__skip__" && raw[spreadsheetCol] !== undefined) {
        mapped[dbField] = raw[spreadsheetCol];
      }
    }

    // Clean up empty strings → null
    for (const key of Object.keys(mapped)) {
      if (mapped[key] === "" || mapped[key] === undefined) {
        mapped[key] = null;
      }
    }

    const parsed = vehicleRowSchema.safeParse(mapped);
    const errors: string[] = [];

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${issue.path.join(".")}: ${issue.message}`);
      }
    }

    // Check for duplicate stock numbers
    const stockNum = String(mapped.stock_number ?? "").toLowerCase();
    if (stockNum) {
      // Intra-file duplicate
      if (seenStocks.has(stockNum)) {
        errors.push(`Duplicate stock_number in file: "${mapped.stock_number}"`);
      }
      // Existing in DB duplicate (append mode only)
      if (mode === "append" && existingStocks.has(stockNum)) {
        errors.push(`Duplicate stock_number: "${mapped.stock_number}" already exists in event`);
      }
      seenStocks.add(stockNum);
    }

    results.push({
      valid: errors.length === 0,
      row: i + 1,
      data: mapped,
      errors,
    });
  }

  return results;
}

// ────────────────────────────────────────────────────────
// Execute the import (delete + insert for replace mode)
// ────────────────────────────────────────────────────────
export async function executeImport(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
  eventId: string,
  mode: ImportMode = "replace",
): Promise<ImportResult> {
  const supabase = await createClient();

  // Auth + membership check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  console.log("[executeImport] user:", user.email, "event_id:", eventId, "mode:", mode);

  const { data: membership, error: memberErr } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  console.log(
    "[executeImport] membership:",
    membership?.role ?? "NONE",
    memberErr ? `error: ${memberErr.message}` : "",
  );

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("You must be an owner or manager to import inventory");
  }

  // ── Step 1: Count existing rows ──
  const { count: beforeCount } = await supabase
    .from("vehicle_inventory")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  console.log("[executeImport] BEFORE — existing vehicles:", beforeCount ?? 0);

  // ── Step 2: Delete existing rows (replace mode only) ──
  let deleted = 0;
  if (mode === "replace" && (beforeCount ?? 0) > 0) {
    const { error: deleteErr, count: deleteCount } = await supabase
      .from("vehicle_inventory")
      .delete({ count: "exact" })
      .eq("event_id", eventId);

    if (deleteErr) {
      console.error("[executeImport] DELETE failed:", deleteErr.message, "code:", deleteErr.code);
      throw new Error(`Failed to clear existing inventory: ${deleteErr.message}`);
    }

    deleted = deleteCount ?? 0;
    console.log("[executeImport] DELETED:", deleted, "existing vehicles");
  }

  // ── Step 3: Map and validate all rows ──
  // For append mode, still track existing stocks to skip duplicates
  let existingStocks = new Set<string>();
  if (mode === "append") {
    const { data: existing } = await supabase
      .from("vehicle_inventory")
      .select("stock_number")
      .eq("event_id", eventId);

    existingStocks = new Set(
      (existing ?? []).map((v) => v.stock_number?.toLowerCase()).filter(Boolean) as string[],
    );
  }

  let imported = 0;
  let errors = 0;
  let duplicatesSkipped = 0;
  const errorDetails: { row: number; message: string }[] = [];

  const validRows: { rowNum: number; data: VehicleRow }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, unknown> = {};

    for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
      if (
        dbField &&
        dbField !== "__skip__" &&
        raw[spreadsheetCol] !== undefined
      ) {
        mapped[dbField] = raw[spreadsheetCol];
      }
    }

    // Clean empties
    for (const key of Object.keys(mapped)) {
      if (mapped[key] === "" || mapped[key] === undefined) {
        mapped[key] = null;
      }
    }

    // Check duplicate (append mode only)
    if (mode === "append") {
      const stockNum = String(mapped.stock_number ?? "").toLowerCase();
      if (stockNum && existingStocks.has(stockNum)) {
        duplicatesSkipped++;
        continue;
      }
    }

    const parsed = vehicleRowSchema.safeParse(mapped);
    if (!parsed.success) {
      errors++;
      errorDetails.push({
        row: i + 1,
        message: parsed.error.issues
          .map((e) => `${e.path}: ${e.message}`)
          .join("; "),
      });
      continue;
    }

    validRows.push({ rowNum: i + 1, data: parsed.data });
    // Track newly added stocks for intra-file duplicate detection
    const stockNum = String(parsed.data.stock_number ?? "").toLowerCase();
    if (stockNum) existingStocks.add(stockNum);
  }

  console.log(
    "[executeImport] valid rows:",
    validRows.length,
    "errors:",
    errors,
    "dupes:",
    duplicatesSkipped,
  );

  // Log sample row for debugging
  if (validRows.length > 0) {
    console.log("[executeImport] sample row[0]:", {
      event_id: eventId,
      ...validRows[0].data,
    });
  }

  // ── Step 4: Batch insert in chunks of 250 ──
  const BATCH_SIZE = 250;
  for (let start = 0; start < validRows.length; start += BATCH_SIZE) {
    const batch = validRows.slice(start, start + BATCH_SIZE);

    const insertData = batch.map((r) => ({
      event_id: eventId,
      hat_number: r.data.hat_number ?? null,
      stock_number: r.data.stock_number ?? null,
      vin: r.data.vin ?? null,
      year: r.data.year ?? null,
      make: r.data.make ?? null,
      model: r.data.model ?? null,
      trim: r.data.trim ?? null,
      body_style: r.data.body_style ?? null,
      color: r.data.color ?? null,
      mileage: r.data.mileage ?? null,
      age_days: r.data.age_days ?? null,
      drivetrain: r.data.drivetrain ?? null,
      acquisition_cost: r.data.acquisition_cost ?? null,
      jd_trade_clean: r.data.jd_trade_clean ?? null,
      jd_retail_clean: r.data.jd_retail_clean ?? null,
      asking_price_115: r.data.asking_price_115 ?? null,
      asking_price_120: r.data.asking_price_120 ?? null,
      asking_price_125: r.data.asking_price_125 ?? null,
      asking_price_130: r.data.asking_price_130 ?? null,
      profit_115: r.data.profit_115 ?? null,
      profit_120: r.data.profit_120 ?? null,
      profit_125: r.data.profit_125 ?? null,
      profit_130: r.data.profit_130 ?? null,
      retail_spread: r.data.retail_spread ?? null,
      label: r.data.label ?? null,
      notes: r.data.notes ?? null,
      status: "available" as const,
    }));

    // Use .select('id') to get actual inserted rows back — this verifies
    // the INSERT actually succeeded and wasn't silently blocked by RLS.
    const { data: insertedRows, error: insertErr } = await supabase
      .from("vehicle_inventory")
      .insert(insertData)
      .select("id");

    const actualInserted = insertedRows?.length ?? 0;

    console.log(
      `[executeImport] batch ${start}-${start + batch.length}:`,
      insertErr
        ? `ERROR: ${insertErr.message} (code: ${insertErr.code})`
        : `OK — ${actualInserted}/${batch.length} rows confirmed`,
    );

    if (insertErr) {
      // Mark entire batch as error
      for (const r of batch) {
        errors++;
        errorDetails.push({ row: r.rowNum, message: insertErr.message });
      }
    } else if (actualInserted === 0) {
      // INSERT returned no error but also no rows — RLS silently blocked it
      console.error(
        "[executeImport] SILENT RLS BLOCK: insert returned no error but 0 rows!",
        "event_id:",
        eventId,
        "user:",
        user.email,
      );
      for (const r of batch) {
        errors++;
        errorDetails.push({
          row: r.rowNum,
          message:
            "Insert was silently blocked (likely RLS). Check event membership and role.",
        });
      }
    } else {
      imported += actualInserted;
      if (actualInserted < batch.length) {
        console.warn(
          `[executeImport] PARTIAL INSERT: ${actualInserted}/${batch.length}`,
        );
      }
    }
  }

  // ── Step 5: Verify final count ──
  const { count: afterCount } = await supabase
    .from("vehicle_inventory")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  console.log(
    "[executeImport] DONE — mode:", mode,
    "| deleted:", deleted,
    "| imported:", imported,
    "| errors:", errors,
    "| dupes:", duplicatesSkipped,
    "| total in DB now:", afterCount,
  );

  // ── Step 6: Revalidate dashboard and inventory pages ──
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/inventory");

  return {
    success: errors === 0,
    imported,
    deleted,
    errors,
    duplicatesSkipped,
    errorDetails,
    mode,
  };
}

// ────────────────────────────────────────────────────────
// Roster Import — imports roster rows from "Roster & Tables" sheet
// ────────────────────────────────────────────────────────
const VALID_ROLES = ["sales", "team_leader", "fi_manager", "closer", "manager"] as const;

function normalizeRole(raw: string | null | undefined): (typeof VALID_ROLES)[number] {
  if (!raw) return "sales";
  const lower = raw.toLowerCase().trim();
  if (lower.includes("team") && lower.includes("lead")) return "team_leader";
  if (lower.includes("fi") || lower.includes("f&i") || lower.includes("finance")) return "fi_manager";
  if (lower.includes("clos")) return "closer";
  if (lower.includes("manager") || lower.includes("mgr")) return "manager";
  return "sales";
}

function normalizeConfirmed(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase().trim();
  return ["yes", "y", "true", "1", "confirmed", "x", "✓", "✔"].includes(lower);
}

// ── Roster name validation ──
// The "Roster & Tables" sheet has mixed content: section headers
// ("Dealer Information", "City", "Commission Information", percentages, etc.)
// alongside actual sales people names ("1 NATE HARDING", "2 IRELAND COMBS").
// This function strips leading row numbers and rejects junk patterns.
const ROSTER_JUNK_RE = [
  /^dealer/i, /^city$/i, /^state$/i, /^zip$/i, /^address/i,
  /^commission/i, /^cap\s*letter/i, /^closer\s*\d/i,
  /^team\s*leader/i, /^information/i, /^phone$/i,
  /^confirmed/i, /^according/i, /^sales\s*people/i,
  /^setup$/i, /^lender/i, /^drivetrain/i, /^drive\s*train/i,
  /^f\s*&?\s*i/i, /^finance/i, /^manager/i, /^closer$/i,
  /^notes?$/i, /^email$/i, /^role$/i, /^position$/i,
  /^name$/i, /^total/i, /^subtotal/i, /^grand/i,
  /^percent/i, /^pct$/i, /^amount/i, /^date$/i,
  /^event$/i, /^roster$/i, /^table/i, /^sheet/i,
];

function cleanRosterName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.trim();
  if (!name || name.length < 2) return null;

  // Strip leading row number + space/period (e.g. "1 NATE HARDING" or "1. Nate")
  name = name.replace(/^\d+[\s.)\-]+/, "").trim();
  if (!name || name.length < 2) return null;

  // Reject pure numbers, percentages, symbols-only
  if (/^[\d\s%#$.,\-/()]+$/.test(name)) return null;

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(name)) return null;

  // Reject known junk patterns
  for (const re of ROSTER_JUNK_RE) {
    if (re.test(name)) return null;
  }

  // A real name should have at least 2 alpha characters
  const alphaOnly = name.replace(/[^a-zA-Z]/g, "");
  if (alphaOnly.length < 2) return null;

  return name;
}

export async function executeRosterImport(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
  eventId: string,
  mode: ImportMode = "replace",
): Promise<ImportResult> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  console.log("[rosterImport] user:", user.email, "event_id:", eventId, "mode:", mode, "rows:", rows.length);

  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("You must be an owner or manager to import roster");
  }

  // ── Step 1: Count existing ──
  const { count: beforeCount } = await supabase
    .from("roster")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  console.log("[rosterImport] BEFORE — existing roster:", beforeCount ?? 0);

  // ── Step 2: Delete existing (replace mode) ──
  let deleted = 0;
  if (mode === "replace" && (beforeCount ?? 0) > 0) {
    const { error: deleteErr, count: deleteCount } = await supabase
      .from("roster")
      .delete({ count: "exact" })
      .eq("event_id", eventId);

    if (deleteErr) {
      throw new Error(`Failed to clear existing roster: ${deleteErr.message}`);
    }
    deleted = deleteCount ?? 0;
    console.log("[rosterImport] DELETED:", deleted, "existing roster members");
  }

  // ── Step 3: Map and validate rows ──
  let imported = 0;
  let errors = 0;
  const errorDetails: { row: number; message: string }[] = [];

  const validRows: { rowNum: number; name: string; phone: string | null; confirmed: boolean; role: (typeof VALID_ROLES)[number]; notes: string | null }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, string | null> = {};

    for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
      if (dbField && dbField !== "__skip__" && raw[spreadsheetCol] !== undefined) {
        const val = raw[spreadsheetCol];
        mapped[dbField] = val != null ? String(val).trim() : null;
      }
    }

    // Name is required — cleanRosterName strips leading numbers and rejects junk
    const name = cleanRosterName(mapped.name);
    if (!name) {
      // Skip empty/junk rows (section headers, blanks, percentages, etc.)
      continue;
    }

    validRows.push({
      rowNum: i + 1,
      name,
      phone: mapped.phone || null,
      confirmed: normalizeConfirmed(mapped.confirmed),
      role: normalizeRole(mapped.role),
      notes: [mapped.setup, mapped.according_to, mapped.lenders, mapped.drivetrain]
        .filter(Boolean)
        .join(" | ") || null,
    });
  }

  const skippedCount = rows.length - validRows.length;
  console.log(
    `[rosterImport] FILTER RESULTS: ${validRows.length} accepted, ${skippedCount} skipped (junk/empty) out of ${rows.length} total rows`,
  );

  if (validRows.length > 0) {
    console.log("[rosterImport] first 5 accepted:", validRows.slice(0, 5).map((r) => r.name));
  }

  // ── Step 4: Insert ──
  const insertData = validRows.map((r) => ({
    event_id: eventId,
    name: r.name,
    phone: r.phone,
    role: r.role,
    confirmed: r.confirmed,
    notes: r.notes,
    active: true,
  }));

  const { data: insertedRows, error: insertErr } = await supabase
    .from("roster")
    .insert(insertData)
    .select("id");

  if (insertErr) {
    console.error("[rosterImport] INSERT ERROR:", insertErr.message);
    errors = validRows.length;
    for (const r of validRows) {
      errorDetails.push({ row: r.rowNum, message: insertErr.message });
    }
  } else {
    imported = insertedRows?.length ?? 0;
    console.log("[rosterImport] INSERTED:", imported, "roster members");
  }

  // ── Step 5: Verify ──
  const { count: afterCount } = await supabase
    .from("roster")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  console.log("[rosterImport] DONE — deleted:", deleted, "| imported:", imported, "| total now:", afterCount);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/roster");

  return {
    success: errors === 0,
    imported,
    deleted,
    errors,
    duplicatesSkipped: 0,
    errorDetails,
    mode,
  };
}
