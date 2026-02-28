/**
 * Google Sheets API Route — JDE Mission Control
 * ==============================================
 *
 * Central API endpoint for all Dashboard <-> Google Sheets communication.
 * The dashboard is the source of truth — this route pushes every input
 * to the event's Google Sheet so it stays a live mirror.
 *
 * SECURITY:
 *   - Requires Supabase authentication (returns 401 if not logged in)
 *   - Role-based access control per action:
 *       READ  (read, read_raw, list_sheets) — any authenticated member
 *       WRITE (append*, update*)            — any event member
 *       ADMIN (delete, write_raw)           — owner or manager only
 *   - Write actions require `eventId` for membership verification
 *   - Every write action is logged to the audit_logs table
 *   - Google auth uses a service account — no user OAuth needed
 *
 * All actions accept an optional `spreadsheetId` field to target a
 * specific spreadsheet (per-event routing). If omitted, falls back
 * to the global default (env var or hard-coded JDE master sheet).
 *
 * Supported actions:
 *   POST { action: "read",   sheetTitle: "Sheet18", spreadsheetId?: "...", eventId?: "..." }
 *   POST { action: "append", sheetTitle: "Sheet18", data: { ... }, eventId: "...", ... }
 *   POST { action: "append_batch", sheetTitle: "Sheet18", rows: [...], eventId: "...", ... }
 *   POST { action: "update", sheetTitle: "Sheet18", rowIndex: 0, data: {...}, eventId: "...", ... }
 *   POST { action: "update_by_field", sheetTitle, matchColumn, matchValue, data, eventId, ... }
 *   POST { action: "delete", sheetTitle: "Sheet18", rowIndex: 0, eventId: "...", ... }
 *   POST { action: "list_sheets", spreadsheetId?: "..." }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logSheetAudit } from "@/lib/actions/audit";
import {
  requireEventRole,
  NotMemberError,
  InsufficientRoleError,
  type EventRole,
} from "@/lib/auth/roles";
import {
  readSheet,
  readSheetRaw,
  appendRow,
  appendRowRaw,
  appendRows,
  updateRow,
  updateRowByField,
  updateRowRawByField,
  writeSheetRaw,
  deleteRow,
  listSheets,
} from "@/lib/services/googleSheets";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ReadAction {
  action: "read";
  sheetTitle: string;
  spreadsheetId?: string;
  eventId?: string;
}

interface AppendAction {
  action: "append";
  sheetTitle: string;
  data: Record<string, unknown>;
  spreadsheetId?: string;
  eventId?: string;
}

interface AppendBatchAction {
  action: "append_batch";
  sheetTitle: string;
  rows: Record<string, unknown>[];
  spreadsheetId?: string;
  eventId?: string;
}

interface UpdateAction {
  action: "update";
  sheetTitle: string;
  rowIndex: number;
  data: Record<string, unknown>;
  spreadsheetId?: string;
  eventId?: string;
}

interface UpdateByFieldAction {
  action: "update_by_field";
  sheetTitle: string;
  matchColumn: string;
  matchValue: string;
  data: Record<string, unknown>;
  spreadsheetId?: string;
  eventId?: string;
}

interface DeleteAction {
  action: "delete";
  sheetTitle: string;
  rowIndex: number;
  spreadsheetId?: string;
  eventId?: string;
}

interface AppendRawAction {
  action: "append_raw";
  sheetTitle: string;
  values: unknown[];
  spreadsheetId?: string;
  eventId?: string;
}

interface UpdateRawAction {
  action: "update_raw";
  sheetTitle: string;
  matchColumnIndex: number;
  matchValue: string;
  values: unknown[];
  spreadsheetId?: string;
  eventId?: string;
}

interface ReadRawAction {
  action: "read_raw";
  sheetTitle: string;
  spreadsheetId?: string;
  eventId?: string;
}

interface WriteRawAction {
  action: "write_raw";
  sheetTitle: string;
  values: unknown[][];
  spreadsheetId?: string;
  eventId?: string;
}

interface ListSheetsAction {
  action: "list_sheets";
  spreadsheetId?: string;
  eventId?: string;
}

type SheetAction =
  | ReadAction
  | ReadRawAction
  | AppendAction
  | AppendRawAction
  | AppendBatchAction
  | UpdateAction
  | UpdateByFieldAction
  | UpdateRawAction
  | WriteRawAction
  | DeleteAction
  | ListSheetsAction;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Map sheet action name -> audit action name */
function toAuditAction(
  action: string,
): "sheet_read" | "sheet_append" | "sheet_update" | "sheet_delete" | "sheet_write" {
  switch (action) {
    case "read":
    case "read_raw":
    case "list_sheets":
      return "sheet_read";
    case "append":
    case "append_raw":
    case "append_batch":
      return "sheet_append";
    case "update":
    case "update_by_field":
    case "update_raw":
      return "sheet_update";
    case "delete":
      return "sheet_delete";
    case "write_raw":
      return "sheet_write";
    default:
      return "sheet_update";
  }
}

/** Read-only actions — no event membership required */
const READ_ACTIONS = ["read", "read_raw", "list_sheets"];

/** Admin-only actions — require owner or manager role */
const ADMIN_ACTIONS = ["delete", "write_raw"];

/** Whether the action is a write (should always be logged) */
function isWriteAction(action: string): boolean {
  return !READ_ACTIONS.includes(action);
}

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth check ─────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized — you must be logged in to access the Sheets API" },
      { status: 401 },
    );
  }

  // ── Parse body ─────────────────────────────────────────
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
      { error: "Missing 'action' field. Expected: read | read_raw | append | append_raw | append_batch | update | update_by_field | update_raw | write_raw | delete | list_sheets" },
      { status: 400 },
    );
  }

  // ── Role-based access control ───────────────────────────
  const eventId: string | null = body.eventId ?? null;
  let userRole: EventRole | null = null;

  if (isWriteAction(body.action)) {
    // All write actions require an eventId so we can verify membership
    if (!eventId) {
      return NextResponse.json(
        { error: "Missing 'eventId' — required for write actions" },
        { status: 400 },
      );
    }

    try {
      // Admin actions (delete, write_raw) → owner/manager only
      // Regular write actions → any event member
      const requiredRoles = ADMIN_ACTIONS.includes(body.action)
        ? (["owner", "manager"] as EventRole[])
        : undefined; // any member

      userRole = await requireEventRole(
        supabase,
        user.id,
        eventId,
        requiredRoles,
      );
    } catch (err) {
      if (err instanceof NotMemberError) {
        return NextResponse.json(
          { error: "Forbidden — you are not a member of this event" },
          { status: 403 },
        );
      }
      if (err instanceof InsufficientRoleError) {
        return NextResponse.json(
          {
            error: `Forbidden — action "${body.action}" requires role: ${err.requiredRoles.join(" or ")} (your role: ${err.actualRole})`,
          },
          { status: 403 },
        );
      }
      throw err;
    }
  } else if (eventId) {
    // Read actions: soft membership check (verify but don't block if
    // no eventId provided for backward compat with list_sheets, etc.)
    try {
      userRole = await requireEventRole(supabase, user.id, eventId);
    } catch {
      // Allow reads to proceed even if membership check fails —
      // Google Sheets service account auth is the real gate for reads
    }
  }

  // ── Helper: fire-and-forget audit log for write actions ─
  const auditLog = (changes?: Record<string, unknown> | null) => {
    if (!isWriteAction(body.action)) return;
    const sheetTitle = "sheetTitle" in body ? body.sheetTitle : "unknown";
    logSheetAudit({
      userId: user.id,
      eventId,
      action: toAuditAction(body.action),
      sheetTitle,
      spreadsheetId: body.spreadsheetId,
      changes,
      role: userRole ?? undefined,
    }).catch(() => {}); // never block the response
  };

  try {
    switch (body.action) {
      // ── READ ──────────────────────────────────────────────
      case "read": {
        const { sheetTitle, spreadsheetId } = body;
        if (!sheetTitle) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' for read action" },
            { status: 400 },
          );
        }
        const result = await readSheet(sheetTitle, spreadsheetId);
        return NextResponse.json(result, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      // ── READ RAW (positional 2D array) ──────────────────────
      case "read_raw": {
        const { sheetTitle, spreadsheetId } = body;
        if (!sheetTitle) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' for read_raw action" },
            { status: 400 },
          );
        }
        const rawResult = await readSheetRaw(sheetTitle, spreadsheetId);
        return NextResponse.json(rawResult, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      // ── APPEND (single row) ───────────────────────────────
      case "append": {
        const { sheetTitle, data, spreadsheetId } = body;
        if (!sheetTitle || !data) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'data' for append action" },
            { status: 400 },
          );
        }
        const result = await appendRow(sheetTitle, data, spreadsheetId);
        auditLog({ sheetTitle, data });
        return NextResponse.json(result, { status: 201 });
      }

      // ── APPEND RAW (positional array — for sheets with duplicate headers)
      case "append_raw": {
        const { sheetTitle, values, spreadsheetId } = body;
        if (!sheetTitle || !Array.isArray(values)) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'values' array for append_raw action" },
            { status: 400 },
          );
        }
        const result = await appendRowRaw(sheetTitle, values, spreadsheetId);
        auditLog({ sheetTitle, rowCount: 1 });
        return NextResponse.json(result, { status: 201 });
      }

      // ── APPEND BATCH (multiple rows) ──────────────────────
      case "append_batch": {
        const { sheetTitle, rows, spreadsheetId } = body;
        if (!sheetTitle || !Array.isArray(rows) || rows.length === 0) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'rows' array for append_batch action" },
            { status: 400 },
          );
        }
        const result = await appendRows(sheetTitle, rows, spreadsheetId);
        auditLog({ sheetTitle, rowCount: rows.length });
        return NextResponse.json(result, { status: 201 });
      }

      // ── UPDATE (by row index) ─────────────────────────────
      case "update": {
        const { sheetTitle, rowIndex, data, spreadsheetId } = body;
        if (!sheetTitle || rowIndex == null || !data) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle', 'rowIndex', or 'data' for update action" },
            { status: 400 },
          );
        }
        const result = await updateRow(sheetTitle, rowIndex, data, spreadsheetId);
        auditLog({ sheetTitle, rowIndex, data });
        return NextResponse.json(result);
      }

      // ── UPDATE BY FIELD (find + update) ───────────────────
      case "update_by_field": {
        const { sheetTitle, matchColumn, matchValue, data, spreadsheetId } = body;
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
          spreadsheetId,
        );
        auditLog({ sheetTitle, matchColumn, matchValue, data });
        return NextResponse.json(result);
      }

      // ── UPDATE RAW (find by column index + update entire row) ──
      case "update_raw": {
        const { sheetTitle, matchColumnIndex, matchValue, values, spreadsheetId } = body;
        if (!sheetTitle || matchColumnIndex == null || !matchValue || !Array.isArray(values)) {
          return NextResponse.json(
            { error: "Missing required fields for update_raw action. Need: sheetTitle, matchColumnIndex, matchValue, values" },
            { status: 400 },
          );
        }
        const result = await updateRowRawByField(
          sheetTitle,
          matchColumnIndex,
          matchValue,
          values,
          spreadsheetId,
        );
        auditLog({ sheetTitle, matchValue });
        return NextResponse.json(result);
      }

      // ── WRITE RAW (clear & replace all rows) ────────────────
      case "write_raw": {
        const { sheetTitle, values, spreadsheetId } = body;
        if (!sheetTitle || !Array.isArray(values)) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'values' array for write_raw action" },
            { status: 400 },
          );
        }
        const writeResult = await writeSheetRaw(sheetTitle, values, spreadsheetId);
        auditLog({ sheetTitle, rowCount: values.length });
        return NextResponse.json(writeResult);
      }

      // ── DELETE ─────────────────────────────────────────────
      case "delete": {
        const { sheetTitle, rowIndex, spreadsheetId } = body;
        if (!sheetTitle || rowIndex == null) {
          return NextResponse.json(
            { error: "Missing 'sheetTitle' or 'rowIndex' for delete action" },
            { status: 400 },
          );
        }
        const result = await deleteRow(sheetTitle, rowIndex, spreadsheetId);
        auditLog({ sheetTitle, rowIndex });
        return NextResponse.json(result);
      }

      // ── LIST SHEETS ───────────────────────────────────────
      case "list_sheets": {
        const { spreadsheetId } = body;
        const sheets = await listSheets(spreadsheetId);
        return NextResponse.json({ sheets }, {
          headers: { "Cache-Control": "no-store" },
        });
      }

      // ── UNKNOWN ───────────────────────────────────────────
      default: {
        return NextResponse.json(
          {
            error: `Unknown action: "${(body as Record<string, unknown>).action}". ` +
              `Expected: read | read_raw | append | append_raw | append_batch | update | update_by_field | update_raw | write_raw | delete | list_sheets`,
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
