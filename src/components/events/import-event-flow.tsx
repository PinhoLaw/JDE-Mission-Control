"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Upload,
  Loader2,
  CheckCircle2,
  FileSpreadsheet,
  AlertTriangle,
  Layers,
  ChevronDown,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  scanSpreadsheet,
  parseSingleSheet,
  executeImport,
  executeRosterImport,
  type SheetMeta,
} from "@/lib/actions/import-vehicles";
import { bulkImportDeals, bulkImportMailTracking } from "@/lib/actions/legacy-import";
import { createEventAndReturnId } from "@/app/(dashboard)/dashboard/events/actions";
import {
  detectTabType,
  detectTabTypeFromHeaders,
  autoMapColumn,
  autoMapRosterColumn,
  autoMapDealColumn,
  autoMapCampaignsColumn,
  type TabType,
} from "@/lib/utils/column-mapping";

type Step = "upload" | "configure" | "importing" | "done";

interface SheetWithType extends SheetMeta {
  detectedType: TabType;
  selected: boolean;
}

interface ImportSummary {
  eventName: string;
  inventory: number;
  deals: number;
  roster: number;
  campaigns: number;
  errors: string[];
}

export function ImportEventFlow() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Keep the raw file around so we can re-read individual sheets during import
  const uploadedFileRef = useRef<File | null>(null);

  const [step, setStep] = useState<Step>("upload");
  const [isParsing, setIsParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetWithType[]>([]);
  const [eventName, setEventName] = useState("");
  const [dealerName, setDealerName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [showUnknown, setShowUnknown] = useState(false);

  // ── File scanning (lightweight — no row data) ──
  const parseFile = useCallback(async (file: File) => {
    setIsParsing(true);
    try {
      uploadedFileRef.current = file;
      const formData = new FormData();
      formData.append("file", file);
      const result = await scanSpreadsheet(formData);

      setFileName(result.fileName);

      // Detect tab types for each sheet — try sheet name first, then headers
      const sheetsWithTypes: SheetWithType[] = result.sheets.map((s) => {
        let detectedType = detectTabType(s.name);
        // If sheet name didn't identify it, try content-based header detection
        if (detectedType === "unknown" && s.headers.length > 0) {
          const { tabType, score } = detectTabTypeFromHeaders(s.headers);
          if (score >= 2) detectedType = tabType;
        }
        const importable = ["inventory", "deals", "roster", "campaigns", "lenders"].includes(detectedType);
        return { ...s, detectedType, selected: importable };
      });

      setSheets(sheetsWithTypes);

      // Derive event name from filename
      const baseName = file.name.replace(/\.(xlsx|xls|csv)$/i, "").replace(/\s*\(\d+\)\s*$/, "").trim();
      setEventName(baseName);
      setDealerName(baseName);

      setStep("configure");
      const importableCount = sheetsWithTypes.filter((s) => s.detectedType !== "unknown").length;
      const unknownCount = sheetsWithTypes.filter((s) => s.detectedType === "unknown").length;
      const msg = unknownCount > 0
        ? `${importableCount} importable sheet(s) found, ${unknownCount} skipped`
        : `${importableCount} sheet(s) recognized for import`;
      toast.success(msg);
    } catch (err) {
      console.error("[ImportEventFlow] Scan error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Scan failed: ${msg}`);
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) parseFile(file);
    },
    [parseFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) parseFile(file);
    },
    [parseFile],
  );

  const toggleSheet = useCallback((index: number) => {
    setSheets((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)),
    );
  }, []);

  // ── Full import pipeline ──
  const handleImport = useCallback(async () => {
    if (!eventName.trim()) {
      toast.error("Enter an event name");
      return;
    }

    const selected = sheets.filter((s) => s.selected);
    if (selected.length === 0) {
      toast.error("Select at least one sheet to import");
      return;
    }

    if (!uploadedFileRef.current) {
      toast.error("File lost — please re-upload");
      setStep("upload");
      return;
    }

    setIsImporting(true);
    setStep("importing");
    const errors: string[] = [];
    let inventoryCount = 0;
    let dealCount = 0;
    let rosterCount = 0;
    let campaignCount = 0;

    try {
      // Step 1: Create the event (returns the ID directly, no redirect)
      setImportProgress("Creating event...");
      const eventFormData = new FormData();
      eventFormData.set("name", eventName.trim());
      eventFormData.set("dealer_name", dealerName.trim() || eventName.trim());
      eventFormData.set("status", "active");

      const eventId = await createEventAndReturnId(eventFormData);

      // Step 2: Import each selected sheet — parse one at a time to avoid payload limits
      for (const sheet of selected) {
        const { detectedType } = sheet;

        setImportProgress(`Parsing "${sheet.name}" (${sheet.rowCount} rows)...`);

        // Re-read the file and parse just this sheet
        let parsedRows: Record<string, unknown>[];
        let parsedHeaders: string[];
        try {
          const fd = new FormData();
          fd.append("file", uploadedFileRef.current);
          const parsed = await parseSingleSheet(fd, sheet.index);
          parsedRows = parsed.rows;
          parsedHeaders = parsed.headers;
        } catch (err) {
          errors.push(`${sheet.name}: parse failed — ${err instanceof Error ? err.message : "unknown"}`);
          continue;
        }

        if (detectedType === "inventory") {
          setImportProgress(`Importing inventory (${parsedRows.length} rows)...`);
          const colMap: Record<string, string> = {};
          for (const h of parsedHeaders) colMap[h] = autoMapColumn(h);
          try {
            const result = await executeImport(
              parsedRows as Record<string, string>[],
              colMap,
              eventId,
              "replace",
            );
            inventoryCount += result.imported;
            if (result.errors > 0) errors.push(`Inventory: ${result.errors} row errors`);
          } catch (err) {
            errors.push(`Inventory: ${err instanceof Error ? err.message : "failed"}`);
          }
        }

        if (detectedType === "roster") {
          setImportProgress(`Importing roster (${parsedRows.length} rows)...`);
          const colMap: Record<string, string> = {};
          for (const h of parsedHeaders) colMap[h] = autoMapRosterColumn(h);
          try {
            const result = await executeRosterImport(
              parsedRows as Record<string, string>[],
              colMap,
              eventId,
              "replace",
            );
            rosterCount += result.imported;
            if (result.errors > 0) errors.push(`Roster: ${result.errors} row errors`);
          } catch (err) {
            errors.push(`Roster: ${err instanceof Error ? err.message : "failed"}`);
          }
        }

        if (detectedType === "deals") {
          setImportProgress(`Importing deals (${parsedRows.length} rows)...`);
          const colMap: Record<string, string> = {};
          for (const h of parsedHeaders) colMap[h] = autoMapDealColumn(h);
          try {
            const result = await bulkImportDeals(
              parsedRows as Record<string, string>[],
              colMap,
              eventId,
            );
            dealCount += result.imported;
            if (result.errors > 0) errors.push(`Deals: ${result.errors} row errors`);
          } catch (err) {
            errors.push(`Deals: ${err instanceof Error ? err.message : "failed"}`);
          }
        }

        if (detectedType === "campaigns") {
          // Determine campaign_source: "current" for main Campaign Tracking sheet,
          // otherwise use the sheet name (e.g. "June 2025 Campaign Data")
          const sheetNameLower = sheet.name.toLowerCase().trim();
          const isCurrent =
            sheetNameLower === "campaign tracking" ||
            sheetNameLower === "campaigns" ||
            sheetNameLower === "campaign" ||
            sheetNameLower === "mail tracking";
          const campaignSource = isCurrent ? "current" : sheet.name.trim();

          setImportProgress(`Importing campaign data (${parsedRows.length} rows)...`);
          const colMap: Record<string, string> = {};
          for (const h of parsedHeaders) colMap[h] = autoMapCampaignsColumn(h);
          try {
            const result = await bulkImportMailTracking(
              parsedRows as Record<string, string>[],
              colMap,
              eventId,
              campaignSource,
            );
            campaignCount += result.imported;
            if (result.errors > 0) errors.push(`Campaigns: ${result.errors} row errors`);
          } catch (err) {
            errors.push(`Campaigns: ${err instanceof Error ? err.message : "failed"}`);
          }
        }
      }

      // Step 3: Done
      setSummary({
        eventName: eventName.trim(),
        inventory: inventoryCount,
        deals: dealCount,
        roster: rosterCount,
        campaigns: campaignCount,
        errors,
      });
      setStep("done");

      const total = inventoryCount + dealCount + rosterCount + campaignCount;
      if (errors.length === 0) {
        toast.success(`Imported ${total} records into "${eventName}"`);
      } else {
        toast.warning(`Imported ${total} records with ${errors.length} issue(s)`);
      }

      router.refresh();
    } catch (err) {
      console.error("[ImportEventFlow] Import error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Import failed: ${msg}`);
      setStep("configure");
    } finally {
      setIsImporting(false);
    }
  }, [eventName, dealerName, sheets, router]);

  // ── Memoized sheet groups (must be before early returns — React hooks rules) ──
  const importableSheets = useMemo(
    () => sheets.filter((s) => s.detectedType !== "unknown"),
    [sheets],
  );
  const unknownSheets = useMemo(
    () => sheets.filter((s) => s.detectedType === "unknown"),
    [sheets],
  );

  const typeLabel: Record<TabType, string> = {
    inventory: "Inventory",
    deals: "Deal Log",
    roster: "Roster",
    lenders: "Lenders",
    campaigns: "Campaign",
    unknown: "Unknown",
  };

  const typeColor: Record<TabType, string> = {
    inventory: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    deals: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    roster: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    lenders: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    campaigns: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
    unknown: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  };

  // ── Upload step ──
  if (step === "upload") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upload Spreadsheet</CardTitle>
          <CardDescription>
            Upload your JDE event spreadsheet (.xlsx). The system will detect
            Deal Log, Inventory, Campaign, and Roster sheets automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !isParsing && fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 cursor-pointer transition-colors ${
              isParsing
                ? "border-primary/50 bg-primary/5 cursor-wait"
                : dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
            }`}
          >
            {isParsing ? (
              <>
                <Loader2 className="h-10 w-10 text-primary mb-4 animate-spin" />
                <p className="text-sm font-medium mb-1">Parsing spreadsheet...</p>
                <p className="text-xs text-muted-foreground">
                  Detecting sheets and column headers
                </p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                <p className="text-sm font-medium mb-1">
                  Drop your spreadsheet here
                </p>
                <p className="text-xs text-muted-foreground">
                  .xlsx or .csv — up to 10 MB
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileSelect}
              disabled={isParsing}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Configure step (name event + select sheets) ──
  if (step === "configure") {
    const selectedSheets = sheets.filter((s) => s.selected);
    const totalRows = selectedSheets.reduce((s, sh) => s + sh.rowCount, 0);

    const renderSheetRow = (sheet: SheetWithType, i: number) => (
      <button
        key={i}
        onClick={() => toggleSheet(sheets.indexOf(sheet))}
        className={`w-full flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
          sheet.selected
            ? "border-primary bg-primary/5"
            : "border-muted hover:border-primary/20"
        }`}
      >
        <Checkbox
          checked={sheet.selected}
          onCheckedChange={() => toggleSheet(sheets.indexOf(sheet))}
          className="pointer-events-none"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate">{sheet.name}</p>
            <Badge
              variant="secondary"
              className={`text-[10px] ${typeColor[sheet.detectedType]}`}
            >
              {typeLabel[sheet.detectedType]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {sheet.rowCount} rows · {sheet.headers.length} columns
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs">
          {sheet.rowCount} rows
        </Badge>
      </button>
    );

    return (
      <div className="space-y-4 max-w-2xl">
        {/* Event name */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Event Details</CardTitle>
            <CardDescription>
              A new event will be created with this name
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="event-name">Event Name *</Label>
              <Input
                id="event-name"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="Peoria Ford Dec 2025"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dealer-name">Dealer Name</Label>
              <Input
                id="dealer-name"
                value={dealerName}
                onChange={(e) => setDealerName(e.target.value)}
                placeholder="Peoria Ford"
              />
            </div>
          </CardContent>
        </Card>

        {/* Sheet selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Sheets to Import
            </CardTitle>
            <CardDescription>
              {fileName} — {importableSheets.length} importable sheet(s) detected.
              Uncheck any you don&apos;t want to import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Importable sheets (always visible) */}
            {importableSheets.map((sheet, i) => renderSheetRow(sheet, i))}

            {/* Unknown sheets (collapsed by default) */}
            {unknownSheets.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowUnknown((v) => !v)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${showUnknown ? "rotate-0" : "-rotate-90"}`}
                  />
                  {unknownSheets.length} unrecognized sheet(s) — click to{" "}
                  {showUnknown ? "hide" : "show"}
                </button>
                {showUnknown && (
                  <div className="space-y-2 mt-2">
                    {unknownSheets.map((sheet, i) => renderSheetRow(sheet, i))}
                  </div>
                )}
              </div>
            )}

            {selectedSheets.length > 0 && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3 mt-3">
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  <strong>{selectedSheets.length} sheet(s) selected</strong> —{" "}
                  {totalRows.toLocaleString()} total rows will be imported into a
                  new event.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setStep("upload")}>
            Choose Different File
          </Button>
          <Button
            onClick={handleImport}
            disabled={!eventName.trim() || selectedSheets.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Create Event &amp; Import {totalRows.toLocaleString()} Rows
          </Button>
        </div>
      </div>
    );
  }

  // ── Importing step ──
  if (step === "importing") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
          <p className="text-lg font-medium">Setting Up Event...</p>
          <p className="text-sm text-muted-foreground mt-1">{importProgress}</p>
        </CardContent>
      </Card>
    );
  }

  // ── Done step ──
  if (step === "done" && summary) {
    const total = summary.inventory + summary.deals + summary.roster + summary.campaigns;
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          {summary.errors.length === 0 ? (
            <CheckCircle2 className="h-16 w-16 text-green-600 mb-4" />
          ) : (
            <AlertTriangle className="h-16 w-16 text-amber-500 mb-4" />
          )}
          <h2 className="text-2xl font-bold mb-2">
            &ldquo;{summary.eventName}&rdquo; Created
          </h2>
          <p className="text-muted-foreground mb-4">
            {total.toLocaleString()} records imported across{" "}
            {[
              summary.inventory > 0 && "inventory",
              summary.deals > 0 && "deals",
              summary.roster > 0 && "roster",
              summary.campaigns > 0 && "campaigns",
            ]
              .filter(Boolean)
              .join(", ")}
          </p>

          <div className="flex flex-wrap justify-center gap-3 mb-6">
            {summary.inventory > 0 && (
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-sm px-3 py-1">
                {summary.inventory} vehicles
              </Badge>
            )}
            {summary.deals > 0 && (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm px-3 py-1">
                {summary.deals} deals
              </Badge>
            )}
            {summary.roster > 0 && (
              <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 text-sm px-3 py-1">
                {summary.roster} roster members
              </Badge>
            )}
            {summary.campaigns > 0 && (
              <Badge className="bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200 text-sm px-3 py-1">
                {summary.campaigns} zip codes
              </Badge>
            )}
          </div>

          {summary.errors.length > 0 && (
            <div className="w-full max-w-lg mb-6 rounded-md border p-4 text-xs space-y-1">
              {summary.errors.map((e, i) => (
                <p key={i} className="text-amber-600">{e}</p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={() => router.push("/dashboard")}>
              Go to Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep("upload");
                setSheets([]);
                setEventName("");
                setDealerName("");
                setSummary(null);
              }}
            >
              Import Another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
