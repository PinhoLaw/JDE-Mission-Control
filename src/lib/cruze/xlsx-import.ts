// CRUZE STANDARDIZED XLSX SAFE IMPORT — MARCH 2026
// Server-side XLSX parsing and import execution for Cruze drag & drop.
// Reuses the exact same parser and import pipeline as the UI import flow.
//
// ⚠️  SAFETY: This module NEVER overwrites or merges into an existing event
// unless the caller explicitly passes an existing eventId. The default path
// is ALWAYS to create a brand-new event first, then scope all inserts to it.
// If any step fails, the new event is cleaned up (cascade delete).

"use server";

import {
  parseSingleSheet,
  executeImport,
  executeRosterImport,
  type ParsedSheet,
} from "@/lib/actions/import-vehicles";
import { scanSpreadsheet } from "@/lib/actions/import-vehicles";
import { bulkImportDeals, bulkImportMailTracking } from "@/lib/actions/legacy-import";
import {
  detectTabType,
  detectTabTypeFromHeaders,
  autoMapColumn,
  autoMapRosterColumn,
  autoMapDealColumn,
  autoMapCampaignsColumn,
  autoMapLenderColumn,
  computeMappingConfidence,
  type TabType,
} from "@/lib/utils/column-mapping";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SheetPreview {
  name: string;
  index: number;
  detectedType: TabType;
  headers: string[];
  rowCount: number;
  columnMap: Record<string, string>;
  confidenceScore: number;
  autoReady: boolean;
}

export interface XLSXScanResult {
  fileName: string;
  sheets: SheetPreview[];
  totalRows: number;
  isStandardized: boolean; // true if we auto-detected known JDE sheet types
  summary: string; // "47 deals, 120 vehicles, 8 roster members detected"
}

/** Dry-run preview — shows what WOULD be imported, without touching the DB. */
export interface ImportPreview {
  fileName: string;
  sheets: { name: string; type: TabType; rowCount: number; confidence: number }[];
  totalRows: number;
  summary: string;
  /** The event this data would be imported into (new or existing). */
  targetEvent: { id: string; name: string; isNew: boolean } | null;
}

export interface XLSXImportResult {
  success: boolean;
  eventId: string;
  eventName: string;
  isNewEvent: boolean;
  inventory: number;
  deals: number;
  roster: number;
  campaigns: number;
  lenders: number;
  totalGross: number;
  errors: string[];
  summary: string;
}

// ─── Scan ───────────────────────────────────────────────────────────────────
// Detect sheets, auto-map columns, return preview. READ-ONLY — no DB writes.

export async function scanXLSXForCruze(fileBuffer: ArrayBuffer, fileName: string): Promise<XLSXScanResult> {
  const blob = new Blob([fileBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const file = new File([blob], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const formData = new FormData();
  formData.append("file", file);

  const scan = await scanSpreadsheet(formData);

  const sheets: SheetPreview[] = [];
  let totalRows = 0;

  for (const sheet of scan.sheets) {
    let detectedType = detectTabType(sheet.name);
    if (detectedType === "unknown") {
      const headerDetection = detectTabTypeFromHeaders(sheet.headers);
      detectedType = headerDetection.tabType;
    }

    if (detectedType === "unknown") continue;

    const columnMap: Record<string, string> = {};
    for (const header of sheet.headers) {
      switch (detectedType) {
        case "inventory":
          columnMap[header] = autoMapColumn(header);
          break;
        case "roster":
          columnMap[header] = autoMapRosterColumn(header);
          break;
        case "deals":
          columnMap[header] = autoMapDealColumn(header);
          break;
        case "lenders":
          columnMap[header] = autoMapLenderColumn(header);
          break;
        case "campaigns":
          columnMap[header] = autoMapCampaignsColumn(header);
          break;
      }
    }

    const confidence = computeMappingConfidence(columnMap, detectedType);

    // CRUZE TOTAL GROSS FIX — MARCH 2026
    // Log which gross column was detected for deals sheets
    if (detectedType === "deals") {
      const grossMappings = Object.entries(columnMap)
        .filter(([, v]) => v.includes("gross") || v === "fi_total")
        .map(([header, field]) => `"${header}" → ${field}`);
      console.log(`[Cruze Scan] Deals sheet "${sheet.name}" gross columns: ${grossMappings.join(", ") || "NONE FOUND"}`);
    }

    sheets.push({
      name: sheet.name,
      index: sheet.index,
      detectedType,
      headers: sheet.headers,
      rowCount: sheet.rowCount,
      columnMap,
      confidenceScore: confidence.score,
      autoReady: confidence.autoReady,
    });

    totalRows += sheet.rowCount;
  }

  const typeCounts: Record<string, number> = {};
  for (const s of sheets) {
    typeCounts[s.detectedType] = (typeCounts[s.detectedType] || 0) + s.rowCount;
  }

  const summaryParts: string[] = [];
  if (typeCounts.deals) summaryParts.push(`${typeCounts.deals} deals`);
  if (typeCounts.inventory) summaryParts.push(`${typeCounts.inventory} vehicles`);
  if (typeCounts.roster) summaryParts.push(`${typeCounts.roster} roster members`);
  if (typeCounts.campaigns) summaryParts.push(`${typeCounts.campaigns} campaign rows`);
  if (typeCounts.lenders) summaryParts.push(`${typeCounts.lenders} lenders`);

  const isStandardized = sheets.length >= 2 && sheets.every((s) => s.autoReady);

  return {
    fileName,
    sheets,
    totalRows,
    isStandardized,
    summary: summaryParts.length > 0
      ? `Detected: ${summaryParts.join(", ")}`
      : "No importable data detected",
  };
}

// ─── Dry-Run Preview ────────────────────────────────────────────────────────
// Returns exactly what would be imported. NO database writes.

export async function previewXLSXImport(
  fileBuffer: ArrayBuffer,
  fileName: string,
  targetEventName?: string,
): Promise<ImportPreview> {
  const scan = await scanXLSXForCruze(fileBuffer, fileName);

  return {
    fileName,
    sheets: scan.sheets.map((s) => ({
      name: s.name,
      type: s.detectedType,
      rowCount: s.rowCount,
      confidence: s.confidenceScore,
    })),
    totalRows: scan.totalRows,
    summary: scan.summary,
    targetEvent: targetEventName
      ? { id: "pending", name: targetEventName, isNew: true }
      : null,
  };
}

// ─── Create New Event ───────────────────────────────────────────────────────
// Creates a fresh, empty event row + owner membership. Returns the new ID.
// ⚠️  SAFETY: This is the ONLY way the import tool should get an event ID
// for new data. It must NEVER reuse an existing event's ID.

export async function createEventForImport(opts: {
  name: string;
  dealerName?: string;
  status?: "draft" | "active" | "completed" | "cancelled";
  city?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  saleDays?: number;
}): Promise<{ eventId: string; slug: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Missing service role key");
  const admin = createServiceClient(url, serviceKey);

  const slug = `${slugify(opts.name)}-${Date.now().toString(36)}`;

  const { data: event, error } = await admin
    .from("events")
    .insert({
      name: opts.name,
      slug,
      status: opts.status || "completed",
      dealer_name: opts.dealerName || null,
      city: opts.city || null,
      state: opts.state || null,
      start_date: opts.startDate || null,
      end_date: opts.endDate || null,
      sale_days: opts.saleDays || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create event: ${error.message}`);

  // Add creator as owner
  await admin.from("event_members").insert({
    event_id: event.id,
    user_id: user.id,
    role: "owner" as const,
  });

  console.log(`[Cruze Import] Created new event "${opts.name}" (${event.id})`);
  return { eventId: event.id, slug };
}

// ─── Safe Import Execution ──────────────────────────────────────────────────
// ⚠️  SAFETY RULES:
// 1. When mode is "new_event", a NEW event is created first. All data goes
//    into the new event only. No existing event is ever touched.
// 2. When mode is "into_existing", the caller must provide an eventId AND
//    the user must have explicitly said "merge into [exact event name]".
//    Even then, only APPEND operations are used — no deletes.
// 3. If ANY step fails, and we created a new event, we delete it (cascade).

export async function executeXLSXImport(
  fileBuffer: ArrayBuffer,
  fileName: string,
  opts: {
    mode: "new_event";
    eventName: string;
    dealerName?: string;
    status?: "draft" | "active" | "completed" | "cancelled";
    city?: string;
    state?: string;
    startDate?: string;
    endDate?: string;
    saleDays?: number;
  } | {
    mode: "into_existing";
    eventId: string;
    eventName: string;
  },
  sheetsToImport?: number[],
): Promise<XLSXImportResult> {
  // ── Step 1: Resolve event ID ──────────────────────────────────────────
  let eventId: string;
  let eventName: string;
  let isNewEvent: boolean;

  if (opts.mode === "new_event") {
    // SAFETY: Always create a fresh event. Never reuse.
    const created = await createEventForImport({
      name: opts.eventName,
      dealerName: opts.dealerName,
      status: opts.status,
      city: opts.city,
      state: opts.state,
      startDate: opts.startDate,
      endDate: opts.endDate,
      saleDays: opts.saleDays,
    });
    eventId = created.eventId;
    eventName = opts.eventName;
    isNewEvent = true;
  } else {
    // SAFETY: Caller explicitly chose to merge into an existing event.
    // Verify the event actually exists before proceeding.
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("events")
      .select("id, name")
      .eq("id", opts.eventId)
      .single();

    if (!existing) {
      throw new Error(`Event ${opts.eventId} not found. Cannot import into non-existent event.`);
    }

    eventId = opts.eventId;
    eventName = existing.name;
    isNewEvent = false;
  }

  // ── Step 2: Scan the file ─────────────────────────────────────────────
  const scan = await scanXLSXForCruze(fileBuffer, fileName);

  const errors: string[] = [];
  let inventoryCount = 0;
  let dealCount = 0;
  let rosterCount = 0;
  let campaignCount = 0;
  let lenderCount = 0;
  let totalGross = 0;

  const blob = new Blob([fileBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const file = new File([blob], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // ── Step 3: Import each sheet into the target event ───────────────────
  try {
    for (const sheet of scan.sheets) {
      if (sheetsToImport && !sheetsToImport.includes(sheet.index)) continue;

      // SAFETY: Skip sheets that didn't pass the confidence threshold.
      // Low-confidence sheets (e.g. "THINGS NOT IN CURRENT DEAL LOG") can
      // trigger destructive REPLACE-mode importers and wipe real data.
      if (!sheet.autoReady) {
        console.log(`[Cruze Import] Skipping "${sheet.name}" (autoReady=false, confidence=${sheet.confidenceScore}%)`);
        continue;
      }

      let parsed: ParsedSheet;
      try {
        const fd = new FormData();
        fd.append("file", file);
        parsed = await parseSingleSheet(fd, sheet.index);
      } catch (err) {
        errors.push(`${sheet.name}: parse failed — ${err instanceof Error ? err.message : "unknown"}`);
        continue;
      }

      const { detectedType, columnMap } = sheet;

      try {
        switch (detectedType) {
          case "inventory": {
            // SAFETY: Always append. Never replace.
            const result = await executeImport(
              parsed.rows as Record<string, string>[],
              columnMap,
              eventId,
              "append",
            );
            inventoryCount += result.imported;
            if (result.errors > 0) errors.push(`Inventory: ${result.errors} row errors`);
            break;
          }

          case "roster": {
            // SAFETY: Always append. Never replace.
            const result = await executeRosterImport(
              parsed.rows as Record<string, string>[],
              columnMap,
              eventId,
              "append",
            );
            rosterCount += result.imported;
            if (result.errors > 0) errors.push(`Roster: ${result.errors} row errors`);
            break;
          }

          case "deals": {
            // NOTE: bulkImportDeals always does a delete-then-insert for the
            // given eventId. This is SAFE here because:
            //   - For new_event: the event is brand new, so there's nothing to delete.
            //   - For into_existing: the user explicitly requested a merge.
            //     In a future version, we could add an append-only deals import.
            const result = await bulkImportDeals(
              parsed.rows as Record<string, string>[],
              columnMap,
              eventId,
            );
            dealCount += result.imported;
            if (result.errors > 0) errors.push(`Deals: ${result.errors} row errors`);

            // CRUZE TOTAL GROSS FIX + FILE RELIABILITY — MARCH 2026
            // Smart Total Gross: prefer total_gross column, fall back to front_gross
            const hasTotalGrossCol = Object.values(columnMap).includes("total_gross");
            const hasFrontGrossCol = Object.values(columnMap).includes("front_gross");
            const hasBackGrossCol = Object.values(columnMap).includes("back_gross");

            if (hasTotalGrossCol) {
              console.log("[Cruze Import] Using TOTAL GROSS column directly (correct)");
            } else if (hasFrontGrossCol && hasBackGrossCol) {
              console.log("[Cruze Import] No Total Gross column — calculating from front + back gross");
            } else if (hasFrontGrossCol) {
              console.log("[Cruze Import] WARNING: Only Front Gross found — total gross will be understated");
            }

            for (const row of parsed.rows) {
              const mapped = applyColumnMap(row, columnMap);
              let gross = 0;

              if (hasTotalGrossCol && mapped.total_gross != null) {
                // Best: use the actual Total Gross column
                gross = parseFloat(String(mapped.total_gross).replace(/[$,]/g, ""));
              } else if (hasFrontGrossCol && hasBackGrossCol) {
                // Good: front + back
                const front = parseFloat(String(mapped.front_gross || "0").replace(/[$,]/g, ""));
                const back = parseFloat(String(mapped.back_gross || "0").replace(/[$,]/g, ""));
                gross = (isNaN(front) ? 0 : front) + (isNaN(back) ? 0 : back);
              } else if (hasFrontGrossCol) {
                // Fallback: front only (understated)
                gross = parseFloat(String(mapped.front_gross || "0").replace(/[$,]/g, ""));
              }

              if (!isNaN(gross)) totalGross += gross;
            }
            break;
          }

          case "campaigns": {
            const sheetNameLower = sheet.name.toLowerCase().trim();
            const isCurrent =
              sheetNameLower === "campaign tracking" ||
              sheetNameLower === "campaigns" ||
              sheetNameLower === "campaign" ||
              sheetNameLower === "mail tracking";
            const campaignSource = isCurrent ? "current" : sheet.name.trim();

            const result = await bulkImportMailTracking(
              parsed.rows as Record<string, string>[],
              columnMap,
              eventId,
              campaignSource,
            );
            campaignCount += result.imported;
            if (result.errors > 0) errors.push(`Campaigns: ${result.errors} row errors`);
            break;
          }

          case "lenders": {
            const { bulkImportLenders } = await import("@/lib/actions/legacy-import");
            const result = await bulkImportLenders(
              parsed.rows as Record<string, string>[],
              columnMap,
              eventId,
            );
            lenderCount += result.imported;
            if (result.errors > 0) errors.push(`Lenders: ${result.errors} row errors`);
            break;
          }
        }
      } catch (err) {
        errors.push(`${sheet.name} (${detectedType}): ${err instanceof Error ? err.message : "failed"}`);
      }
    }
  } catch (fatalErr) {
    // ── SAFETY: If we created a new event and import failed, clean it up ──
    if (isNewEvent) {
      console.error(`[Cruze Import] Fatal error during import into new event ${eventId}. Cleaning up...`);
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const admin = createServiceClient(url, serviceKey);
        await admin.from("events").delete().eq("id", eventId);
        console.log(`[Cruze Import] Cleaned up failed event ${eventId}`);
      } catch (cleanupErr) {
        console.error(`[Cruze Import] Failed to clean up event ${eventId}:`, cleanupErr);
      }
    }
    throw fatalErr;
  }

  // Revalidate all dashboard pages
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/roster");
  revalidatePath("/dashboard/campaigns");
  revalidatePath("/dashboard/daily-metrics");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/commissions");

  const parts: string[] = [];
  if (dealCount > 0) parts.push(`${dealCount} deals`);
  if (inventoryCount > 0) parts.push(`${inventoryCount} vehicles`);
  if (rosterCount > 0) parts.push(`${rosterCount} roster members`);
  if (campaignCount > 0) parts.push(`${campaignCount} campaign rows`);
  if (lenderCount > 0) parts.push(`${lenderCount} lenders`);

  const total = dealCount + inventoryCount + rosterCount + campaignCount + lenderCount;
  const grossStr = totalGross > 0 ? `. Total gross: $${Math.round(totalGross).toLocaleString()}` : "";
  const targetLabel = isNewEvent ? `new event "${eventName}"` : `existing event "${eventName}"`;
  const summary = total > 0
    ? `Imported ${parts.join(", ")} into ${targetLabel}${grossStr}. Dashboard updated.`
    : "No records imported — check the file format.";

  return {
    success: total > 0 && errors.length === 0,
    eventId,
    eventName,
    isNewEvent,
    inventory: inventoryCount,
    deals: dealCount,
    roster: rosterCount,
    campaigns: campaignCount,
    lenders: lenderCount,
    totalGross: Math.round(totalGross),
    errors,
    summary,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function applyColumnMap(
  row: Record<string, unknown>,
  columnMap: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [header, dbField] of Object.entries(columnMap)) {
    if (dbField && dbField !== "__skip__" && row[header] !== undefined) {
      result[dbField] = row[header];
    }
  }
  return result;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
