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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  parseSpreadsheet,
  executeImport,
  executeRosterImport,
  type ParsedSheet,
  type ImportResult,
} from "@/lib/actions/import-vehicles";
import { bulkImportDeals, bulkImportLenders } from "@/lib/actions/legacy-import";
import {
  type TabType,
  detectTabType,
  getFieldsForType,
  getMapperForType,
} from "@/lib/utils/column-mapping";
import { useSheetPush } from "@/hooks/useSheetPush";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

type WizardStep = "upload" | "analyze" | "map" | "importing" | "done";

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
}

// Tab type → Google Sheet tab name mapping
const SHEET_TITLE_MAP: Record<string, string> = {
  inventory: "Inventory",
  roster: "Roster & Tables",
  deals: "Deal Log",
  lenders: "Lenders",
};

// Tab type badge colors
const TAB_TYPE_COLORS: Record<TabType, string> = {
  inventory: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  roster: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deals: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  lenders: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
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
  const [activeMapTab, setActiveMapTab] = useState<string>("0");

  // ── Upload handler ──────────────────────────────────────

  const handleFile = useCallback(
    async (file: File) => {
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

        // Auto-detect tab types and build column maps
        const configs: SheetConfig[] = result.sheets.map((sheet) => {
          const tabType = detectTabType(sheet.name);
          const mapper = getMapperForType(tabType);
          const columnMap: Record<string, string> = {};

          for (const header of sheet.headers) {
            columnMap[header] = mapper(header);
          }

          return {
            sheet,
            tabType,
            enabled: tabType !== "unknown",
            columnMap,
            importStatus: "pending" as const,
          };
        });

        setSheets(configs);
        setStep("analyze");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to parse spreadsheet",
        );
      } finally {
        setParsing(false);
      }
    },
    [],
  );

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

  // ── Tab type change ─────────────────────────────────────

  const handleTabTypeChange = useCallback(
    (sheetIndex: number, newType: TabType) => {
      setSheets((prev) =>
        prev.map((s, i) => {
          if (i !== sheetIndex) return s;

          // Re-run auto-mapper for the new type
          const mapper = getMapperForType(newType);
          const columnMap: Record<string, string> = {};
          for (const header of s.sheet.headers) {
            columnMap[header] = mapper(header);
          }

          return {
            ...s,
            tabType: newType,
            columnMap,
            enabled: newType !== "unknown",
          };
        }),
      );
    },
    [],
  );

  // ── Column map change ───────────────────────────────────

  const handleColumnMapChange = useCallback(
    (sheetIndex: number, header: string, dbField: string) => {
      setSheets((prev) =>
        prev.map((s, i) =>
          i !== sheetIndex
            ? s
            : { ...s, columnMap: { ...s.columnMap, [header]: dbField } },
        ),
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

  // ── Import handler ──────────────────────────────────────

  const runImport = useCallback(async () => {
    setStep("importing");

    const enabledSheets = sheets
      .map((s, i) => ({ ...s, originalIndex: i }))
      .filter((s) => s.enabled && s.tabType !== "unknown");

    for (const config of enabledSheets) {
      // Mark as importing
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
        const errMsg =
          err instanceof Error ? err.message : "Import failed";
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

    setStep("done");
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

      // Build rows for the sheet push (mapped values)
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
        {
          action: "append_batch",
          sheetTitle,
          rows: mappedRows,
        },
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
    setActiveMapTab("0");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Helpers ─────────────────────────────────────────────

  const enabledSheets = sheets.filter((s) => s.enabled && s.tabType !== "unknown");
  const mappedCount = (config: SheetConfig) =>
    Object.values(config.columnMap).filter((v) => v && v !== "__skip__").length;

  // ────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Upload Old Spreadsheet
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Upload ─────────────────────────────── */}
        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a multi-tab <strong>.xlsx</strong> spreadsheet from a
              previous event. The system will auto-detect tabs (Inventory,
              Roster, Deal Log, Lenders) and map columns for you.
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

        {/* ── Step 2: Analyze Tabs ───────────────────────── */}
        {step === "analyze" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong>{fileName}</strong> — {sheets.length} tab
              {sheets.length !== 1 ? "s" : ""} detected. Review the auto-detected
              types below and adjust if needed.
            </p>

            <div className="space-y-3">
              {sheets.map((config, idx) => (
                <Card key={idx} className={!config.enabled ? "opacity-50" : ""}>
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
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
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
                            <SelectItem value="unknown">Skip</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardHeader>
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
                  setActiveMapTab("0");
                  setStep("map");
                }}
              >
                Continue
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Map Columns ────────────────────────── */}
        {step === "map" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Map spreadsheet columns to database fields for each tab. Unmapped
              columns will be skipped.
            </p>

            <Tabs
              value={activeMapTab}
              onValueChange={setActiveMapTab}
            >
              <TabsList className="w-full justify-start overflow-x-auto">
                {enabledSheets.map((config, idx) => (
                  <TabsTrigger key={idx} value={String(idx)} className="text-xs">
                    {config.sheet.name}
                    <Badge
                      variant="secondary"
                      className="ml-1.5 text-[10px] px-1.5 py-0"
                    >
                      {mappedCount(config)}/{config.sheet.headers.length}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>

              {enabledSheets.map((config, tabIdx) => {
                const fields = getFieldsForType(config.tabType);
                const originalIndex = sheets.indexOf(config);

                return (
                  <TabsContent
                    key={tabIdx}
                    value={String(tabIdx)}
                    className="space-y-4"
                  >
                    {/* Column mapping grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {config.sheet.headers.map((header) => (
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
                            value={config.columnMap[header] ?? "__skip__"}
                            onValueChange={(val) =>
                              handleColumnMapChange(originalIndex, header, val)
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
                      ))}
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
                              {config.sheet.rows.slice(0, 3).map((row, ri) => (
                                <TableRow key={ri}>
                                  {config.sheet.headers.map((h) => (
                                    <TableCell
                                      key={h}
                                      className="text-xs whitespace-nowrap px-2 py-1 max-w-[200px] truncate"
                                    >
                                      {String(
                                        (row as Record<string, unknown>)[h] ??
                                          "",
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
                  </TabsContent>
                );
              })}
            </Tabs>

            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("analyze")}>
                Back
              </Button>
              <Button onClick={runImport}>
                Import All ({enabledSheets.length} tab
                {enabledSheets.length !== 1 ? "s" : ""})
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Importing ──────────────────────────── */}
        {step === "importing" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Importing data into the event...
            </p>
            <div className="space-y-2">
              {sheets
                .filter((s) => s.enabled && s.tabType !== "unknown")
                .map((config, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
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
                    <div className="flex-1">
                      <span className="text-sm font-medium">
                        {config.sheet.name}
                      </span>
                      <Badge
                        className={`ml-2 text-[10px] ${TAB_TYPE_COLORS[config.tabType]}`}
                      >
                        {config.tabType}
                      </Badge>
                    </div>
                    {config.result && (
                      <span className="text-xs text-muted-foreground">
                        {config.result.imported} imported
                        {config.result.errors > 0 &&
                          ` · ${config.result.errors} errors`}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ── Step 5: Done ───────────────────────────────── */}
        {step === "done" && (
          <div className="space-y-4">
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
                            {config.importStatus === "done" ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
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
                                onClick={() => handlePushToSheet(originalIndex)}
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
                            <span>
                              <strong>{config.result.imported}</strong> imported
                            </span>
                            {config.result.duplicatesSkipped > 0 && (
                              <span>
                                <strong>{config.result.duplicatesSkipped}</strong>{" "}
                                duplicates skipped
                              </span>
                            )}
                            {config.result.errors > 0 && (
                              <span className="text-red-600 dark:text-red-400">
                                <strong>{config.result.errors}</strong> errors
                              </span>
                            )}
                          </div>
                          {config.result.errorDetails.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {config.result.errorDetails.slice(0, 5).map((e, ei) => (
                                <p key={ei} className="text-red-600 dark:text-red-400">
                                  Row {e.row}: {e.message}
                                </p>
                              ))}
                              {config.result.errorDetails.length > 5 && (
                                <p className="text-red-600 dark:text-red-400">
                                  ...and {config.result.errorDetails.length - 5} more
                                  errors
                                </p>
                              )}
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
            </div>

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
}: {
  eventId: string;
  sheetId: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1" />
        Upload Old Spreadsheet
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
