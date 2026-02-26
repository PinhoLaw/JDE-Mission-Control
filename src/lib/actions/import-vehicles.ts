"use server";

import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
// NOTE: ExcelJS is loaded via dynamic import() inside parseExcel() only.
// Top-level import crashes Vercel serverless functions because ExcelJS
// pulls in Node.js stream/crypto modules that fail to bundle.

// ────────────────────────────────────────────────────────
// Cell value → string helper (handles ExcelJS rich types)
// ────────────────────────────────────────────────────────
function cellToString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    // Return ISO string for dates so Zod coerce can parse them
    return value.toISOString();
  }
  if (typeof value === "object") {
    // ExcelJS rich text: { richText: [{ text: "..." }, ...] }
    if ("richText" in (value as Record<string, unknown>)) {
      const rt = (value as { richText: { text: string }[] }).richText;
      return rt.map((segment) => segment.text).join("");
    }
    // ExcelJS hyperlink: { text: "...", hyperlink: "..." }
    if ("text" in (value as Record<string, unknown>)) {
      return String((value as { text: unknown }).text);
    }
    // ExcelJS formula: { formula: "...", result: ... }
    if ("result" in (value as Record<string, unknown>)) {
      const result = (value as { result: unknown }).result;
      return result != null ? String(result) : null;
    }
  }
  return String(value);
}

// ────────────────────────────────────────────────────────
// Parse spreadsheet (server action — accepts FormData)
// Supports .xlsx and .csv files
// ────────────────────────────────────────────────────────
export interface ParsedSpreadsheet {
  headers: string[];
  rows: Record<string, unknown>[];
  fileName: string;
  rowCount: number;
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

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    throw new Error("Spreadsheet is empty or has no data rows");
  }

  // Extract headers from row 1 (ExcelJS row.values is 1-indexed → slot 0 is undefined)
  const rawHeaderValues = worksheet.getRow(1).values;
  const headers: string[] = [];
  if (Array.isArray(rawHeaderValues)) {
    for (let i = 1; i < rawHeaderValues.length; i++) {
      const val = rawHeaderValues[i];
      headers.push(val?.toString().trim() || `col${i}`);
    }
  }

  if (headers.length === 0) {
    throw new Error("No column headers found in the first row");
  }

  // Extract data rows
  const rows: Record<string, unknown>[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip header row

    const rowValues = Array.isArray(row.values) ? row.values.slice(1) : [];
    const rowObj: Record<string, unknown> = {};

    // Map each cell to its header, converting ExcelJS cell values to strings
    headers.forEach((header, index) => {
      rowObj[header] = cellToString(rowValues[index]) ?? null;
    });

    // Only include rows that have at least one non-null value
    const hasData = Object.values(rowObj).some((v) => v != null && v !== "");
    if (hasData) {
      rows.push(rowObj);
    }
  });

  if (rows.length === 0) {
    throw new Error("Spreadsheet has headers but no data rows");
  }

  return { headers, rows, fileName, rowCount: rows.length };
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

  return { headers, rows, fileName, rowCount: rows.length };
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

export interface ImportResult {
  success: boolean;
  imported: number;
  errors: number;
  duplicatesSkipped: number;
  errorDetails: { row: number; message: string }[];
}

// ────────────────────────────────────────────────────────
// Validate rows (dry-run)
// ────────────────────────────────────────────────────────
export async function validateImportRows(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
  eventId: string,
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

  // Get existing stock numbers for duplicate detection
  const { data: existing } = await supabase
    .from("vehicle_inventory")
    .select("stock_number")
    .eq("event_id", eventId);

  const existingStocks = new Set(
    (existing ?? []).map((v) => v.stock_number?.toLowerCase()).filter(Boolean),
  );

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

    // Check duplicate stock number
    const stockNum = String(mapped.stock_number ?? "").toLowerCase();
    if (stockNum && existingStocks.has(stockNum)) {
      errors.push(`Duplicate stock_number: "${mapped.stock_number}" already exists`);
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
// Execute the import (batch insert)
// ────────────────────────────────────────────────────────
export async function executeImport(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
  eventId: string,
): Promise<ImportResult> {
  const supabase = await createClient();

  // Auth + membership check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("You must be an owner or manager to import inventory");
  }

  // Get existing stock numbers
  const { data: existing } = await supabase
    .from("vehicle_inventory")
    .select("stock_number")
    .eq("event_id", eventId);

  const existingStocks = new Set(
    (existing ?? []).map((v) => v.stock_number?.toLowerCase()).filter(Boolean),
  );

  let imported = 0;
  let errors = 0;
  let duplicatesSkipped = 0;
  const errorDetails: { row: number; message: string }[] = [];

  // Map and validate all rows
  const validRows: { rowNum: number; data: VehicleRow }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, unknown> = {};

    for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
      if (dbField && dbField !== "__skip__" && raw[spreadsheetCol] !== undefined) {
        mapped[dbField] = raw[spreadsheetCol];
      }
    }

    // Clean empties
    for (const key of Object.keys(mapped)) {
      if (mapped[key] === "" || mapped[key] === undefined) {
        mapped[key] = null;
      }
    }

    // Check duplicate
    const stockNum = String(mapped.stock_number ?? "").toLowerCase();
    if (stockNum && existingStocks.has(stockNum)) {
      duplicatesSkipped++;
      continue;
    }

    const parsed = vehicleRowSchema.safeParse(mapped);
    if (!parsed.success) {
      errors++;
      errorDetails.push({
        row: i + 1,
        message: parsed.error.issues.map((e) => `${e.path}: ${e.message}`).join("; "),
      });
      continue;
    }

    validRows.push({ rowNum: i + 1, data: parsed.data });
    // Track newly added stocks to catch intra-file duplicates
    if (stockNum) existingStocks.add(stockNum);
  }

  // Batch insert in chunks of 250
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

    const { error: insertErr } = await supabase
      .from("vehicle_inventory")
      .insert(insertData);

    if (insertErr) {
      // Mark entire batch as error
      for (const r of batch) {
        errors++;
        errorDetails.push({ row: r.rowNum, message: insertErr.message });
      }
    } else {
      imported += batch.length;
    }
  }

  return { success: errors === 0, imported, errors, duplicatesSkipped, errorDetails };
}
