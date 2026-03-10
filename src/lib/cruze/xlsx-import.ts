// CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026
// Server-side XLSX parsing and import execution for Cruze drag & drop.
// Reuses the exact same parser and import pipeline as the UI import flow.

"use server";

import {
  parseSingleSheet,
  executeImport,
  executeRosterImport,
  type ParsedSheet,
  type ImportResult,
} from "@/lib/actions/import-vehicles";
import { scanSpreadsheet, type SheetMeta } from "@/lib/actions/import-vehicles";
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

export interface XLSXImportResult {
  success: boolean;
  inventory: number;
  deals: number;
  roster: number;
  campaigns: number;
  lenders: number;
  totalGross: number;
  errors: string[];
  summary: string;
}

// ─── CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026 ──────────────────────
// Scan an XLSX file: detect sheets, auto-map columns, return preview

export async function scanXLSXForCruze(fileBuffer: ArrayBuffer, fileName: string): Promise<XLSXScanResult> {
  // Build FormData to reuse existing scanSpreadsheet()
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
    // Detect tab type — by name first, then by headers
    let detectedType = detectTabType(sheet.name);
    if (detectedType === "unknown") {
      const headerDetection = detectTabTypeFromHeaders(sheet.headers);
      detectedType = headerDetection.tabType;
    }

    // Skip unknown sheets
    if (detectedType === "unknown") continue;

    // Auto-map columns based on detected type
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

    // Compute confidence
    const requiredFields: Record<TabType, string[]> = {
      inventory: ["stock_number", "year", "make", "model"],
      roster: ["name"],
      deals: ["customer_name", "stock_number"],
      lenders: ["name"],
      campaigns: ["zip_code"],
      unknown: [],
    };

    const confidence = computeMappingConfidence(
      columnMap,
      detectedType,
    );

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

  // Build summary
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

// ─── CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026 ──────────────────────
// Execute the actual import of all detected sheets into an event

export async function executeXLSXImport(
  fileBuffer: ArrayBuffer,
  fileName: string,
  eventId: string,
  sheetsToImport?: number[], // optional: only import specific sheet indices
): Promise<XLSXImportResult> {
  // First scan to get sheet metadata
  const scan = await scanXLSXForCruze(fileBuffer, fileName);

  const errors: string[] = [];
  let inventoryCount = 0;
  let dealCount = 0;
  let rosterCount = 0;
  let campaignCount = 0;
  let lenderCount = 0;
  let totalGross = 0;

  // Build FormData for parseSingleSheet
  const blob = new Blob([fileBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const file = new File([blob], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  for (const sheet of scan.sheets) {
    // If specific sheets requested, skip others
    if (sheetsToImport && !sheetsToImport.includes(sheet.index)) continue;

    // Parse the full sheet data
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
          const result = await executeImport(
            parsed.rows as Record<string, string>[],
            columnMap,
            eventId,
            "append", // append mode — don't destroy existing data
          );
          inventoryCount += result.imported;
          if (result.errors > 0) errors.push(`Inventory: ${result.errors} row errors`);
          break;
        }

        case "roster": {
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
          const result = await bulkImportDeals(
            parsed.rows as Record<string, string>[],
            columnMap,
            eventId,
          );
          dealCount += result.imported;
          if (result.errors > 0) errors.push(`Deals: ${result.errors} row errors`);

          // Calculate total gross from imported deals
          for (const row of parsed.rows) {
            const mapped = applyColumnMap(row, columnMap);
            const gross = parseFloat(String(mapped.total_gross || mapped.front_gross || "0").replace(/[$,]/g, ""));
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
          // Lenders use a simpler direct insert
          // (bulkImportLenders exists in legacy-import.ts)
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

  // Revalidate all dashboard pages
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/roster");
  revalidatePath("/dashboard/campaigns");
  revalidatePath("/dashboard/daily-metrics");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/commissions");

  // Build summary
  const parts: string[] = [];
  if (dealCount > 0) parts.push(`${dealCount} deals`);
  if (inventoryCount > 0) parts.push(`${inventoryCount} vehicles`);
  if (rosterCount > 0) parts.push(`${rosterCount} roster members`);
  if (campaignCount > 0) parts.push(`${campaignCount} campaign rows`);
  if (lenderCount > 0) parts.push(`${lenderCount} lenders`);

  const total = dealCount + inventoryCount + rosterCount + campaignCount + lenderCount;
  const grossStr = totalGross > 0 ? `. Total gross: $${Math.round(totalGross).toLocaleString()}` : "";
  const summary = total > 0
    ? `Imported ${parts.join(", ")}${grossStr}. Dashboard updated.`
    : "No records imported — check the file format.";

  return {
    success: total > 0 && errors.length === 0,
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

// ─── Helper ─────────────────────────────────────────────────────────────────

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
