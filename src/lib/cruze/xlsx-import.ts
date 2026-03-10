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

// ─── Cruze Import v1 — Capability Matrix Contract ───────────────────────────
// CI-004/005: Required standardized sheets for a valid import
const REQUIRED_SECTION_TYPES: TabType[] = ["deals", "inventory", "roster", "campaigns", "lenders"];

// CI-009: Event name validation
const EVENT_NAME_MAX_LENGTH = 100;

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
  isStandardized: boolean;
  /** CI-004: Did the file pass standardized structure validation? */
  validationPassed: boolean;
  /** CI-005: Which required sections are missing? */
  missingSections: TabType[];
  /** CI-006: Which required sections have critical header mismatches? */
  headerIssues: { section: TabType; issue: string }[];
  summary: string;
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
  /** CI-027: Post-import verified counts (re-queried from DB) */
  verified?: {
    deals: number;
    inventory: number;
    roster: number;
    campaigns: number;
    lenders: number;
    allMatch: boolean;
  };
}

// ─── CI-009: Event Name Validation ──────────────────────────────────────────

export async function validateEventName(name: string): Promise<{ valid: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, error: "Event name cannot be empty." };
  if (trimmed.length > EVENT_NAME_MAX_LENGTH) {
    return { valid: false, error: `Event name too long (max ${EVENT_NAME_MAX_LENGTH} chars).` };
  }
  if (/[<>{}|\\^`]/.test(trimmed)) {
    return { valid: false, error: "Event name contains invalid characters." };
  }
  return { valid: true };
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

  // CI-005: Check which required sections are present
  const detectedTypes = new Set(sheets.map((s) => s.detectedType));
  const missingSections = REQUIRED_SECTION_TYPES.filter((t) => !detectedTypes.has(t));

  // CI-006: Check for critical header mismatches (sheets detected but not autoReady)
  const headerIssues: { section: TabType; issue: string }[] = [];
  for (const sheet of sheets) {
    if (!sheet.autoReady && sheet.detectedType !== "unknown") {
      headerIssues.push({
        section: sheet.detectedType,
        issue: `"${sheet.name}" detected as ${sheet.detectedType} but confidence too low (${sheet.confidenceScore}%) — critical headers may be missing`,
      });
    }
  }

  // CI-004: Validation passes only if ALL required sections present with adequate confidence
  const validationPassed =
    missingSections.length === 0 &&
    headerIssues.length === 0 &&
    sheets.filter((s) => s.autoReady).length >= REQUIRED_SECTION_TYPES.length;

  return {
    fileName,
    sheets,
    totalRows,
    isStandardized,
    validationPassed,
    missingSections,
    headerIssues,
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
// ⚠️  Cruze Import v1: ALWAYS creates a new event. No merge/overwrite.
// If ANY step fails, the new event is cleaned up (cascade delete).

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
  },
  sheetsToImport?: number[],
): Promise<XLSXImportResult> {
  // ── Step 1: Create a fresh event ──────────────────────────────────────
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
  const eventId = created.eventId;
  const eventName = opts.eventName;
  const isNewEvent = true;

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
            // NOTE: bulkImportDeals does delete-then-insert for the event.
            // This is SAFE because the event is always brand new (v1).
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

  // CI-018: Initialize event config defaults for new events
  if (isNewEvent) {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (serviceKey) {
        const admin = createServiceClient(url, serviceKey);
        const { error: cfgErr } = await admin.from("event_config").insert({
          event_id: eventId,
          doc_fee: 0,
          pack_new: 0,
          pack_used: 0,
          tax_rate: 0,
          include_doc_fee_in_commission: false,
          rep_commission_pct: 0.25,
          jde_commission_pct: 0.25,
        });
        if (cfgErr) console.warn("[Cruze Import] Event config init failed:", cfgErr.message);
      }
    } catch (cfgError) {
      console.warn("[Cruze Import] Event config init error:", cfgError);
    }
  }

  // CI-027: Post-import verification — re-query each table and compare counts
  let verified: XLSXImportResult["verified"] = undefined;
  try {
    const supabase = await createClient();
    const [vDeals, vInventory, vRoster, vCampaigns, vLenders] = await Promise.all([
      supabase.from("sales_deals").select("id", { count: "exact", head: true }).eq("event_id", eventId),
      supabase.from("vehicle_inventory").select("id", { count: "exact", head: true }).eq("event_id", eventId),
      supabase.from("roster").select("id", { count: "exact", head: true }).eq("event_id", eventId),
      supabase.from("mail_tracking").select("id", { count: "exact", head: true }).eq("event_id", eventId),
      supabase.from("lenders").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    ]);

    const vCounts = {
      deals: vDeals.count ?? 0,
      inventory: vInventory.count ?? 0,
      roster: vRoster.count ?? 0,
      campaigns: vCampaigns.count ?? 0,
      lenders: vLenders.count ?? 0,
    };

    const allMatch =
      vCounts.deals === dealCount &&
      vCounts.inventory === inventoryCount &&
      vCounts.roster === rosterCount &&
      vCounts.campaigns === campaignCount &&
      vCounts.lenders === lenderCount;

    verified = { ...vCounts, allMatch };

    if (!allMatch) {
      console.warn("[Cruze Import] Post-import verification MISMATCH:", {
        expected: { deals: dealCount, inventory: inventoryCount, roster: rosterCount, campaigns: campaignCount, lenders: lenderCount },
        actual: vCounts,
      });
      errors.push(`Verification: expected counts differ from DB — imported ${dealCount} deals but found ${vCounts.deals}`);
    } else {
      console.log("[Cruze Import] Post-import verification PASSED:", vCounts);
    }
  } catch (verifyErr) {
    console.warn("[Cruze Import] Post-import verification failed:", verifyErr);
    errors.push("Post-import verification could not be completed");
  }

  // CI-028: Audit logging — awaited, not fire-and-forget
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (serviceKey) {
        const admin = createServiceClient(url, serviceKey);
        const { error: auditErr } = await admin.from("audit_logs").insert({
          event_id: eventId,
          user_id: user.id,
          action: "cruze_import_xlsx",
          entity_type: "event",
          entity_id: eventId,
          new_values: {
            fileName,
            mode: opts.mode,
            isNewEvent,
            deals: dealCount,
            inventory: inventoryCount,
            roster: rosterCount,
            campaigns: campaignCount,
            lenders: lenderCount,
            totalGross: Math.round(totalGross),
            errors,
            verified: verified?.allMatch ?? null,
            via: "cruze",
          },
        });
        if (auditErr) {
          console.error("[Cruze Import] AUDIT LOG FAILED:", auditErr.message);
          errors.push("Audit log could not be saved — import data is intact but unlogged");
        }
      }
    }
  } catch (auditError) {
    console.error("[Cruze Import] Audit logging error:", auditError);
    errors.push("Audit logging failed");
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
  const targetLabel = `new event "${eventName}"`;
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
    verified,
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
