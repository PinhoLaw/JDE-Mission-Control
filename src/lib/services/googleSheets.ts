/**
 * Google Sheets Service — JDE Mission Control
 * ============================================
 *
 * Live mirror between the dashboard and Google Sheets. Every inventory change,
 * deal entry, or roster update that happens inside JDE Mission Control is
 * pushed to Sheet18 (or any named tab) so the Google Sheet always reflects
 * the dashboard's current state.
 *
 * Architecture:
 *   Dashboard (Supabase) ──push──▶ Google Sheet (Sheet18)
 *   Dashboard              ◀──pull── Google Sheet (read)
 *
 * This enables:
 *   - Michigan City Ford (and future events) to have a live, shareable
 *     Google Sheet that auto-updates when the dashboard changes
 *   - Dealership staff who prefer spreadsheets can VIEW the sheet while
 *     the JDE team manages everything from the dashboard
 *   - Downstream automations (mail merge, ad generation) can read from
 *     the Google Sheet as a stable data source
 *
 * Env vars required (in .env.local):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — service account email from GCP console
 *   GOOGLE_PRIVATE_KEY            — PEM private key (with \n line breaks)
 *   GOOGLE_SPREADSHEET_ID         — the long ID from the Google Sheet URL
 */

import { GoogleSpreadsheet, GoogleSpreadsheetRow } from "google-spreadsheet";
import { JWT } from "google-auth-library";

// ─────────────────────────────────────────────────────────────
// Config & Auth
// ─────────────────────────────────────────────────────────────

function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `[GoogleSheets] Missing env var: ${key}. ` +
        `Add it to .env.local — see the README for setup instructions.`,
    );
  }
  return val;
}

/**
 * Build a JWT auth client for the Google service account.
 * The service account must be shared as Editor on the target spreadsheet.
 */
function createAuthClient(): JWT {
  return new JWT({
    email: getEnvOrThrow("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    // Private key comes from .env with literal \n — replace them
    key: getEnvOrThrow("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * Load the spreadsheet document and return a ready-to-use instance.
 * Caches nothing — each call creates a fresh connection so there are
 * no stale-data issues in serverless functions.
 */
async function loadSpreadsheet(): Promise<GoogleSpreadsheet> {
  const auth = createAuthClient();
  const doc = new GoogleSpreadsheet(
    getEnvOrThrow("GOOGLE_SPREADSHEET_ID"),
    auth,
  );
  await doc.loadInfo();
  return doc;
}

/**
 * Get a sheet (tab) by title. Throws a clear error if not found.
 */
function getSheet(doc: GoogleSpreadsheet, sheetTitle: string) {
  const sheet = doc.sheetsByTitle[sheetTitle];
  if (!sheet) {
    const available = Object.keys(doc.sheetsByTitle).join(", ");
    throw new Error(
      `[GoogleSheets] Sheet "${sheetTitle}" not found. Available: ${available}`,
    );
  }
  return sheet;
}

// ─────────────────────────────────────────────────────────────
// READ — Pull data from the sheet
// ─────────────────────────────────────────────────────────────

export interface ReadResult {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

/**
 * Read all rows from a sheet tab.
 *
 * Returns { headers, rows, rowCount } where each row is a key/value
 * object keyed by the header names in row 1 of the sheet.
 *
 * @param sheetTitle — e.g. "Sheet18", "FORD INVENTORY"
 */
export async function readSheet(sheetTitle: string): Promise<ReadResult> {
  const doc = await loadSpreadsheet();
  const sheet = getSheet(doc, sheetTitle);

  // getRows() uses the first row as headers automatically
  const rows: GoogleSpreadsheetRow[] = await sheet.getRows();
  const headers = sheet.headerValues || [];

  const data = rows.map((row) => {
    const obj: Record<string, string> = {};
    for (const h of headers) {
      obj[h] = row.get(h) ?? "";
    }
    return obj;
  });

  return { headers, rows: data, rowCount: data.length };
}

// ─────────────────────────────────────────────────────────────
// APPEND — Push a new row to the sheet (Dashboard → Sheet)
// ─────────────────────────────────────────────────────────────

export interface AppendResult {
  success: boolean;
  rowNumber: number;
  data: Record<string, string>;
}

/**
 * Append a single row to the bottom of a sheet.
 *
 * The `data` keys must match the header names in row 1 of the sheet.
 * Any keys that don't match a header are silently ignored.
 * Any headers not present in `data` will be left blank in that cell.
 *
 * Usage:
 *   await appendRow("Sheet18", {
 *     "Stock #": "MF1503A",
 *     "Year": "2013",
 *     "Make": "FORD",
 *     "Model": "F150 RAPTOR",
 *   });
 *
 * @param sheetTitle — e.g. "Sheet18"
 * @param data      — key/value pairs matching the sheet's header row
 */
export async function appendRow(
  sheetTitle: string,
  data: Record<string, unknown>,
): Promise<AppendResult> {
  const doc = await loadSpreadsheet();
  const sheet = getSheet(doc, sheetTitle);

  // Coerce all values to strings for the Sheets API
  const stringData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    stringData[key] = value != null ? String(value) : "";
  }

  const newRow = await sheet.addRow(stringData);

  console.log(
    `[GoogleSheets] appendRow("${sheetTitle}") → row ${newRow.rowNumber}`,
    Object.keys(stringData).length,
    "fields",
  );

  return {
    success: true,
    rowNumber: newRow.rowNumber,
    data: stringData,
  };
}

/**
 * Append multiple rows at once (batch). More efficient than calling
 * appendRow() in a loop — uses a single API call.
 *
 * @param sheetTitle — e.g. "Sheet18"
 * @param rows      — array of key/value objects
 */
export async function appendRows(
  sheetTitle: string,
  rows: Record<string, unknown>[],
): Promise<{ success: boolean; count: number }> {
  const doc = await loadSpreadsheet();
  const sheet = getSheet(doc, sheetTitle);

  const stringRows = rows.map((row) => {
    const obj: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      obj[key] = value != null ? String(value) : "";
    }
    return obj;
  });

  await sheet.addRows(stringRows);

  console.log(
    `[GoogleSheets] appendRows("${sheetTitle}") → ${stringRows.length} rows added`,
  );

  return { success: true, count: stringRows.length };
}

// ─────────────────────────────────────────────────────────────
// UPDATE — Modify an existing row in-place (Dashboard → Sheet)
// ─────────────────────────────────────────────────────────────

export interface UpdateResult {
  success: boolean;
  rowNumber: number;
  updatedFields: string[];
}

/**
 * Update a specific row by its 0-based data index (row 0 = first data row,
 * i.e. the row right below the header row).
 *
 * Uses the row-based API (row.assign + row.save) which is the most
 * reliable method — it respects headers and avoids cell-range math.
 *
 * Usage:
 *   await updateRow("Sheet18", 42, {
 *     "Status": "SOLD",
 *     "Sale Price": "$28,500",
 *   });
 *
 * @param sheetTitle — e.g. "Sheet18"
 * @param rowIndex  — 0-based index into the data rows (not the sheet row number)
 * @param data      — key/value pairs to update (only specified fields change)
 */
export async function updateRow(
  sheetTitle: string,
  rowIndex: number,
  data: Record<string, unknown>,
): Promise<UpdateResult> {
  const doc = await loadSpreadsheet();
  const sheet = getSheet(doc, sheetTitle);

  const rows = await sheet.getRows();

  if (rowIndex < 0 || rowIndex >= rows.length) {
    throw new Error(
      `[GoogleSheets] Row index ${rowIndex} out of range. ` +
        `Sheet "${sheetTitle}" has ${rows.length} data rows (0-${rows.length - 1}).`,
    );
  }

  const row = rows[rowIndex];

  // Assign only the fields provided — leaves other cells untouched
  const updatedFields: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const strVal = value != null ? String(value) : "";
    row.set(key, strVal);
    updatedFields.push(key);
  }

  await row.save();

  console.log(
    `[GoogleSheets] updateRow("${sheetTitle}", ${rowIndex}) → ` +
      `row ${row.rowNumber}, ${updatedFields.length} fields: [${updatedFields.join(", ")}]`,
  );

  return {
    success: true,
    rowNumber: row.rowNumber,
    updatedFields,
  };
}

/**
 * Find a row by matching a column value, then update it.
 * Useful when you know the stock number but not the row index.
 *
 * Usage:
 *   await updateRowByField("Sheet18", "Stock #", "MF1503A", {
 *     "Status": "SOLD",
 *   });
 *
 * @param sheetTitle  — e.g. "Sheet18"
 * @param matchColumn — header name to search (e.g. "Stock #")
 * @param matchValue  — value to match (e.g. "MF1503A")
 * @param data        — key/value pairs to update
 */
export async function updateRowByField(
  sheetTitle: string,
  matchColumn: string,
  matchValue: string,
  data: Record<string, unknown>,
): Promise<UpdateResult> {
  const doc = await loadSpreadsheet();
  const sheet = getSheet(doc, sheetTitle);

  const rows = await sheet.getRows();
  const targetIndex = rows.findIndex(
    (row) => row.get(matchColumn) === matchValue,
  );

  if (targetIndex === -1) {
    throw new Error(
      `[GoogleSheets] No row found where "${matchColumn}" = "${matchValue}" ` +
        `in sheet "${sheetTitle}".`,
    );
  }

  const row = rows[targetIndex];
  const updatedFields: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const strVal = value != null ? String(value) : "";
    row.set(key, strVal);
    updatedFields.push(key);
  }

  await row.save();

  console.log(
    `[GoogleSheets] updateRowByField("${sheetTitle}", "${matchColumn}"="${matchValue}") → ` +
      `row ${row.rowNumber}, ${updatedFields.length} fields updated`,
  );

  return {
    success: true,
    rowNumber: row.rowNumber,
    updatedFields,
  };
}

// ─────────────────────────────────────────────────────────────
// DELETE — Remove a row from the sheet
// ─────────────────────────────────────────────────────────────

/**
 * Delete a row by its 0-based data index.
 */
export async function deleteRow(
  sheetTitle: string,
  rowIndex: number,
): Promise<{ success: boolean; deletedRowNumber: number }> {
  const doc = await loadSpreadsheet();
  const sheet = getSheet(doc, sheetTitle);

  const rows = await sheet.getRows();

  if (rowIndex < 0 || rowIndex >= rows.length) {
    throw new Error(
      `[GoogleSheets] Row index ${rowIndex} out of range. ` +
        `Sheet "${sheetTitle}" has ${rows.length} data rows.`,
    );
  }

  const rowNumber = rows[rowIndex].rowNumber;
  await rows[rowIndex].delete();

  console.log(
    `[GoogleSheets] deleteRow("${sheetTitle}", ${rowIndex}) → deleted row ${rowNumber}`,
  );

  return { success: true, deletedRowNumber: rowNumber };
}

// ─────────────────────────────────────────────────────────────
// METADATA — Sheet info for debugging / UI
// ─────────────────────────────────────────────────────────────

/**
 * List all sheet tabs in the spreadsheet with basic metadata.
 */
export async function listSheets(): Promise<
  { title: string; rowCount: number; columnCount: number }[]
> {
  const doc = await loadSpreadsheet();
  return Object.values(doc.sheetsByTitle).map((sheet) => ({
    title: sheet.title,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
  }));
}
