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
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — full JSON key from GCP (the entire
 *                                  downloaded .json file contents, on one line)
 *   GOOGLE_SPREADSHEET_ID        — (optional) override the default spreadsheet
 *
 * The default spreadsheet ID is hard-coded for the JDE master sheet.
 * Set GOOGLE_SPREADSHEET_ID in .env.local to point at a different sheet.
 */

import { GoogleSpreadsheet, GoogleSpreadsheetRow } from "google-spreadsheet";
import { JWT } from "google-auth-library";

// ─────────────────────────────────────────────────────────────
// Config & Auth
// ─────────────────────────────────────────────────────────────

/** Default spreadsheet — JDE Mission Control master sheet */
const DEFAULT_SPREADSHEET_ID = "10NUwAoUAsHsSCL4GrTiwjumvpa3TqMN56wqQ-rFPfrA";

/**
 * Parse the service account JSON from the single env var.
 * The entire GCP JSON key file is stored as one env var for simplicity —
 * no need to split email and private key into separate vars.
 */
function getServiceAccount(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "[GoogleSheets] Missing env var: GOOGLE_SERVICE_ACCOUNT_JSON. " +
        "Paste the full contents of your GCP service account JSON key file " +
        "into this variable in .env.local (all on one line).",
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "[GoogleSheets] GOOGLE_SERVICE_ACCOUNT_JSON is missing 'client_email' or 'private_key'. " +
          "Make sure you pasted the full JSON key file (not just a fragment).",
      );
    }
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(
        "[GoogleSheets] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. " +
          "Paste the entire contents of the downloaded .json key file on one line. " +
          `Parse error: ${err.message}`,
      );
    }
    throw err;
  }
}

/**
 * Build a JWT auth client for the Google service account.
 * The service account must be shared as Editor on the target spreadsheet.
 */
function createAuthClient(): JWT {
  const sa = getServiceAccount();
  return new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * Get the spreadsheet ID — uses GOOGLE_SPREADSHEET_ID env var if set,
 * otherwise falls back to the hard-coded JDE master sheet ID.
 */
function getSpreadsheetId(): string {
  return process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
}

/**
 * Load the spreadsheet document and return a ready-to-use instance.
 * Caches nothing — each call creates a fresh connection so there are
 * no stale-data issues in serverless functions.
 */
async function loadSpreadsheet(): Promise<GoogleSpreadsheet> {
  const auth = createAuthClient();
  const doc = new GoogleSpreadsheet(getSpreadsheetId(), auth);
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

  const rowNum = newRow?.rowNumber ?? -1;
  console.log(
    `[GoogleSheets] appendRow("${sheetTitle}") → row ${rowNum}`,
    Object.keys(stringData).length,
    "fields",
    "| sheet headers:", sheet.headerValues?.join(", "),
  );

  return {
    success: true,
    rowNumber: rowNum,
    data: stringData,
  };
}

/**
 * Append a single row by column position (array of values).
 * Uses the raw Google Sheets API (values.append) to bypass the
 * google-spreadsheet library's duplicate-header validation.
 *
 * Use this when a sheet has duplicate header names (e.g. YEAR appears
 * twice for vehicle and trade-in).
 *
 * @param sheetTitle — e.g. "FORD DEAL LOG"
 * @param values     — array of values in column order (A, B, C, ...)
 */
export async function appendRowRaw(
  sheetTitle: string,
  values: unknown[],
): Promise<AppendResult> {
  const auth = createAuthClient();
  await auth.authorize();
  const token = (await auth.getAccessToken()).token;

  const spreadsheetId = getSpreadsheetId();
  const range = `'${sheetTitle}'!A:ZZ`;

  const stringValues = values.map((v) => (v != null ? String(v) : ""));

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [stringValues] }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `[GoogleSheets] appendRowRaw failed (${res.status}): ${errBody}`,
    );
  }

  const result = await res.json();
  // Extract row number from updatedRange (e.g. "'FORD DEAL LOG'!A7:AE7" → 7)
  const updatedRange = result.updates?.updatedRange ?? "";
  const rowMatch = updatedRange.match(/!.*?(\d+)/);
  const rowNum = rowMatch ? parseInt(rowMatch[1], 10) : -1;

  console.log(
    `[GoogleSheets] appendRowRaw("${sheetTitle}") → row ${rowNum}`,
    stringValues.length,
    "columns",
  );

  const data: Record<string, string> = {};
  for (let i = 0; i < stringValues.length; i++) {
    data[`col_${i}`] = stringValues[i];
  }

  return {
    success: true,
    rowNumber: rowNum,
    data,
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

/**
 * Update an existing row by matching a column value, using the raw
 * Google Sheets API. Bypasses the google-spreadsheet library so it
 * works on sheets with duplicate headers (e.g. YEAR appears twice).
 *
 * 1. GET all values to find the row where column[matchColumnIndex] === matchValue
 * 2. PUT the new values into that row
 *
 * @param sheetTitle       — e.g. "FORD DEAL LOG"
 * @param matchColumnIndex — 0-based column index to search (e.g. 1 for STOCK#)
 * @param matchValue       — value to match in that column
 * @param values           — full row of values in column order (A, B, C, ...)
 */
export async function updateRowRawByField(
  sheetTitle: string,
  matchColumnIndex: number,
  matchValue: string,
  values: unknown[],
): Promise<UpdateResult> {
  const auth = createAuthClient();
  await auth.authorize();
  const token = (await auth.getAccessToken()).token;

  const spreadsheetId = getSpreadsheetId();
  const readRange = `'${sheetTitle}'!A:ZZ`;

  // Step 1: Read all rows to find the matching one
  const readUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(readRange)}`;

  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!readRes.ok) {
    const errBody = await readRes.text();
    throw new Error(
      `[GoogleSheets] updateRowRawByField read failed (${readRes.status}): ${errBody}`,
    );
  }

  const readData = await readRes.json();
  const allRows: string[][] = readData.values ?? [];

  // Find matching row (skip header row at index 0)
  let targetSheetRow = -1;
  for (let i = 1; i < allRows.length; i++) {
    const cellValue = allRows[i]?.[matchColumnIndex] ?? "";
    if (cellValue === matchValue) {
      targetSheetRow = i + 1; // 1-based sheet row number (index 0 = row 1)
      break;
    }
  }

  if (targetSheetRow === -1) {
    throw new Error(
      `[GoogleSheets] No row found where column ${matchColumnIndex} = "${matchValue}" ` +
        `in sheet "${sheetTitle}".`,
    );
  }

  // Step 2: Update that row
  const stringValues = values.map((v) => (v != null ? String(v) : ""));
  const updateRange = `'${sheetTitle}'!A${targetSheetRow}:ZZ${targetSheetRow}`;

  const updateUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(updateRange)}` +
    `?valueInputOption=USER_ENTERED`;

  const updateRes = await fetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [stringValues] }),
  });

  if (!updateRes.ok) {
    const errBody = await updateRes.text();
    throw new Error(
      `[GoogleSheets] updateRowRawByField update failed (${updateRes.status}): ${errBody}`,
    );
  }

  console.log(
    `[GoogleSheets] updateRowRawByField("${sheetTitle}", col ${matchColumnIndex}="${matchValue}") → ` +
      `row ${targetSheetRow}, ${stringValues.length} columns`,
  );

  return {
    success: true,
    rowNumber: targetSheetRow,
    updatedFields: ["raw_update"],
  };
}

// ─────────────────────────────────────────────────────────────
// READ RAW — Pull all values as a 2D array (bypasses header parsing)
// ─────────────────────────────────────────────────────────────

/**
 * Read all values from a sheet as a raw 2D string array.
 * Bypasses the google-spreadsheet library's header parsing —
 * useful for sheets with duplicate headers or when you need
 * positional column access.
 *
 * @param sheetTitle — e.g. "Roster Push"
 */
export async function readSheetRaw(
  sheetTitle: string,
): Promise<{ values: string[][] }> {
  const auth = createAuthClient();
  await auth.authorize();
  const token = (await auth.getAccessToken()).token;

  const spreadsheetId = getSpreadsheetId();
  const range = `'${sheetTitle}'!A:ZZ`;

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(range)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `[GoogleSheets] readSheetRaw failed (${res.status}): ${errBody}`,
    );
  }

  const data = await res.json();
  const values: string[][] = (data.values ?? []).map((row: unknown[]) =>
    row.map((cell) => (cell != null ? String(cell) : "")),
  );

  console.log(
    `[GoogleSheets] readSheetRaw("${sheetTitle}") → ${values.length} rows`,
  );

  return { values };
}

// ─────────────────────────────────────────────────────────────
// WRITE RAW — Clear and replace all data in a sheet
// ─────────────────────────────────────────────────────────────

/**
 * Clear the sheet and write all rows from scratch.
 * Uses the raw Google Sheets API (values.clear + values.update).
 *
 * Useful for full-sync operations where the dashboard is the
 * source of truth and we want the sheet to mirror it exactly.
 *
 * @param sheetTitle — e.g. "Roster Push"
 * @param values     — 2D array of values (row 0 = header, row 1+ = data)
 */
export async function writeSheetRaw(
  sheetTitle: string,
  values: unknown[][],
): Promise<{ success: boolean; rowCount: number }> {
  const auth = createAuthClient();
  await auth.authorize();
  const token = (await auth.getAccessToken()).token;

  const spreadsheetId = getSpreadsheetId();
  const range = `'${sheetTitle}'!A1:ZZ`;

  // Step 1: Clear existing data
  const clearUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(range)}:clear`;

  const clearRes = await fetch(clearUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!clearRes.ok) {
    const errBody = await clearRes.text();
    throw new Error(
      `[GoogleSheets] writeSheetRaw clear failed (${clearRes.status}): ${errBody}`,
    );
  }

  // Step 2: Write new data
  const stringValues = values.map((row) =>
    row.map((v) => (v != null ? String(v) : "")),
  );

  const updateUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(range)}` +
    `?valueInputOption=USER_ENTERED`;

  const updateRes = await fetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: stringValues }),
  });

  if (!updateRes.ok) {
    const errBody = await updateRes.text();
    throw new Error(
      `[GoogleSheets] writeSheetRaw write failed (${updateRes.status}): ${errBody}`,
    );
  }

  console.log(
    `[GoogleSheets] writeSheetRaw("${sheetTitle}") → ${values.length} rows written`,
  );

  return { success: true, rowCount: values.length };
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
