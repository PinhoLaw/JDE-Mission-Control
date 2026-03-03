"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  parseSpreadsheet,
  executeImport,
  executeRosterImport,
  type ParsedSheet,
  type ImportResult,
} from "@/lib/actions/import-vehicles";
import {
  bulkImportDeals,
  bulkImportLenders,
  bulkImportMailTracking,
} from "@/lib/actions/legacy-import";
import {
  type TabType,
  detectTabType,
  detectTabTypeFromHeaders,
  computeMappingConfidence,
  type MappingConfidence,
  getFieldsForType,
  getMapperForType,
} from "@/lib/utils/column-mapping";
import {
  validateBeforeImport,
  formatSkipSummary,
  type ValidationPreview,
} from "@/lib/utils/import-validation-preview";
import { useSheetPush } from "@/hooks/useSheetPush";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

type WizardStep = "upload" | "review" | "results";

interface SheetConfig {
  sheet: ParsedSheet;
  tabType: TabType;
  enabled: boolean;
  columnMap: Record<string, string>;
  /** Result after import completes */
  result?: ImportResult;
  /** Import status */
  importStatus: "pending" | "importing" | "done" | "error";
  /** Push status for Google Sheets */
  pushStatus?: "pending" | "pushing" | "done" | "error";
  /** Confidence score for auto-mapping */
  confidence: MappingConfidence;
  /** Pre-import validation preview */
  validationPreview?: ValidationPreview;
  /** Whether mapping section is expanded */
  isExpanded: boolean;
  /** How tab type was determined */
  detectionMethod: "name" | "headers" | "manual";
}

// Tab type → Google Sheet tab name mapping
const SHEET_TITLE_MAP: Record<string, string> = {
  inventory: "Inventory",
  roster: "Roster & Tables",
  deals: "Deal Log",
  lenders: "Lenders",
  campaigns: "Mail Tracking",
};

// Tab type badge colors
const TAB_TYPE_COLORS: Record<TabType, string> = {
  inventory:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  roster:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deals:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  lenders:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  campaigns:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  unknown: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
};

// ────────────────────────────────────────────────────────
// LegacySpreadsheetUpload Component
// ────────────────────────────────────────────────────────

function LegacySpreadsheetUpload({
  eventId,
  sheetId,
  open,
  onOpenChange,
}: {
  eventId: string;
  sheetId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { push } = useSheetPush();

  const [step, setStep] = useState<WizardStep>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [sheets, setSheets] = useState<SheetConfig[]>([]);
  const [parsing, setParsing] = useState(false);

  // ── Upload handler ──────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    setFileName(file.name);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await parseSpreadsheet(formData);

      if (!result.sheets || result.sheets.length === 0) {
        toast.error("No readable sheets found in the file");
        setParsing(false);
        return;
      }

      // Auto-detect tab types, build column maps, compute confidence + validation
      const configs: SheetConfig[] = result.sheets.map((sheet) => {
        // Step 1: Detect tab type (name first, headers as fallback)
        let tabType = detectTabType(sheet.name);
        let detectionMethod: "name" | "headers" | "manual" = "name";

        if (tabType === "unknown") {
          const headerDetection = detectTabTypeFromHeaders(sheet.headers);
          tabType = headerDetection.tabType;
          detectionMethod = tabType !== "unknown" ? "headers" : "manual";
        }

        // Step 2: Auto-map columns
        const mapper = getMapperForType(tabType);
        const columnMap: Record<string, string> = {};
        for (const header of sheet.headers) {
          columnMap[header] = mapper(header);
        }

        // Step 3: Compute confidence
        const confidence = computeMappingConfidence(columnMap, tabType);

        // Step 4: Run validation preview
        const validationPreview =
          tabType !== "unknown"
            ? validateBeforeImport(
                sheet.rows as Record<string, unknown>[],
                columnMap,
                tabType,
              )
            : undefined;

        return {
          sheet,
          tabType,
          enabled: tabType !== "unknown",
          columnMap,
          importStatus: "pending" as const,
          confidence,
          validationPreview,
          isExpanded: !confidence.autoReady, // Collapsed for high-confidence
          detectionMethod,
        };
      });

      setSheets(configs);
      setStep("review"); // Skip directly to review
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to parse spreadsheet",
      );
    } finally {
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  // ── Tab type change (recomputes mapping, confidence, validation) ──

  const handleTabTypeChange = useCallback(
    (sheetIndex: number, newType: TabType) => {
      setSheets((prev) =>
        prev.map((s, i) => {
          if (i !== sheetIndex) return s;

          const mapper = getMapperForType(newType);
          const columnMap: Record<string, string> = {};
          for (const header of s.sheet.headers) {
            columnMap[header] = mapper(header);
          }

          const confidence = computeMappingConfidence(columnMap, newType);
          const validationPreview =
            newType !== "unknown"
              ? validateBeforeImport(
                  s.sheet.rows as Record<string, unknown>[],
                  columnMap,
                  newType,
                )
              : undefined;

          return {
            ...s,
            tabType: newType,
            columnMap,
            enabled: newType !== "unknown",
            confidence,
            validationPreview,
            isExpanded: !confidence.autoReady,
            detectionMethod: "manual" as const,
          };
        }),
      );
    },
    [],
  );

  // ── Column map change (recomputes confidence + validation) ──

  const handleColumnMapChange = useCallback(
    (sheetIndex: number, header: string, dbField: string) => {
      setSheets((prev) =>
        prev.map((s, i) => {
          if (i !== sheetIndex) return s;

          const newMap = { ...s.columnMap, [header]: dbField };
          const confidence = computeMappingConfidence(newMap, s.tabType);
          const validationPreview =
            s.tabType !== "unknown"
              ? validateBeforeImport(
                  s.sheet.rows as Record<string, unknown>[],
                  newMap,
                  s.tabType,
                )
              : undefined;

          return { ...s, columnMap: newMap, confidence, validationPreview };
        }),
      );
    },
    [],
  );

  // ── Toggle sheet enabled ────────────────────────────────

  const toggleSheet = useCallback((sheetIndex: number, enabled: boolean) => {
    setSheets((prev) =>
      prev.map((s, i) => (i !== sheetIndex ? s : { ...s, enabled })),
    );
  }, []);

  // ── Toggle expanded state ──────────────────────────────

  const toggleExpanded = useCallback((sheetIndex: number) => {
    setSheets((prev) =>
      prev.map((s, i) =>
        i !== sheetIndex ? s : { ...s, isExpanded: !s.isExpanded },
      ),
    );
  }, []);

  // ── Import handler ──────────────────────────────────────

  const runImport = useCallback(async () => {
    setStep("results");

    const enabledSheets = sheets
      .map((s, i) => ({ ...s, originalIndex: i }))
      .filter((s) => s.enabled && s.tabType !== "unknown");

    for (const config of enabledSheets) {
      setSheets((prev) =>
        prev.map((s, i) =>
          i !== config.originalIndex
            ? s
            : { ...s, importStatus: "importing" as const },
        ),
      );

      try {
        let result: ImportResult;
        const rows = config.sheet.rows as Record<string, string>[];

        switch (config.tabType) {
          case "inventory":
            result = await executeImport(
              rows,
              config.columnMap,
              eventId,
              "append",
            );
            break;
          case "roster":
            result = await executeRosterImport(
              rows,
              config.columnMap,
              eventId,
              "append",
            );
            break;
          case "deals":
            result = await bulkImportDeals(rows, config.columnMap, eventId);
            break;
          case "lenders":
            result = await bulkImportLenders(rows, config.columnMap, eventId);
            break;
          case "campaigns":
            result = await bulkImportMailTracking(
              rows,
              config.columnMap,
              eventId,
            );
            break;
          default:
            continue;
        }

        setSheets((prev) =>
          prev.map((s, i) =>
            i !== config.originalIndex
              ? s
              : { ...s, importStatus: "done" as const, result },
          ),
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Import failed";
        setSheets((prev) =>
          prev.map((s, i) =>
            i !== config.originalIndex
              ? s
              : {
                  ...s,
                  importStatus: "error" as const,
                  result: {
                    success: false,
                    imported: 0,
                    deleted: 0,
                    errors: 1,
                    duplicatesSkipped: 0,
                    errorDetails: [{ row: 0, message: errMsg }],
                    mode: "append" as const,
                  },
                },
          ),
        );
      }
    }
  }, [sheets, eventId]);

  // ── Sheet push handler ──────────────────────────────────

  const handlePushToSheet = useCallback(
    async (sheetIndex: number) => {
      const config = sheets[sheetIndex];
      if (!config || !config.result || !sheetId) return;

      setSheets((prev) =>
        prev.map((s, i) =>
          i !== sheetIndex ? s : { ...s, pushStatus: "pushing" as const },
        ),
      );

      const sheetTitle = SHEET_TITLE_MAP[config.tabType] ?? config.sheet.name;
      const mappedRows = config.sheet.rows.map((raw) => {
        const row: Record<string, unknown> = {};
        for (const [header, dbField] of Object.entries(config.columnMap)) {
          if (dbField && dbField !== "__skip__") {
            row[dbField] = (raw as Record<string, unknown>)[header] ?? null;
          }
        }
        return row;
      });

      const pushResult = await push(
        { action: "append_batch", sheetTitle, rows: mappedRows },
        {
          successMessage: `Pushed ${config.tabType} to Google Sheet`,
          errorMessage: `Failed to push ${config.tabType}`,
        },
      );

      setSheets((prev) =>
        prev.map((s, i) =>
          i !== sheetIndex
            ? s
            : {
                ...s,
                pushStatus: pushResult.success
                  ? ("done" as const)
                  : ("error" as const),
              },
        ),
      );
    },
    [sheets, sheetId, push],
  );

  const handlePushAll = useCallback(async () => {
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      if (s.enabled && s.result && s.result.imported > 0) {
        await handlePushToSheet(i);
      }
    }
  }, [sheets, handlePushToSheet]);

  // ── Reset ───────────────────────────────────────────────

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setSheets([]);
    setParsing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Computed helpers ────────────────────────────────────

  const enabledSheets = sheets.filter(
    (s) => s.enabled && s.tabType !== "unknown",
  );
  const totalImportable = enabledSheets.reduce(
    (sum, s) => sum + (s.validationPreview?.importableRows ?? s.sheet.rowCount),
    0,
  );
  const allDone = enabledSheets.every(
    (s) => s.importStatus === "done" || s.importStatus === "error",
  );
  const totalImported = enabledSheets.reduce(
    (sum, s) => sum + (s.result?.imported ?? 0),
    0,
  );

  // ────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload Spreadsheet
          </DialogTitle>
        </DialogHeader>

        {/* ══════════════════════════════════════════════════ */}
        {/* Step 1: Upload                                    */}
        {/* ══════════════════════════════════════════════════ */}
        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a multi-tab <strong>.xlsx</strong> spreadsheet. The system
              will auto-detect tabs (Inventory, Roster, Deal Log, Lenders,
              Campaigns) and map columns for you.
            </p>
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {parsing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Parsing {fileName}...
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="font-medium">
                    Drop an .xlsx file here or click to browse
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Supports multi-tab Excel files
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/* Step 2: Review (combines analyze + map + preview)  */}
        {/* ══════════════════════════════════════════════════ */}
        {step === "review" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong>{fileName}</strong> — {sheets.length} tab
              {sheets.length !== 1 ? "s" : ""} detected.
              {enabledSheets.every((s) => s.confidence.autoReady)
                ? " All tabs auto-mapped with high confidence. Ready to import!"
                : " Review flagged tabs below, then import."}
            </p>

            <div className="space-y-3">
              {sheets.map((config, idx) => (
                <Card
                  key={idx}
                  className={!config.enabled ? "opacity-50" : ""}
                >
                  {/* ── Card Header: name, stats, badges, type selector ── */}
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={config.enabled}
                          onCheckedChange={(checked) =>
                            toggleSheet(idx, !!checked)
                          }
                        />
                        <div>
                          <CardTitle className="text-sm font-medium">
                            {config.sheet.name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {config.sheet.rowCount} rows ·{" "}
                            {config.sheet.headers.length} columns
                            {config.confidence.score > 0 &&
                              ` · ${config.confidence.score}% mapped`}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Confidence badge */}
                        {config.tabType !== "unknown" && (
                          <Badge
                            className={
                              config.confidence.autoReady
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                            }
                          >
                            {config.confidence.autoReady
                              ? "Auto-Mapped ✓"
                              : "Needs Review"}
                          </Badge>
                        )}
                        {/* Tab type badge */}
                        <Badge className={TAB_TYPE_COLORS[config.tabType]}>
                          {config.tabType === "unknown"
                            ? "Unknown"
                            : config.tabType.charAt(0).toUpperCase() +
                              config.tabType.slice(1)}
                        </Badge>
                        <Select
                          value={config.tabType}
                          onValueChange={(val) =>
                            handleTabTypeChange(idx, val as TabType)
                          }
                        >
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inventory">Inventory</SelectItem>
                            <SelectItem value="roster">Roster</SelectItem>
                            <SelectItem value="deals">Deals</SelectItem>
                            <SelectItem value="lenders">Lenders</SelectItem>
                            <SelectItem value="campaigns">Campaigns</SelectItem>
                            <SelectItem value="unknown">Skip</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardHeader>

                  {/* ── Card Content (only for enabled, known tabs) ── */}
                  {config.enabled && config.tabType !== "unknown" && (
                    <CardContent className="py-2 px-4 space-y-3">
                      {/* Validation Preview */}
                      {config.validationPreview && (
                        <div className="rounded-md border p-3 bg-muted/30">
                          <div className="flex gap-4 text-xs">
                            <span className="text-green-700 dark:text-green-400 font-medium">
                              {config.validationPreview.importableRows}{" "}
                              {config.tabType} ready to import
                            </span>
                            {config.validationPreview.skippedRows.length >
                              0 && (
                              <span className="text-amber-700 dark:text-amber-400">
                                {config.validationPreview.skippedRows.length}{" "}
                                rows will be skipped
                              </span>
                            )}
                          </div>
                          {config.validationPreview.skippedRows.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatSkipSummary(
                                config.validationPreview.skipSummary,
                              )}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Missing required fields warning */}
                      {!config.confidence.requiredFieldsMapped && (
                        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-2">
                          <p className="text-xs text-red-700 dark:text-red-400">
                            Missing required:{" "}
                            {config.confidence.missingRequired.join(", ")}
                          </p>
                        </div>
                      )}

                      {/* Expandable Column Mapping */}
                      <div>
                        <button
                          onClick={() => toggleExpanded(idx)}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {config.isExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          Column Mapping ({config.confidence.mappedCount}/
                          {config.confidence.totalColumns})
                        </button>

                        {config.isExpanded && (
                          <div className="mt-2 space-y-3">
                            {/* Mapping grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {config.sheet.headers.map((header) => {
                                const fields = getFieldsForType(
                                  config.tabType,
                                );
                                return (
                                  <div
                                    key={header}
                                    className="flex items-center gap-2 rounded-md border p-2"
                                  >
                                    <span
                                      className="text-xs font-medium truncate min-w-0 flex-1"
                                      title={header}
                                    >
                                      {header}
                                    </span>
                                    <Select
                                      value={
                                        config.columnMap[header] ?? "__skip__"
                                      }
                                      onValueChange={(val) =>
                                        handleColumnMapChange(idx, header, val)
                                      }
                                    >
                                      <SelectTrigger className="w-[160px] h-7 text-xs flex-shrink-0">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {fields.map((f) => (
                                          <SelectItem
                                            key={f.value}
                                            value={f.value}
                                            className="text-xs"
                                          >
                                            {f.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                );
                              })}
                            </div>

                            {/* 3-row data preview */}
                            {config.sheet.rows.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  Data Preview (first 3 rows)
                                </p>
                                <div className="border rounded-md overflow-x-auto">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        {config.sheet.headers.map((h) => (
                                          <TableHead
                                            key={h}
                                            className="text-xs whitespace-nowrap px-2 py-1"
                                          >
                                            {h}
                                          </TableHead>
                                        ))}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {config.sheet.rows
                                        .slice(0, 3)
                                        .map((row, ri) => (
                                          <TableRow key={ri}>
                                            {config.sheet.headers.map((h) => (
                                              <TableCell
                                                key={h}
                                                className="text-xs whitespace-nowrap px-2 py-1 max-w-[200px] truncate"
                                              >
                                                {String(
                                                  (
                                                    row as Record<
                                                      string,
                                                      unknown
                                                    >
                                                  )[h] ?? "",
                                                )}
                                              </TableCell>
                                            ))}
                                          </TableRow>
                                        ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button
                onClick={() => {
                  if (enabledSheets.length === 0) {
                    toast.error("Enable at least one tab to continue");
                    return;
                  }
                  runImport();
                }}
              >
                Import All ({totalImportable} rows across{" "}
                {enabledSheets.length} tab
                {enabledSheets.length !== 1 ? "s" : ""})
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/* Step 3: Results (importing + done in one view)     */}
        {/* ══════════════════════════════════════════════════ */}
        {step === "results" && (
          <div className="space-y-4">
            {/* Completion banner */}
            {allDone && (
              <div className="rounded-md border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 p-3">
                <p className="text-sm font-medium text-green-800 dark:text-green-400">
                  Import Complete — {totalImported} records imported across{" "}
                  {enabledSheets.filter((s) => s.importStatus === "done").length}{" "}
                  tabs
                </p>
              </div>
            )}

            {!allDone && (
              <p className="text-sm text-muted-foreground">
                Importing data into the event...
              </p>
            )}

            <div className="space-y-3">
              {sheets
                .filter((s) => s.enabled && s.tabType !== "unknown")
                .map((config, idx) => {
                  const originalIndex = sheets.indexOf(config);
                  return (
                    <Card key={idx}>
                      <CardHeader className="py-3 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {config.importStatus === "pending" && (
                              <Circle className="h-4 w-4 text-muted-foreground" />
                            )}
                            {config.importStatus === "importing" && (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            )}
                            {config.importStatus === "done" && (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            )}
                            {config.importStatus === "error" && (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                            <CardTitle className="text-sm font-medium">
                              {config.sheet.name}
                            </CardTitle>
                            <Badge
                              className={`text-[10px] ${TAB_TYPE_COLORS[config.tabType]}`}
                            >
                              {config.tabType}
                            </Badge>
                          </div>
                          {/* Push to Sheet button */}
                          {sheetId &&
                            config.result &&
                            config.result.imported > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={
                                  config.pushStatus === "pushing" ||
                                  config.pushStatus === "done"
                                }
                                onClick={() =>
                                  handlePushToSheet(originalIndex)
                                }
                              >
                                {config.pushStatus === "pushing" && (
                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                )}
                                {config.pushStatus === "done" && (
                                  <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />
                                )}
                                {config.pushStatus === "error" && (
                                  <XCircle className="h-3 w-3 mr-1 text-red-600" />
                                )}
                                {config.pushStatus === "done"
                                  ? "Pushed"
                                  : config.pushStatus === "pushing"
                                    ? "Pushing..."
                                    : "Push to Sheet"}
                              </Button>
                            )}
                        </div>
                      </CardHeader>
                      {config.result && (
                        <CardContent className="py-2 px-4 text-xs text-muted-foreground">
                          <div className="flex gap-4">
                            <span className="text-green-700 dark:text-green-400">
                              <strong>{config.result.imported}</strong> imported
                            </span>
                            {config.result.duplicatesSkipped > 0 && (
                              <span className="text-amber-700 dark:text-amber-400">
                                <strong>
                                  {config.result.duplicatesSkipped}
                                </strong>{" "}
                                skipped
                              </span>
                            )}
                            {config.result.errors > 0 && (
                              <span className="text-red-600 dark:text-red-400">
                                <strong>{config.result.errors}</strong> errors
                              </span>
                            )}
                          </div>
                          {/* Skip breakdown (if available) */}
                          {config.result.skipBreakdown && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[
                                config.result.skipBreakdown.emptyRows > 0 &&
                                  `${config.result.skipBreakdown.emptyRows} empty`,
                                config.result.skipBreakdown.fluffRows > 0 &&
                                  `${config.result.skipBreakdown.fluffRows} notes`,
                                config.result.skipBreakdown.duplicates > 0 &&
                                  `${config.result.skipBreakdown.duplicates} duplicates`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                          {/* Expandable error details */}
                          {config.result.errorDetails.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs cursor-pointer text-red-600 dark:text-red-400 hover:underline">
                                View {config.result.errorDetails.length} error
                                details
                              </summary>
                              <div className="mt-1 space-y-0.5">
                                {config.result.errorDetails
                                  .slice(0, 10)
                                  .map((e, ei) => (
                                    <p
                                      key={ei}
                                      className="text-red-600 dark:text-red-400"
                                    >
                                      Row {e.row}: {e.message}
                                    </p>
                                  ))}
                                {config.result.errorDetails.length > 10 && (
                                  <p className="text-red-600 dark:text-red-400">
                                    ...and{" "}
                                    {config.result.errorDetails.length - 10}{" "}
                                    more errors
                                  </p>
                                )}
                              </div>
                            </details>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
            </div>

            {allDone && (
              <div className="flex justify-between pt-2">
                {sheetId && (
                  <Button
                    variant="outline"
                    onClick={handlePushAll}
                    disabled={sheets.every(
                      (s) =>
                        !s.enabled ||
                        !s.result ||
                        s.result.imported === 0 ||
                        s.pushStatus === "done",
                    )}
                  >
                    Push All to Google Sheet
                  </Button>
                )}
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={reset}>
                    Import Another
                  </Button>
                  <Button onClick={() => onOpenChange(false)}>Close</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────
// LegacyUploadButton (exported for use in server components)
// ────────────────────────────────────────────────────────

export function LegacyUploadButton({
  eventId,
  sheetId,
  size = "sm",
  variant = "outline",
  label = "Upload Spreadsheet",
}: {
  eventId: string;
  sheetId: string | null;
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1" />
        {label}
      </Button>
      <LegacySpreadsheetUpload
        eventId={eventId}
        sheetId={sheetId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
