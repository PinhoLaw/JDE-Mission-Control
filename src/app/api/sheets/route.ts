/**
 * Google Sheets API Route — JDE Mission Control
 * ==============================================
 *
 * Central API endpoint for all Dashboard ↔ Google Sheets communication.
 * The dashboard is the source of truth — this route pushes every input
 * to Sheet18 so it stays a live mirror of the current event state.
 *
 * Supported actions:
 *   POST { action: "read",   sheetTitle: "Sheet18" }
 *   POST { action: "append", sheetTitle: "Sheet18", data: { ... } }
 *   POST { action: "append_batch", sheetTitle: "Sheet18", rows: [ { ... }, ... ] }
 *   POST { action: "update", sheetTitle: "Sheet18", rowIndex: 0, data: { ... } }
 *   POST { action: "update_by_field", sheetTitle: "Sheet18", matchColumn, matchValue, data }
 *   POST { action: "delete", sheetTitle: "Sheet18", rowIndex: 0 }
 *   POST { action: "list_sheets" }
 *
 * How this enables "Dashboard → Sheet18 push" for Michigan City Ford:
 *   1. When a vehicle is imported or edited in the dashboard, the UI calls
 *      this endpoint with action: "append" or "update" to push the change
 *      to Sheet18 in real-time.
 *   2. Dealership staff at Michigan City Ford (and future events) can view
 *      the Google Sheet directly — it always matches the dashboard.
 *   3. Downstream automations (mail merge, ad generation, pricing reports)
 *      read from Sheet18 as a stable data source.
 *
 * Security:
 *   - This route is server-only (API route, not a Server Action)
 *   - Google auth uses a service account — no user OAuth needed
 *   - The proxy.ts middleware skips auth for /api/ routes (they handle
 *     their own auth), so this route is accessible from the client
 *   - For production, add your own auth check below if you want to
 *     restrict access to authenticated dashboard users only
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  readSheet,
  appendRow,
  appendRowRaw,
  appendRows,
  updateRow,
  updateRowByField,
  deleteRow,
  listSheets,
} from "@/lib/services/googleSheets";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ReadAction {
  action: "read";
  sheetTitle: string;
}

interface AppendAction {
  action: "append";
  sheetTitle: string;
  data: Record<string, unknown>;
}

interface AppendBatchAction {
  action: "append_batch";
  sheetTitle: string;
  rows: Record<string, unknown>[];
}

interface UpdateAction {
  action: "update";
  sheetTitle: string;
  rowIndex: number;
  data: Record<string, unknown>;
}

interface UpdateByFieldAction {
  action: "update_by_field";
  sheetTitle: string;
  matchColumn: string;
  matchValue: string;
  data: Record<string, unknown>;
}

interface DeleteAction {
  action: "delete";
  sheetTitle: string;
  rowIndex: number;
}

interface AppendRawAction {
  action: "append_raw";
  sheetTitle: string;
  values: unknown[];
}

interface ListSheetsAction {
  action: "list_sheets";
}

type SheetAction =
  | ReadAction
  | AppendAction
  | AppendRawAction
  | AppendBatchAction
  | UpdateAction
  | UpdateByFieldAction
  | DeleteAction
  | ListSheetsAction;

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: SheetAction;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.action) {
    return NextResponse.json(
      { error: "Missing 'action' field. Expected: read | append | append_raw | append_batch | update | update_by_field | delete | list_sheets" },
      { status: 400 },
    );
  }

  try {
    switch (body.action) {
      // ── READ ──────────────────────────────────────────────
      case "read": {
        const { sheetTitle } = body;
        if (!sheetTitle) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' for read action" },
            { status: 400 },
          );
        }
        const result = await readSheet(sheetTitle);
        return NextResponse.json(result, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      // ── APPEND (single row) ───────────────────────────────
      case "append": {
        const { sheetTitle, data } = body;
        if (!sheetTitle || !data) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'data' for append action" },
            { status: 400 },
          );
        }
        const result = await appendRow(sheetTitle, data);
        return NextResponse.json(result, { status: 201 });
      }

      // ── APPEND RAW (positional array — for sheets with duplicate headers)
      case "append_raw": {
        const { sheetTitle, values } = body;
        if (!sheetTitle || !Array.isArray(values)) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'values' array for append_raw action" },
            { status: 400 },
          );
        }
        const result = await appendRowRaw(sheetTitle, values);
        return NextResponse.json(result, { status: 201 });
      }

      // ── APPEND BATCH (multiple rows) ──────────────────────
      case "append_batch": {
        const { sheetTitle, rows } = body;
        if (!sheetTitle || !Array.isArray(rows) || rows.length === 0) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'rows' array for append_batch action" },
            { status: 400 },
          );
        }
        const result = await appendRows(sheetTitle, rows);
        return NextResponse.json(result, { status: 201 });
      }

      // ── UPDATE (by row index) ─────────────────────────────
      case "update": {
        const { sheetTitle, rowIndex, data } = body;
        if (!sheetTitle || rowIndex == null || !data) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle', 'rowIndex', or 'data' for update action" },
            { status: 400 },
          );
        }
        const result = await updateRow(sheetTitle, rowIndex, data);
        return NextResponse.json(result);
      }

      // ── UPDATE BY FIELD (find + update) ───────────────────
      case "update_by_field": {
        const { sheetTitle, matchColumn, matchValue, data } = body;
        if (!sheetTitle || !matchColumn || !matchValue || !data) {
          return NextResponse.json(
            { error: "Missing required fields for update_by_field action. Need: sheetTitle, matchColumn, matchValue, data" },
            { status: 400 },
          );
        }
        const result = await updateRowByField(
          sheetTitle,
          matchColumn,
          matchValue,
          data,
        );
        return NextResponse.json(result);
      }

      // ── DELETE ─────────────────────────────────────────────
      case "delete": {
        const { sheetTitle, rowIndex } = body;
        if (!sheetTitle || rowIndex == null) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'rowIndex' for delete action" },
            { status: 400 },
          );
        }
        const result = await deleteRow(sheetTitle, rowIndex);
        return NextResponse.json(result);
      }

      // ── LIST SHEETS ───────────────────────────────────────
      case "list_sheets": {
        const sheets = await listSheets();
        return NextResponse.json({ sheets }, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      // ── UNKNOWN ───────────────────────────────────────────
      default: {
        return NextResponse.json(
          {
            error: `Unknown action: "${(body as Record<string, unknown>).action}". ` +
              `Expected: read | append | append_raw | append_batch | update | update_by_field | delete | list_sheets`,
          },
          { status: 400 },
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isNotFound =
      message.toLowerCase().includes("not found") ||
      message.toLowerCase().includes("no row found") ||
      message.includes("out of range");

    console.error(`[/api/sheets] Error for action="${body.action}":`, message);

    return NextResponse.json(
      { error: message },
      { status: isNotFound ? 404 : 500 },
    );
  }
}
