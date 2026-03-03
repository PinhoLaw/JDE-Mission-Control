/**
 * import-validation-preview.ts
 * ============================
 * Client-side pre-import validation. Runs the same filtering logic as the
 * server-side import functions but without any database calls. Returns a
 * preview of what will be imported vs skipped, with reasons for each skip.
 *
 * Pure utility module — no "use server" / "use client" directives.
 */

import type { TabType } from "./column-mapping";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export type SkipReason =
  | "empty_row"
  | "missing_required"
  | "fluff_no_stock"
  | "fluff_long_name"
  | "duplicate"
  | "invalid_data";

export interface SkippedRow {
  rowIndex: number;
  reason: SkipReason;
  detail: string;
}

export interface ValidationPreview {
  tabType: TabType;
  totalRows: number;
  importableRows: number;
  skippedRows: SkippedRow[];
  /** First 3 importable rows mapped to DB field names */
  sampleRows: Record<string, unknown>[];
  /** Counts by skip reason */
  skipSummary: Record<SkipReason, number>;
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function buildMappedRow(
  raw: Record<string, unknown>,
  columnMap: Record<string, string>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [col, field] of Object.entries(columnMap)) {
    if (field && field !== "__skip__") {
      mapped[field] = raw[col] ?? null;
    }
  }
  return mapped;
}

function str(val: unknown): string {
  return val != null ? String(val).trim() : "";
}

function buildResult(
  tabType: TabType,
  totalRows: number,
  skippedRows: SkippedRow[],
  sampleRows: Record<string, unknown>[],
): ValidationPreview {
  const skipSummary: Record<SkipReason, number> = {
    empty_row: 0,
    missing_required: 0,
    fluff_no_stock: 0,
    fluff_long_name: 0,
    duplicate: 0,
    invalid_data: 0,
  };
  for (const s of skippedRows) {
    skipSummary[s.reason]++;
  }

  return {
    tabType,
    totalRows,
    importableRows: totalRows - skippedRows.length,
    skippedRows,
    sampleRows,
    skipSummary,
  };
}

// ────────────────────────────────────────────────────────
// Per-Type Validators
// ────────────────────────────────────────────────────────

/** Mirrors bulkImportDeals fluff filters + dedup */
function validateDeals(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
): ValidationPreview {
  const skippedRows: SkippedRow[] = [];
  const sampleRows: Record<string, unknown>[] = [];
  const seenStocks = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const mapped = buildMappedRow(rows[i], columnMap);

    const customerName = str(mapped.customer_name);
    if (!customerName) {
      skippedRows.push({
        rowIndex: i,
        reason: "empty_row",
        detail: "No customer name",
      });
      continue;
    }

    const stockNumber = str(mapped.stock_number);
    if (!stockNumber) {
      skippedRows.push({
        rowIndex: i,
        reason: "fluff_no_stock",
        detail: "No stock number — likely a note row",
      });
      continue;
    }

    if (customerName.length > 50) {
      skippedRows.push({
        rowIndex: i,
        reason: "fluff_long_name",
        detail: `Customer name too long (${customerName.length} chars)`,
      });
      continue;
    }

    const stockKey = stockNumber.toUpperCase();
    if (seenStocks.has(stockKey)) {
      skippedRows.push({
        rowIndex: i,
        reason: "duplicate",
        detail: `Duplicate stock# ${stockNumber}`,
      });
      continue;
    }
    seenStocks.add(stockKey);

    if (sampleRows.length < 3) sampleRows.push(mapped);
  }

  return buildResult("deals", rows.length, skippedRows, sampleRows);
}

/** Empty row check + stock# dedup */
function validateInventory(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
): ValidationPreview {
  const skippedRows: SkippedRow[] = [];
  const sampleRows: Record<string, unknown>[] = [];
  const seenStocks = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const mapped = buildMappedRow(rows[i], columnMap);

    const hasData = Object.values(mapped).some(
      (v) => v != null && String(v).trim() !== "",
    );
    if (!hasData) {
      skippedRows.push({
        rowIndex: i,
        reason: "empty_row",
        detail: "No data in row",
      });
      continue;
    }

    const stock = str(mapped.stock_number).toUpperCase();
    if (stock && seenStocks.has(stock)) {
      skippedRows.push({
        rowIndex: i,
        reason: "duplicate",
        detail: `Duplicate stock# ${stock}`,
      });
      continue;
    }
    if (stock) seenStocks.add(stock);

    if (sampleRows.length < 3) sampleRows.push(mapped);
  }

  return buildResult("inventory", rows.length, skippedRows, sampleRows);
}

/** Name required, dedup by name */
function validateRoster(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
): ValidationPreview {
  const skippedRows: SkippedRow[] = [];
  const sampleRows: Record<string, unknown>[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const mapped = buildMappedRow(rows[i], columnMap);

    const name = str(mapped.name);
    if (!name || !/[a-zA-Z]/.test(name)) {
      skippedRows.push({
        rowIndex: i,
        reason: "missing_required",
        detail: "No valid name",
      });
      continue;
    }

    const nameKey = name.toUpperCase();
    if (seenNames.has(nameKey)) {
      skippedRows.push({
        rowIndex: i,
        reason: "duplicate",
        detail: `Duplicate name: ${name}`,
      });
      continue;
    }
    seenNames.add(nameKey);

    if (sampleRows.length < 3) sampleRows.push(mapped);
  }

  return buildResult("roster", rows.length, skippedRows, sampleRows);
}

/** Name required, dedup by name */
function validateLenders(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
): ValidationPreview {
  const skippedRows: SkippedRow[] = [];
  const sampleRows: Record<string, unknown>[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const mapped = buildMappedRow(rows[i], columnMap);

    const name = str(mapped.name);
    if (!name) {
      skippedRows.push({
        rowIndex: i,
        reason: "missing_required",
        detail: "No lender name",
      });
      continue;
    }

    const nameKey = name.toUpperCase();
    if (seenNames.has(nameKey)) {
      skippedRows.push({
        rowIndex: i,
        reason: "duplicate",
        detail: `Duplicate lender: ${name}`,
      });
      continue;
    }
    seenNames.add(nameKey);

    if (sampleRows.length < 3) sampleRows.push(mapped);
  }

  return buildResult("lenders", rows.length, skippedRows, sampleRows);
}

/** Zip code required, dedup by zip */
function validateCampaigns(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
): ValidationPreview {
  const skippedRows: SkippedRow[] = [];
  const sampleRows: Record<string, unknown>[] = [];
  const seenZips = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const mapped = buildMappedRow(rows[i], columnMap);

    const zip = str(mapped.zip_code);
    if (!zip) {
      skippedRows.push({
        rowIndex: i,
        reason: "missing_required",
        detail: "No zip code",
      });
      continue;
    }

    if (seenZips.has(zip)) {
      skippedRows.push({
        rowIndex: i,
        reason: "duplicate",
        detail: `Duplicate zip: ${zip}`,
      });
      continue;
    }
    seenZips.add(zip);

    if (sampleRows.length < 3) sampleRows.push(mapped);
  }

  return buildResult("campaigns", rows.length, skippedRows, sampleRows);
}

// ────────────────────────────────────────────────────────
// Main Entry Point
// ────────────────────────────────────────────────────────

/**
 * Validate data for any tab type before import.
 * Returns a preview of importable vs skipped rows with reasons.
 */
export function validateBeforeImport(
  rows: Record<string, unknown>[],
  columnMap: Record<string, string>,
  tabType: TabType,
): ValidationPreview {
  switch (tabType) {
    case "deals":
      return validateDeals(rows, columnMap);
    case "inventory":
      return validateInventory(rows, columnMap);
    case "roster":
      return validateRoster(rows, columnMap);
    case "lenders":
      return validateLenders(rows, columnMap);
    case "campaigns":
      return validateCampaigns(rows, columnMap);
    default:
      return buildResult(tabType, rows.length, [], []);
  }
}

/**
 * Format skip summary for display in the UI.
 */
export function formatSkipSummary(
  summary: Record<SkipReason, number>,
): string {
  const parts: string[] = [];
  if (summary.fluff_no_stock > 0)
    parts.push(`${summary.fluff_no_stock} notes (no stock#)`);
  if (summary.duplicate > 0)
    parts.push(`${summary.duplicate} duplicates`);
  if (summary.fluff_long_name > 0)
    parts.push(`${summary.fluff_long_name} long names`);
  if (summary.empty_row > 0)
    parts.push(`${summary.empty_row} empty rows`);
  if (summary.missing_required > 0)
    parts.push(`${summary.missing_required} missing required fields`);
  if (summary.invalid_data > 0)
    parts.push(`${summary.invalid_data} invalid`);
  return parts.join(" · ");
}
