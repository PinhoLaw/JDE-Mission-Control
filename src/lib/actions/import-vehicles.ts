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

// Known inventory header keywords — used to detect the real header row
// when row 1 is a title like "FORD INVENTORY" instead of column headers
const HEADER_KEYWORDS = new Set([
  "stock", "stk", "vin", "year", "yr", "make", "model", "trim", "series",
  "class", "body", "color", "ext", "mileage", "miles", "odometer", "odo",
  "age", "days", "cost", "unit", "price", "trade", "retail", "diff",
  "drivetrain", "drive", "type", "hat", "label", "notes", "profit",
  "jd", "power", "clean", "asking", "spread", "acquisition",
  // Roster keywords too
  "salespeople", "salesperson", "phone", "confirmed", "setup", "lenders",
]);

// ────────────────────────────────────────────────────────
// Content-based column name inference
// When headers are generic (col1, col2...) because formula cells had no cached
// result, we sample the first 10 data rows and pattern-match to infer names.
// ────────────────────────────────────────────────────────
const CAR_MAKES = new Set([
  "ford", "chevrolet", "chevy", "ram", "dodge", "jeep", "chrysler",
  "toyota", "honda", "hyundai", "kia", "nissan", "subaru", "mazda",
  "bmw", "mercedes", "audi", "lexus", "acura", "infiniti", "volvo",
  "volkswagen", "vw", "buick", "cadillac", "gmc", "lincoln", "pontiac",
  "saturn", "mercury", "mitsubishi", "suzuki", "genesis", "tesla",
  "rivian", "lucid", "mini", "fiat", "alfa", "jaguar", "land",
  "porsche", "maserati", "bentley", "rolls", "ferrari", "lamborghini",
]);

const BODY_STYLES = new Set([
  "sedan", "suv", "truck", "van", "coupe", "wagon", "hatchback",
  "convertible", "minivan", "crossover", "pickup", "cab", "crew",
  "regular", "extended", "sport", "4dr", "2dr", "4d", "2d",
]);

const COLORS = new Set([
  "black", "white", "silver", "gray", "grey", "red", "blue", "green",
  "brown", "gold", "orange", "yellow", "purple", "beige", "tan",
  "maroon", "burgundy", "charcoal", "pearl", "bronze", "champagne",
  "ivory", "copper", "pewter", "platinum", "magnetic", "shadow",
  "ruby", "sapphire", "midnight", "oxford", "race", "rapid",
]);

// Infer a single column's identity from its sample values
function inferColumnType(
  values: string[],
  assigned: Set<string>,
): string | null {
  if (values.length === 0) return null;

  // VIN: 17 alphanumeric characters
  if (
    !assigned.has("VIN #") &&
    values.filter((v) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(v)).length >=
      values.length * 0.5
  ) {
    return "VIN #";
  }

  // Stock #: alphanumeric codes like "MF1378A", "T12345", "24-1234"
  // Must have mix of letters+digits, 4-12 chars
  if (
    !assigned.has("Stock #") &&
    values.filter((v) => /^[A-Z0-9][-A-Z0-9]{2,11}$/i.test(v) && /[A-Z]/i.test(v) && /\d/.test(v)).length >=
      values.length * 0.5
  ) {
    return "Stock #";
  }

  // Year: 4-digit numbers 1990-2030
  if (
    !assigned.has("Year") &&
    values.filter((v) => /^\d{4}$/.test(v) && Number(v) >= 1990 && Number(v) <= 2030).length >=
      values.length * 0.5
  ) {
    return "Year";
  }

  // Make: known car brands
  if (
    !assigned.has("Make") &&
    values.filter((v) => CAR_MAKES.has(v.toLowerCase().trim().split(/\s/)[0])).length >=
      values.length * 0.3
  ) {
    return "Make";
  }

  // Color: known color names
  if (
    !assigned.has("Color") &&
    values.filter((v) => {
      const words = v.toLowerCase().trim().split(/\s+/);
      return words.some((w) => COLORS.has(w));
    }).length >= values.length * 0.3
  ) {
    return "Color";
  }

  // Body Style / Class: known body types
  if (
    !assigned.has("Class") &&
    values.filter((v) => {
      const words = v.toLowerCase().trim().split(/[\s/]+/);
      return words.some((w) => BODY_STYLES.has(w));
    }).length >= values.length * 0.3
  ) {
    return "Class";
  }

  // For numeric columns, classify by range
  const nums = values
    .map((v) => {
      const cleaned = v.replace(/[$,\s]/g, "");
      return Number(cleaned);
    })
    .filter((n) => !isNaN(n) && isFinite(n));

  if (nums.length >= values.length * 0.4) {
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const allPositive = nums.every((n) => n >= 0);
    const hasNegative = nums.some((n) => n < 0);

    // Age: small integers 1-999 (days on lot)
    if (
      !assigned.has("Age") &&
      avg >= 1 && avg <= 500 &&
      nums.every((n) => n >= 0 && n <= 999 && Number.isInteger(n))
    ) {
      return "Age";
    }

    // Odometer: large integers 1000-300000
    if (
      !assigned.has("Odometer") &&
      avg >= 5000 && avg <= 200000 &&
      allPositive &&
      nums.every((n) => n >= 100 && n <= 500000)
    ) {
      return "Odometer";
    }

    // DIFF: can be negative, typically -15000 to +15000
    if (
      !assigned.has("DIFF") &&
      hasNegative &&
      avg > -20000 && avg < 20000
    ) {
      return "DIFF";
    }

    // Dollar amounts in cost/trade/retail range ($5k-$150k)
    if (allPositive && avg >= 3000 && avg <= 150000) {
      // Try to distinguish Unit Cost vs Clean Trade vs Clean Retail vs asking prices
      // by position — the first unassigned dollar column gets the most likely label
      for (const label of ["Unit Cost", "Clean Trade", "Clean Retail", "115%", "120%", "125%", "130%"]) {
        if (!assigned.has(label)) return label;
      }
    }
  }

  return null;
}

// Infer meaningful header names from data content when headers are generic (col1, col2...)
function inferColumnNames(
  headers: string[],
  rows: Record<string, unknown>[],
): { headers: string[]; rows: Record<string, unknown>[]; inferred: boolean } {
  // Count how many headers are generic "colN"
  const genericCount = headers.filter((h) => /^col\d+$/i.test(h)).length;
  if (genericCount < headers.length * 0.5) {
    // Most headers are real — no inference needed
    return { headers, rows, inferred: false };
  }

  const sampleRows = rows.slice(0, 10);
  const newHeaders = [...headers];
  const assigned = new Set<string>();
  const renames: Record<string, string> = {}; // old → new

  // First pass: non-generic headers stay as-is
  for (const h of headers) {
    if (!/^col\d+$/i.test(h)) assigned.add(h);
  }

  // Second pass: infer generic columns
  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const oldName = headers[colIdx];
    if (!/^col\d+$/i.test(oldName)) continue;

    const values = sampleRows
      .map((r) => r[oldName])
      .filter((v) => v != null && String(v).trim() !== "")
      .map((v) => String(v).trim());

    if (values.length === 0) continue;

    const inferred = inferColumnType(values, assigned);
    if (inferred) {
      newHeaders[colIdx] = inferred;
      assigned.add(inferred);
      renames[oldName] = inferred;
    }
  }

  // If nothing was inferred, bail
  if (Object.keys(renames).length === 0) {
    return { headers, rows, inferred: false };
  }

  // Re-key row objects to use new header names
  const newRows = rows.map((row) => {
    const newRow: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      newRow[renames[key] ?? key] = val;
    }
    return newRow;
  });

  console.log(
    `[INFER] Renamed ${Object.keys(renames).length} generic columns:`,
    Object.entries(renames)
      .map(([old, neu]) => `${old} → "${neu}"`)
      .join(", "),
  );

  return { headers: newHeaders, rows: newRows, inferred: true };
}

// Helper: rename a single column in headers + re-key row objects
function renameColumn(
  headers: string[],
  rows: Record<string, unknown>[],
  colIdx: number,
  newName: string,
): { headers: string[]; rows: Record<string, unknown>[] } {
  const oldName = headers[colIdx];
  if (oldName === newName) return { headers, rows };
  const newHeaders = [...headers];
  newHeaders[colIdx] = newName;
  const newRows = rows.map((row) => {
    const newRow: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      newRow[key === oldName ? newName : key] = val;
    }
    return newRow;
  });
  console.log(`[INFER] Inferred "${oldName}" → "${newName}"`);
  return { headers: newHeaders, rows: newRows };
}

// Infer positional columns: Model (after Make), Series/Trim (after Model or Class)
function inferPositionalColumns(
  headers: string[],
  rows: Record<string, unknown>[],
): { headers: string[]; rows: Record<string, unknown>[] } {
  let h = headers;
  let r = rows;
  const sampleRows = rows.slice(0, 10);

  // ── Model: column right after Make ──
  const makeIdx = h.indexOf("Make");
  if (makeIdx >= 0) {
    for (let offset = 1; offset <= 2; offset++) {
      const idx = makeIdx + offset;
      if (idx >= h.length) break;
      if (!/^col\d+$/i.test(h[idx])) continue; // already named

      const values = sampleRows
        .map((row) => row[h[idx]])
        .filter((v) => v != null && String(v).trim() !== "")
        .map((v) => String(v).trim());

      if (values.length < 3) continue;

      // Model values: short text (1-35 chars), not car makes, not colors
      // NOTE: Allow pure numbers like "2500" (RAM 2500, F-150, etc.)
      const looksLikeModel = values.filter((v) => {
        if (v.length < 1 || v.length > 35) return false;
        if (CAR_MAKES.has(v.toLowerCase())) return false;
        if (COLORS.has(v.toLowerCase())) return false;
        return true;
      }).length;

      if (looksLikeModel >= values.length * 0.5) {
        const renamed = renameColumn(h, r, idx, "Model");
        h = renamed.headers;
        r = renamed.rows;
        break;
      }
    }
  }

  // ── Series/Trim: look for a column with multi-word strings like "LX AWD", "V-Series RWD" ──
  // Typically comes after Model or Class. Check remaining generic columns.
  const modelIdx = h.indexOf("Model");
  const classIdx = h.indexOf("Class");
  const anchor = modelIdx >= 0 ? modelIdx : classIdx;
  if (anchor >= 0 && !h.includes("Series")) {
    for (let offset = 1; offset <= 3; offset++) {
      const idx = anchor + offset;
      if (idx >= h.length) break;
      if (!/^col\d+$/i.test(h[idx])) continue;

      const values = sampleRows
        .map((row) => row[h[idx]])
        .filter((v) => v != null && String(v).trim() !== "")
        .map((v) => String(v).trim());

      if (values.length < 3) continue;

      // Series/Trim values: 2-50 chars, mostly multi-word or contain letters
      // Not pure numbers, not car makes, not colors, not body styles
      const looksLikeTrim = values.filter((v) => {
        if (v.length < 2 || v.length > 50) return false;
        if (/^\d+$/.test(v)) return false;
        if (/^[$\d,.\-\s]+$/.test(v)) return false; // dollar amounts
        if (CAR_MAKES.has(v.toLowerCase())) return false;
        if (COLORS.has(v.toLowerCase().split(/\s/)[0])) return false;
        return /[a-zA-Z]/.test(v); // must contain letters
      }).length;

      if (looksLikeTrim >= values.length * 0.4) {
        const renamed = renameColumn(h, r, idx, "Series");
        h = renamed.headers;
        r = renamed.rows;
        break;
      }
    }
  }

  return { headers: h, rows: r };
}

// Score how "header-like" a row is by counting how many cells contain known keywords.
// IMPORTANT: Uses row.getCell(i) + extractCellValue() so formula cells are resolved
// to their display text instead of stringifying as "[object Object]".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreHeaderRow(row: any): number {
  const colCount = row.cellCount ?? row.values?.length ?? 0;
  let score = 0;
  for (let i = 1; i <= colCount; i++) {
    let str: string | null = null;
    try {
      const cell = row.getCell(i);
      str = extractCellValue(cell);
    } catch {
      // Fallback to sparse values array
      const vals = Array.isArray(row.values) ? row.values : [];
      if (vals[i] != null) str = cellToString(vals[i]);
    }
    if (!str) continue;
    const lower = str.toLowerCase().trim();
    if (!lower) continue;
    // Split into words and check each against keywords
    const words = lower.replace(/[^a-z0-9\s]/g, "").split(/\s+/);
    for (const w of words) {
      if (HEADER_KEYWORDS.has(w)) {
        score++;
        break; // Count each cell only once
      }
    }
  }
  return score;
}

function parseOneSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worksheet: any,
  sheetIndex: number,
): ParsedSheet | null {
  const sheetName: string = worksheet.name ?? `Sheet ${sheetIndex + 1}`;

  if (!worksheet || worksheet.rowCount < 2) return null;

  // ── Smart header row detection ──
  // Scan rows 1-10 to find the row that looks most like column headers.
  // Many Google Sheets have a title in row 1 (e.g., "FORD INVENTORY") with
  // the actual headers in row 2, 3, or even later.
  let headerRowNum = 1;
  let bestScore = 0;
  const maxScan = Math.min(worksheet.rowCount, 10);

  const scanResults: string[] = [];
  for (let r = 1; r <= maxScan; r++) {
    const row = worksheet.getRow(r);
    const score = scoreHeaderRow(row);
    // Log a preview of each scanned row (first 5 cells)
    const preview: string[] = [];
    for (let c = 1; c <= Math.min(row.cellCount ?? 5, 5); c++) {
      try {
        const v = extractCellValue(row.getCell(c));
        if (v) preview.push(v);
      } catch { /* ignore */ }
    }
    scanResults.push(`row ${r}: score=${score} [${preview.join(", ")}]`);
    if (score > bestScore) {
      bestScore = score;
      headerRowNum = r;
    }
  }

  console.log(`[PARSE] "${sheetName}" — header scan:\n  ${scanResults.join("\n  ")}`);

  // ── Determine if file has a real header row ──
  // If bestScore === 0, NO row looks like headers — file has no header row.
  // In that case: use generic col1/col2 headers and include ALL rows as data.
  const hasRealHeaders = bestScore > 0;

  if (hasRealHeaders) {
    console.log(
      `[PARSE] "${sheetName}" — header row detected at row ${headerRowNum} (score=${bestScore})`,
    );
  } else {
    console.log(
      `[PARSE] "${sheetName}" — NO header row found (all scores=0). Treating all rows as data, will infer column names from content.`,
    );
    headerRowNum = 0; // signal: no header row to skip
  }

  // Extract headers
  const headers: string[] = [];
  if (hasRealHeaders) {
    // Extract from the detected header row using extractCellValue
    // so formula-generated headers (common in Google Sheets) are resolved to display text.
    const headerRow = worksheet.getRow(headerRowNum);
    const headerColCount = headerRow.cellCount ?? headerRow.values?.length ?? 0;
    for (let i = 1; i <= headerColCount; i++) {
      let val: string | null = null;
      try {
        const cell = headerRow.getCell(i);
        val = extractCellValue(cell);
      } catch {
        // Fallback to raw values
        const rawVals = Array.isArray(headerRow.values) ? headerRow.values : [];
        if (rawVals[i] != null) val = cellToString(rawVals[i]);
      }
      headers.push(val != null && val.trim() !== "" ? val.trim() : `col${i}`);
    }
  } else {
    // No header row — determine column count from first non-empty row
    // and use generic col1, col2, ... names (inference will rename them later)
    let maxCols = 0;
    const scanLimit = Math.min(worksheet.rowCount, 5);
    for (let r = 1; r <= scanLimit; r++) {
      const row = worksheet.getRow(r);
      const cnt = row.cellCount ?? row.values?.length ?? 0;
      if (cnt > maxCols) maxCols = cnt;
    }
    for (let i = 1; i <= maxCols; i++) {
      headers.push(`col${i}`);
    }
  }

  if (headers.length === 0) return null;

  console.log(`[PARSE] "${sheetName}" — headers (${headers.length}):`, headers.slice(0, 20).join(" | "));

  // Extract data rows using getCell() + extractCellValue for formula support
  const rows: Record<string, unknown>[] = [];
  let formulaNullCount = 0; // track formula cells that returned null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
    // If we have a real header row, skip it and everything above it.
    // If no header row (headerRowNum === 0), include ALL rows as data.
    if (hasRealHeaders && rowNumber <= headerRowNum) return;

    const rowObj: Record<string, unknown> = {};
    const shouldDebug = rows.length === 0; // only log first data row in detail

    // Also grab row.values as fallback
    const sparseValues = Array.isArray(row.values) ? row.values : [];

    headers.forEach((header, index) => {
      const colIdx = index + 1; // ExcelJS is 1-indexed
      let val: string | null = null;

      try {
        const cell = row.getCell(colIdx);
        val = extractCellValue(cell);

        // Log only first row, or formula cells that extracted as null
        if (shouldDebug) {
          const hasFormula = cell?.formula || cell?.sharedFormula ||
            (cell?.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value));
          if (hasFormula || val == null) {
            console.log(
              `[CELL] sheet="${sheetName}" row=${rowNumber} col=${colIdx} header="${header}"` +
              ` | type=${cell?.type} | formula=${JSON.stringify(cell?.formula ?? cell?.sharedFormula ?? null)}` +
              ` | text=${JSON.stringify(cell?.text)} | result=${JSON.stringify(cell?.result)}` +
              ` | value=${JSON.stringify(cell?.value)}` +
              ` | EXTRACTED="${val}"`,
            );
          }
          if (hasFormula && val == null) formulaNullCount++;
        }
      } catch (err) {
        val = cellToString(sparseValues[colIdx]) ?? null;
        if (shouldDebug) {
          console.log(
            `[CELL] sheet="${sheetName}" row=${rowNumber} col=${colIdx} header="${header}"` +
            ` | ERROR=${err instanceof Error ? err.message : String(err)}` +
            ` | sparse=${JSON.stringify(sparseValues[colIdx])} | EXTRACTED="${val}"`,
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

  // Column coverage summary — shows which columns have data vs null
  const coverage: Record<string, number> = {};
  for (const h of headers) coverage[h] = 0;
  for (const row of rows) {
    for (const h of headers) {
      if (row[h] != null && row[h] !== "") coverage[h]++;
    }
  }
  console.log(`[COVERAGE] "${sheetName}" (${rows.length} rows):`);
  for (const h of headers) {
    const pct = Math.round((coverage[h] / rows.length) * 100);
    const warn = pct < 50 ? " ⚠️ LOW" : "";
    console.log(`  ${h}: ${coverage[h]}/${rows.length} (${pct}%)${warn}`);
  }
  if (formulaNullCount > 0) {
    console.warn(`[COVERAGE] "${sheetName}" has ${formulaNullCount} formula cells with no cached result in row ${headerRowNum + 1}`);
  }

  // ── Content-based column name inference ──
  // If most headers are generic "colN" (formula cells with no cached result,
  // or file has no header row), scan data values to infer meaningful column
  // names like "Stock #", "Year", "Make", etc.
  let finalHeaders = headers;
  let finalRows = rows;
  const inferred = inferColumnNames(headers, rows);
  if (inferred.inferred) {
    finalHeaders = inferred.headers;
    finalRows = inferred.rows;
    // Also try to infer positional columns (Model after Make, Series/Trim after Model/Class)
    const positional = inferPositionalColumns(finalHeaders, finalRows);
    finalHeaders = positional.headers;
    finalRows = positional.rows;
    console.log(`[PARSE] "${sheetName}" — auto-detected headers:`, finalHeaders.slice(0, 20).join(" | "));
  }

  return { name: sheetName, index: sheetIndex, headers: finalHeaders, rows: finalRows, rowCount: finalRows.length };
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

  console.log("[executeImport] user:", user.email, "event_id:", eventId, "mode:", mode, "total rows received:", rows.length);

  // ── Diagnostic: show columnMap and sample raw data ──
  const mappedFields = Object.entries(columnMap).filter(([, v]) => v && v !== "__skip__");
  const skippedFields = Object.entries(columnMap).filter(([, v]) => !v || v === "__skip__");
  console.log(
    `[executeImport] COLUMN MAP: ${mappedFields.length} mapped, ${skippedFields.length} skipped`,
  );
  for (const [col, field] of mappedFields) {
    console.log(`  "${col}" → ${field}`);
  }
  if (rows.length > 0) {
    const sampleRow = rows[0];
    const rowKeys = Object.keys(sampleRow);
    console.log(`[executeImport] RAW ROW KEYS (${rowKeys.length}):`, rowKeys.slice(0, 15).join(" | "));
    console.log(`[executeImport] RAW ROW[0] sample:`, Object.fromEntries(
      rowKeys.slice(0, 10).map((k) => [k, sampleRow[k] ?? "NULL"]),
    ));
    // Check if any columnMap key exists in the row keys
    const matchingKeys = mappedFields.filter(([col]) => col in sampleRow);
    const missingKeys = mappedFields.filter(([col]) => !(col in sampleRow));
    if (missingKeys.length > 0) {
      console.error(
        `[executeImport] KEY MISMATCH! ${missingKeys.length} columnMap keys not found in row:`,
        missingKeys.map(([col, field]) => `"${col}" (→${field})`).join(", "),
      );
      console.log(
        `[executeImport] Row has keys:`, rowKeys.join(", "),
        `\nColumnMap expects:`, mappedFields.map(([col]) => col).join(", "),
      );
    } else {
      console.log(`[executeImport] All ${matchingKeys.length} columnMap keys found in row ✓`);
    }
  }

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

    // Diagnostic: log first 3 rows' mapping results
    if (i < 3) {
      console.log(
        `[executeImport] ROW[${i}] MAPPED:`,
        `stock_number=${JSON.stringify(mapped.stock_number)}`,
        `year=${JSON.stringify(mapped.year)}`,
        `make=${JSON.stringify(mapped.make)}`,
        `model=${JSON.stringify(mapped.model)}`,
        `| total mapped fields: ${Object.keys(mapped).length}`,
        `| non-null fields: ${Object.values(mapped).filter((v) => v != null && v !== "").length}`,
      );
    }

    // Clean empties
    for (const key of Object.keys(mapped)) {
      if (mapped[key] === "" || mapped[key] === undefined) {
        mapped[key] = null;
      }
    }

    // Skip rows with no stock number — these are junk (section headers, subtotals, etc.)
    const rawStock = mapped.stock_number;
    if (rawStock == null || String(rawStock).trim() === "") {
      continue;
    }

    // ── Sanitize number fields ──
    // Formula cells from Google Sheets may return "#REF!", "#N/A", "N/A", etc.
    // z.coerce.number() would reject the ENTIRE row if any number field has garbage.
    // Fix: convert non-numeric strings to null before Zod validation.
    const NUMBER_FIELDS = [
      "hat_number", "year", "mileage", "age_days", "acquisition_cost",
      "jd_trade_clean", "jd_retail_clean", "asking_price_115", "asking_price_120",
      "asking_price_125", "asking_price_130", "profit_115", "profit_120",
      "profit_125", "profit_130", "retail_spread",
    ];
    for (const nf of NUMBER_FIELDS) {
      if (mapped[nf] != null) {
        const n = Number(mapped[nf]);
        if (isNaN(n)) {
          mapped[nf] = null; // garbage formula result → null (don't nuke the row)
        }
      }
    }

    // ── Post-processing: compute derived fields if formula cells returned null ──
    const cost = mapped.acquisition_cost != null ? Number(mapped.acquisition_cost) : NaN;
    const trade = mapped.jd_trade_clean != null ? Number(mapped.jd_trade_clean) : NaN;

    // DIFF (retail_spread) = jd_trade_clean - acquisition_cost
    if (mapped.retail_spread == null && !isNaN(cost) && !isNaN(trade)) {
      mapped.retail_spread = Math.round((trade - cost) * 100) / 100;
    }

    // Asking prices: jd_trade_clean * multiplier
    if (mapped.asking_price_115 == null && !isNaN(trade)) {
      mapped.asking_price_115 = Math.round(trade * 1.15 * 100) / 100;
    }
    if (mapped.asking_price_120 == null && !isNaN(trade)) {
      mapped.asking_price_120 = Math.round(trade * 1.20 * 100) / 100;
    }
    if (mapped.asking_price_125 == null && !isNaN(trade)) {
      mapped.asking_price_125 = Math.round(trade * 1.25 * 100) / 100;
    }
    if (mapped.asking_price_130 == null && !isNaN(trade)) {
      mapped.asking_price_130 = Math.round(trade * 1.30 * 100) / 100;
    }

    // Profits: asking_price - acquisition_cost
    if (mapped.profit_115 == null && !isNaN(cost)) {
      const ask115 = Number(mapped.asking_price_115);
      if (!isNaN(ask115)) mapped.profit_115 = Math.round((ask115 - cost) * 100) / 100;
    }
    if (mapped.profit_120 == null && !isNaN(cost)) {
      const ask120 = Number(mapped.asking_price_120);
      if (!isNaN(ask120)) mapped.profit_120 = Math.round((ask120 - cost) * 100) / 100;
    }
    if (mapped.profit_125 == null && !isNaN(cost)) {
      const ask125 = Number(mapped.asking_price_125);
      if (!isNaN(ask125)) mapped.profit_125 = Math.round((ask125 - cost) * 100) / 100;
    }
    if (mapped.profit_130 == null && !isNaN(cost)) {
      const ask130 = Number(mapped.asking_price_130);
      if (!isNaN(ask130)) mapped.profit_130 = Math.round((ask130 - cost) * 100) / 100;
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

  const skippedNoStock = rows.length - validRows.length - errors - duplicatesSkipped;
  console.log(
    `[executeImport] FILTER: ${rows.length} total rows → ` +
    `${skippedNoStock} skipped (no Stock#), ` +
    `${errors} validation errors, ` +
    `${duplicatesSkipped} duplicates, ` +
    `${validRows.length} valid rows to insert`,
  );

  // Log first 5 validation errors for debugging
  if (errorDetails.length > 0) {
    console.log("[executeImport] sample errors:", errorDetails.slice(0, 5));
  }

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

// ── Roster name cleaning ──
// Strip the leading row number ("1 NATE HARDING" → "NATE HARDING")
// and do basic validation. The real filtering is done by requiring a
// sequential row number in the adjacent column (Column B).
function cleanRosterName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.trim();
  if (!name) return null;

  // Strip leading row number + separator ("1 NATE HARDING", "1. Nate", "23) Bob")
  name = name.replace(/^\d+[\s.)\-]+/, "").trim();
  if (!name) return null;

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(name)) return null;

  return name;
}

// Detect which column contains the sequential row numbers (1, 2, 3...).
// In the Roster & Tables sheet, Column B has these numbers for real roster rows.
// Junk rows (section headers, summaries) don't have a number in Column B.
function detectNumberingColumn(rows: Record<string, unknown>[]): string | null {
  if (rows.length < 3) return null;

  // Collect all column keys from the first 30 rows
  const allKeys = new Set<string>();
  const sample = rows.slice(0, 30);
  for (const row of sample) {
    for (const key of Object.keys(row)) allKeys.add(key);
  }

  for (const key of allKeys) {
    const nums: number[] = [];
    for (const row of sample) {
      const val = row[key];
      if (val == null || String(val).trim() === "") continue;
      const n = Number(val);
      if (Number.isInteger(n) && n > 0 && n <= 200) {
        nums.push(n);
      }
    }
    // Must have at least 3 small integers including 1, 2, 3 (sequential numbering)
    if (nums.length >= 3 && nums.includes(1) && nums.includes(2) && nums.includes(3)) {
      return key;
    }
  }
  return null;
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

  // ── Step 3: Detect numbering column + map and validate rows ──
  // Real roster rows have a sequential number in Column B (1, 2, 3...).
  // Section headers like "Mail Investment", "Total Sales Days" do NOT.
  const numberCol = detectNumberingColumn(rows);
  console.log("[rosterImport] numbering column:", numberCol ? `"${numberCol}"` : "NOT FOUND (fallback to name-only)");

  let imported = 0;
  let errors = 0;
  const errorDetails: { row: number; message: string }[] = [];

  const validRows: { rowNum: number; name: string; phone: string | null; confirmed: boolean; role: (typeof VALID_ROLES)[number]; notes: string | null }[] = [];
  const skippedSamples: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped: Record<string, string | null> = {};

    for (const [spreadsheetCol, dbField] of Object.entries(columnMap)) {
      if (dbField && dbField !== "__skip__" && raw[spreadsheetCol] !== undefined) {
        const val = raw[spreadsheetCol];
        mapped[dbField] = val != null ? String(val).trim() : null;
      }
    }

    const rawName = mapped.name;

    // Primary filter: if we found a numbering column, require a positive integer
    if (numberCol) {
      const numVal = raw[numberCol];
      const n = Number(numVal);
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        if (skippedSamples.length < 15 && rawName && String(rawName).trim()) {
          skippedSamples.push(`[no row#] ${String(rawName).trim()}`);
        }
        continue;
      }
    }

    // Clean the name (strip leading number prefix, require at least one letter)
    const name = cleanRosterName(rawName);
    if (!name) {
      if (skippedSamples.length < 15 && rawName && String(rawName).trim()) {
        skippedSamples.push(`[bad name] ${String(rawName).trim()}`);
      }
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
    `[rosterImport] FILTER: ${validRows.length} accepted, ${skippedCount} skipped out of ${rows.length} total`,
  );
  if (validRows.length > 0) {
    console.log("[rosterImport] ACCEPTED names:", validRows.map((r) => r.name));
  }
  if (skippedSamples.length > 0) {
    console.log("[rosterImport] SKIPPED samples:", skippedSamples);
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
