"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEvent } from "@/providers/event-provider";
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
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Replace,
  ListPlus,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  parseSpreadsheet,
  validateImportRows,
  executeImport,
  executeRosterImport,
  type ParsedSheet,
  type ImportValidationResult,
  type ImportResult,
  type ImportMode,
} from "@/lib/actions/import-vehicles";

// DB fields the user can map to
const DB_FIELDS = [
  { value: "__skip__", label: "— Skip —" },
  { value: "hat_number", label: "Hat #" },
  { value: "stock_number", label: "Stock #" },
  { value: "vin", label: "VIN" },
  { value: "year", label: "Year" },
  { value: "make", label: "Make" },
  { value: "model", label: "Model" },
  { value: "trim", label: "Trim" },
  { value: "body_style", label: "Body Style" },
  { value: "color", label: "Color" },
  { value: "mileage", label: "Mileage" },
  { value: "age_days", label: "Age (days)" },
  { value: "drivetrain", label: "Drivetrain" },
  { value: "acquisition_cost", label: "Acquisition Cost" },
  { value: "jd_trade_clean", label: "JD Trade Clean" },
  { value: "jd_retail_clean", label: "JD Retail Clean" },
  { value: "asking_price_115", label: "Ask 115%" },
  { value: "asking_price_120", label: "Ask 120%" },
  { value: "asking_price_125", label: "Ask 125%" },
  { value: "asking_price_130", label: "Ask 130%" },
  { value: "profit_115", label: "Profit 115%" },
  { value: "profit_120", label: "Profit 120%" },
  { value: "profit_125", label: "Profit 125%" },
  { value: "profit_130", label: "Profit 130%" },
  { value: "retail_spread", label: "Retail Spread" },
  { value: "label", label: "Label" },
  { value: "notes", label: "Notes" },
];

// Best-effort auto-mapping from header text to DB field
function autoMapColumn(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  // Exact matches (highest priority)
  const exactMap: Record<string, string> = {
    hat: "hat_number", hatnumber: "hat_number", hatno: "hat_number",
    stock: "stock_number", stocknumber: "stock_number", stockno: "stock_number",
    stk: "stock_number", stkno: "stock_number",
    vin: "vin", vin7: "__skip__", vinno: "vin", vinnumber: "vin",
    year: "year", yr: "year",
    make: "make",
    model: "model",
    trim: "trim", series: "trim", trimlevel: "trim",
    bodystyle: "body_style", body: "body_style", class: "body_style",
    bodytype: "body_style", style: "body_style",
    color: "color", ext: "color", extcolor: "color", exteriorcolor: "color",
    mileage: "mileage", miles: "mileage", odometer: "mileage", odo: "mileage",
    odometerreading: "mileage",
    type: "drivetrain",
    age: "age_days", agedays: "age_days", days: "age_days", ageday: "age_days",
    drivetrain: "drivetrain", drive: "drivetrain", drivetraintype: "drivetrain",
    drivetype: "drivetrain",
    cost: "acquisition_cost", acqcost: "acquisition_cost",
    acquisitioncost: "acquisition_cost", unitcost: "acquisition_cost",
    acvcost: "acquisition_cost", dealercost: "acquisition_cost",
    // JD Power fields (many spelling variations in spreadsheets)
    jdtradeclean: "jd_trade_clean", tradeclean: "jd_trade_clean",
    jdtrade: "jd_trade_clean", cleantrade: "jd_trade_clean",
    jdpowertradeinclean: "jd_trade_clean", jdpowertradeclean: "jd_trade_clean",
    tradein: "jd_trade_clean", tradeinclean: "jd_trade_clean",
    jdpowerretailclean: "jd_retail_clean", retailclean: "jd_retail_clean",
    jdretail: "jd_retail_clean", cleanretail: "jd_retail_clean",
    jdpowerretail: "jd_retail_clean", retail: "jd_retail_clean",
    // Asking price / percentage columns
    ask115: "asking_price_115", price115: "asking_price_115", "115": "asking_price_115",
    ask120: "asking_price_120", price120: "asking_price_120", "120": "asking_price_120",
    ask125: "asking_price_125", price125: "asking_price_125", "125": "asking_price_125",
    ask130: "asking_price_130", price130: "asking_price_130", "130": "asking_price_130",
    profit115: "profit_115", profit120: "profit_120",
    profit125: "profit_125", profit130: "profit_130",
    retailspread: "retail_spread", spread: "retail_spread", diff: "retail_spread",
    label: "label", status: "label", location: "__skip__",
    notes: "notes", note: "notes",
  };

  if (exactMap[h]) return exactMap[h];

  // Substring / fuzzy matches for common header variations
  const raw = header.toLowerCase().trim();
  if (raw.includes("stock") && (raw.includes("#") || raw.includes("no") || raw.includes("num"))) return "stock_number";
  if (raw.includes("stk") && (raw.includes("#") || raw.includes("no"))) return "stock_number";
  if (raw.includes("vin") && (raw.includes("#") || raw.includes("no"))) return "vin";
  if (raw.includes("unit") && raw.includes("cost")) return "acquisition_cost";
  if (raw.includes("acq") && raw.includes("cost")) return "acquisition_cost";
  if (raw.includes("dealer") && raw.includes("cost")) return "acquisition_cost";
  if (raw.includes("j.d.") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("j.d.") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("jd") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("jd") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("power") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("power") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("clean") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("clean") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("trade") && raw.includes("in") && raw.includes("clean")) return "jd_trade_clean";
  if (raw.includes("115") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_115";
  if (raw.includes("120") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_120";
  if (raw.includes("125") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_125";
  if (raw.includes("130") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_130";
  if (raw.includes("odometer")) return "mileage";
  if (raw.includes("ext") && raw.includes("color")) return "color";
  if (raw.includes("body") && (raw.includes("style") || raw.includes("type"))) return "body_style";
  if (raw.includes("age") && (raw.includes("day") || raw.includes("lot"))) return "age_days";
  if (raw.includes("trim") && raw.includes("level")) return "trim";

  return "__skip__";
}

// Roster DB fields
const ROSTER_DB_FIELDS = [
  { value: "__skip__", label: "— Skip —" },
  { value: "name", label: "Name" },
  { value: "phone", label: "Phone" },
  { value: "confirmed", label: "Confirmed?" },
  { value: "role", label: "Role" },
  { value: "setup", label: "Setup (notes)" },
  { value: "according_to", label: "According To (notes)" },
  { value: "lenders", label: "Lenders (notes)" },
  { value: "drivetrain", label: "Drivetrain (notes)" },
];

function autoMapRosterColumn(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    salespeople: "name", salesperson: "name", name: "name", sales: "name", people: "name",
    phone: "phone", cell: "phone", mobile: "phone", phonenumber: "phone",
    confirmed: "confirmed", confirm: "confirmed",
    setup: "setup",
    accordingto: "according_to", accordingtowho: "according_to",
    lenders: "lenders", lender: "lenders",
    drivetrain: "drivetrain", drive: "drivetrain",
    role: "role", position: "role", title: "role",
  };
  return map[h] ?? "__skip__";
}

// Detect if selected sheets include a roster sheet
function isRosterSheet(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("roster") || lower.includes("tables");
}

type ImportTarget = "inventory" | "roster";
type Step = "upload" | "sheets" | "map" | "preview" | "importing" | "done";

export default function ImportPage() {
  const { currentEvent } = useEvent();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [importMode, setImportMode] = useState<ImportMode>("replace");
  const [importTarget, setImportTarget] = useState<ImportTarget>("inventory");
  const [fileName, setFileName] = useState("");
  // All sheets from the file
  const [allSheets, setAllSheets] = useState<ParsedSheet[]>([]);
  const [selectedSheetIndices, setSelectedSheetIndices] = useState<Set<number>>(new Set());
  // Merged data from selected sheets
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [validationResults, setValidationResults] = useState<ImportValidationResult[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── File parsing (server-side via @protobi/exceljs) ──
  const [isParsing, setIsParsing] = useState(false);

  const parseFile = useCallback(async (file: File) => {
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const result = await parseSpreadsheet(formData);

      setFileName(result.fileName);
      setAllSheets(result.sheets);

      if (result.sheets.length === 1) {
        // Single sheet — skip sheet selection, go straight to mapping
        const sheet = result.sheets[0];
        setSelectedSheetIndices(new Set([0]));
        setHeaders(sheet.headers);
        setRawRows(sheet.rows);

        const isRoster = isRosterSheet(sheet.name);
        setImportTarget(isRoster ? "roster" : "inventory");

        const autoMap: Record<string, string> = {};
        const mapper = isRoster ? autoMapRosterColumn : autoMapColumn;
        for (const col of sheet.headers) {
          autoMap[col] = mapper(col);
        }
        setColumnMap(autoMap);

        const mapped = Object.entries(autoMap).filter(([, v]) => v !== "__skip__");
        const skipped = Object.entries(autoMap).filter(([, v]) => v === "__skip__");
        console.log(
          `[AUTO-MAP] ${mapped.length}/${sheet.headers.length} columns auto-mapped:`,
          mapped.map(([h, f]) => `"${h}" → ${f}`).join(", "),
        );
        if (skipped.length > 0) {
          console.log(
            `[AUTO-MAP] ${skipped.length} columns skipped:`,
            skipped.map(([h]) => `"${h}"`).join(", "),
          );
        }

        setStep("map");
        toast.success(`Loaded ${sheet.rowCount} rows from "${result.fileName}"`);
      } else {
        // Multiple sheets — show sheet selection step
        // Pre-select sheets that look like inventory
        const preselected = new Set<number>();
        result.sheets.forEach((s, i) => {
          const name = s.name.toLowerCase();
          if (name.includes("inventory") || name.includes("inv")) {
            preselected.add(i);
          }
        });
        setSelectedSheetIndices(preselected.size > 0 ? preselected : new Set([0]));
        setStep("sheets");
        toast.success(
          `Found ${result.sheets.length} sheets in "${result.fileName}" — select which to import`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setIsParsing(false);
    }
  }, []);

  // Merge selected sheets into combined headers + rows
  const applySheetSelection = useCallback(() => {
    const selected = allSheets.filter((_, i) => selectedSheetIndices.has(i));
    if (selected.length === 0) {
      toast.error("Select at least one sheet");
      return;
    }

    // Union of all headers (preserving order from first sheet, appending new ones)
    const headerSet = new Set<string>();
    const mergedHeaders: string[] = [];
    for (const sheet of selected) {
      for (const h of sheet.headers) {
        if (!headerSet.has(h)) {
          headerSet.add(h);
          mergedHeaders.push(h);
        }
      }
    }

    // Merge all rows (missing columns get null)
    const mergedRows: Record<string, unknown>[] = [];
    for (const sheet of selected) {
      const beforeCount = mergedRows.length;
      for (const row of sheet.rows) {
        const fullRow: Record<string, unknown> = {};
        for (const h of mergedHeaders) {
          fullRow[h] = row[h] ?? null;
        }
        mergedRows.push(fullRow);
      }
      const sheetAdded = mergedRows.length - beforeCount;
      console.log(`[MERGE] Sheet "${sheet.name}": ${sheet.rows.length} parsed rows → ${sheetAdded} added to merge (total now: ${mergedRows.length})`);
    }

    setHeaders(mergedHeaders);
    setRawRows(mergedRows);

    // Detect if this is a roster import or inventory import
    const hasRosterSheet = selected.some((s) => isRosterSheet(s.name));
    const hasInventorySheet = selected.some((s) => !isRosterSheet(s.name));
    const target: ImportTarget = hasRosterSheet && !hasInventorySheet ? "roster" : "inventory";
    setImportTarget(target);

    // Auto-map columns based on target
    const autoMap: Record<string, string> = {};
    const mapper = target === "roster" ? autoMapRosterColumn : autoMapColumn;
    for (const col of mergedHeaders) {
      autoMap[col] = mapper(col);
    }
    setColumnMap(autoMap);

    const mapped = Object.entries(autoMap).filter(([, v]) => v !== "__skip__");
    const skipped = Object.entries(autoMap).filter(([, v]) => v === "__skip__");
    console.log(
      `[AUTO-MAP] ${mapped.length}/${mergedHeaders.length} columns auto-mapped:`,
      mapped.map(([h, f]) => `"${h}" → ${f}`).join(", "),
    );
    if (skipped.length > 0) {
      console.log(
        `[AUTO-MAP] ${skipped.length} columns skipped:`,
        skipped.map(([h]) => `"${h}"`).join(", "),
      );
    }

    setStep("map");
    const sheetNames = selected.map((s) => s.name).join(", ");
    const targetLabel = target === "roster" ? " (Roster import)" : "";
    toast.success(`Merged ${mergedRows.length} rows from: ${sheetNames}${targetLabel}`);
  }, [allSheets, selectedSheetIndices]);

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

  // ── Sheet toggle helper ──
  const toggleSheet = useCallback((index: number) => {
    setSelectedSheetIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // ── Total rows from selected sheets ──
  const selectedRowCount = useMemo(() => {
    return allSheets
      .filter((_, i) => selectedSheetIndices.has(i))
      .reduce((sum, s) => sum + s.rowCount, 0);
  }, [allSheets, selectedSheetIndices]);

  // ── Validation (dry run) ──
  const handleValidate = useCallback(async () => {
    if (!currentEvent) return;
    setIsValidating(true);
    try {
      const results = await validateImportRows(rawRows, columnMap, currentEvent.id, importMode);
      setValidationResults(results);
      setStep("preview");

      const validCount = results.filter((r) => r.valid).length;
      const errorCount = results.filter((r) => !r.valid).length;
      if (errorCount > 0) {
        toast.warning(`${errorCount} row(s) have errors. ${validCount} valid.`);
      } else {
        toast.success(`All ${validCount} rows valid and ready to import!`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setIsValidating(false);
    }
  }, [currentEvent, rawRows, columnMap, importMode]);

  // ── Execute import ──
  const handleImport = useCallback(async () => {
    if (!currentEvent) return;
    setIsImporting(true);
    setStep("importing");
    try {
      const result = importTarget === "roster"
        ? await executeRosterImport(rawRows, columnMap, currentEvent.id, importMode)
        : await executeImport(rawRows, columnMap, currentEvent.id, importMode);
      setImportResult(result);
      setStep("done");

      const isRoster = importTarget === "roster";
      if (result.success) {
        const modeLabel = result.mode === "replace"
          ? `Replaced ${isRoster ? "roster" : "inventory"}: ${result.deleted} removed, ${result.imported} imported`
          : `Appended ${result.imported} ${isRoster ? "roster members" : "vehicles"}`;
        toast.success(modeLabel);
      } else {
        toast.warning(
          `Imported ${result.imported} ${isRoster ? "roster members" : "vehicles"}. ${result.errors} errors, ${result.duplicatesSkipped} duplicates skipped.`,
        );
      }

      // Force refresh the router cache so pages show fresh data
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
      setStep(importTarget === "roster" ? "map" : "preview");
    } finally {
      setIsImporting(false);
    }
  }, [currentEvent, rawRows, columnMap, importMode, importTarget, router]);

  const validCount = validationResults.filter((r) => r.valid).length;
  const errorCount = validationResults.filter((r) => !r.valid).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/dashboard/inventory">
            <ArrowLeft className="h-4 w-4" />
            Back to Inventory
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {importTarget === "roster" ? "Import Roster" : "Import Inventory"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload an Excel or CSV file to bulk-import {importTarget === "roster" ? "roster members" : "vehicles"} to{" "}
          <span className="font-medium">
            {currentEvent?.dealer_name ?? currentEvent?.name ?? "this event"}
          </span>
        </p>
      </div>

      {/* ── STEP 1: UPLOAD ── */}
      {step === "upload" && (
        <div className="space-y-4">
          {/* Import mode selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Import Mode</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => setImportMode("replace")}
                  className={`flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
                    importMode === "replace"
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-primary/30"
                  }`}
                >
                  <Replace className={`h-5 w-5 mt-0.5 shrink-0 ${importMode === "replace" ? "text-primary" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-semibold">Replace All</p>
                    <p className="text-xs text-muted-foreground">
                      Delete all existing inventory for this event, then import fresh. Best for updated spreadsheets.
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setImportMode("append")}
                  className={`flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
                    importMode === "append"
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-primary/30"
                  }`}
                >
                  <ListPlus className={`h-5 w-5 mt-0.5 shrink-0 ${importMode === "append" ? "text-primary" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-semibold">Append</p>
                    <p className="text-xs text-muted-foreground">
                      Add new vehicles without removing existing ones. Duplicates by stock # are skipped.
                    </p>
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload Spreadsheet</CardTitle>
              <CardDescription>
                Drag and drop an .xlsx or .csv file, or click to browse.
                Multi-sheet workbooks supported — you&apos;ll pick which sheets to import.
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
                    <p className="text-sm font-medium mb-1">
                      Parsing spreadsheet...
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Reading all sheets, columns, and rows
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
        </div>
      )}

      {/* ── STEP 1.5: SHEET SELECTION (multi-sheet files only) ── */}
      {step === "sheets" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Select Sheets to Import
            </CardTitle>
            <CardDescription>
              {fileName} has {allSheets.length} sheets with data.
              Select which ones contain inventory to import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {allSheets.map((sheet, i) => (
                <button
                  key={i}
                  onClick={() => toggleSheet(i)}
                  className={`w-full flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
                    selectedSheetIndices.has(i)
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-primary/20"
                  }`}
                >
                  <Checkbox
                    checked={selectedSheetIndices.has(i)}
                    onCheckedChange={() => toggleSheet(i)}
                    className="pointer-events-none"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{sheet.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {sheet.rowCount} rows · {sheet.headers.length} columns
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      Columns: {sheet.headers.slice(0, 8).join(", ")}
                      {sheet.headers.length > 8 ? `, +${sheet.headers.length - 8} more` : ""}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {sheet.rowCount} rows
                  </Badge>
                </button>
              ))}
            </div>

            {selectedSheetIndices.size > 0 && (
              <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3">
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  <strong>{selectedSheetIndices.size} sheet(s) selected</strong> —{" "}
                  {selectedRowCount} total rows will be merged and imported.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={applySheetSelection}
                disabled={selectedSheetIndices.size === 0}
              >
                Continue with {selectedSheetIndices.size} Sheet{selectedSheetIndices.size !== 1 ? "s" : ""} ({selectedRowCount} rows)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: COLUMN MAPPING ── */}
      {step === "map" && (() => {
        const autoMappedCount = Object.values(columnMap).filter((v) => v && v !== "__skip__").length;
        const totalCount = headers.length;
        return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Column Mapping
            </CardTitle>
            <CardDescription>
              {fileName} — {rawRows.length} rows detected. Map each spreadsheet
              column to a database field.
              <Badge variant="outline" className="ml-2">
                {importMode === "replace" ? "Replace mode" : "Append mode"}
              </Badge>
              {importTarget === "roster" && (
                <Badge variant="secondary" className="ml-2">Roster Import</Badge>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Auto-map summary */}
            <div className={`rounded-md border p-3 flex items-center gap-2 ${
              autoMappedCount > 0
                ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30"
                : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
            }`}>
              <CheckCircle2 className={`h-4 w-4 shrink-0 ${autoMappedCount > 0 ? "text-green-600" : "text-amber-600"}`} />
              <p className={`text-xs ${autoMappedCount > 0 ? "text-green-800 dark:text-green-200" : "text-amber-800 dark:text-amber-200"}`}>
                <strong>{autoMappedCount} of {totalCount} columns auto-mapped.</strong>
                {autoMappedCount < totalCount && (
                  <> Review the columns marked &quot;Skip&quot; and assign them if needed.</>
                )}
                {autoMappedCount === totalCount && (
                  <> All columns matched — review below and adjust if needed.</>
                )}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((header) => {
                const mapValue = columnMap[header] ?? "__skip__";
                const isMapped = mapValue !== "__skip__";
                return (
                <div key={header} className={`flex flex-col gap-1 rounded-md p-2 ${
                  isMapped
                    ? "bg-green-50/50 dark:bg-green-950/10 border border-green-200/50 dark:border-green-900/30"
                    : "bg-muted/30 border border-transparent"
                }`}>
                  <label className="text-xs font-medium text-muted-foreground truncate flex items-center gap-1">
                    {isMapped && <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />}
                    {header}
                  </label>
                  <Select
                    value={mapValue}
                    onValueChange={(val) =>
                      setColumnMap((prev) => ({ ...prev, [header]: val }))
                    }
                  >
                    <SelectTrigger className={`h-8 text-sm ${isMapped ? "border-green-300 dark:border-green-800" : ""}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(importTarget === "roster" ? ROSTER_DB_FIELDS : DB_FIELDS).map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                );
              })}
            </div>

            {/* Preview first 3 rows */}
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map((h) => (
                      <TableHead key={h} className="whitespace-nowrap text-xs">
                        {h}
                        <br />
                        <span className="text-[10px] text-muted-foreground">
                          → {(importTarget === "roster" ? ROSTER_DB_FIELDS : DB_FIELDS).find((f) => f.value === columnMap[h])?.label ?? "Skip"}
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawRows.slice(0, 3).map((row, i) => (
                    <TableRow key={i}>
                      {headers.map((h) => (
                        <TableCell key={h} className="text-xs whitespace-nowrap">
                          {String(row[h] ?? "—")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => allSheets.length > 1 ? setStep("sheets") : setStep("upload")}
              >
                Back
              </Button>
              {importTarget === "roster" ? (
                <Button onClick={handleImport} disabled={isImporting}>
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing Roster...
                    </>
                  ) : (
                    <>Import {rawRows.length} Roster Members</>
                  )}
                </Button>
              ) : (
                <Button onClick={handleValidate} disabled={isValidating}>
                  {isValidating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>Validate {rawRows.length} Rows</>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        );
      })()}

      {/* ── STEP 3: PREVIEW / DRY RUN ── */}
      {step === "preview" && (
        <Card>
          <CardHeader>
            <CardTitle>Validation Results</CardTitle>
            <CardDescription>
              <span className="text-green-600 font-medium">{validCount} valid</span>
              {errorCount > 0 && (
                <>
                  {" · "}
                  <span className="text-red-600 font-medium">{errorCount} errors</span>
                </>
              )}
              {" · "}{rawRows.length} total rows
              <Badge variant="outline" className="ml-2">
                {importMode === "replace" ? "Replace mode — existing inventory will be deleted" : "Append mode"}
              </Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {importMode === "replace" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  <strong>Replace mode:</strong> All existing inventory for this event will be deleted
                  before importing {validCount} new vehicles. This cannot be undone.
                </p>
              </div>
            )}

            <div className="rounded-md border overflow-x-auto max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead className="w-16">Status</TableHead>
                    <TableHead>Stock #</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Make</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validationResults.map((r) => (
                    <TableRow
                      key={r.row}
                      className={r.valid ? "" : "bg-red-50 dark:bg-red-950/20"}
                    >
                      <TableCell className="text-xs">{r.row}</TableCell>
                      <TableCell>
                        {r.valid ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {String(r.data.stock_number ?? "—")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {String(r.data.year ?? "—")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {String(r.data.make ?? "—")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {String(r.data.model ?? "—")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.data.acquisition_cost
                          ? `$${Number(r.data.acquisition_cost).toLocaleString()}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-red-600">
                        {r.errors.join("; ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep("map")}>
                Back to Mapping
              </Button>
              <Button
                onClick={handleImport}
                disabled={validCount === 0}
                variant={importMode === "replace" ? "destructive" : "default"}
              >
                {importMode === "replace" ? (
                  <>
                    <Replace className="h-4 w-4" />
                    Replace Inventory ({validCount} vehicles)
                  </>
                ) : (
                  <>Import {validCount} Vehicles</>
                )}
              </Button>
              {errorCount > 0 && (
                <p className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {errorCount} invalid row(s) will be skipped
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 4: IMPORTING ── */}
      {step === "importing" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">
              {importTarget === "roster"
                ? (importMode === "replace" ? "Replacing roster..." : "Importing roster members...")
                : (importMode === "replace" ? "Replacing inventory..." : "Importing vehicles...")}
            </p>
            <p className="text-sm text-muted-foreground">
              {importMode === "replace" && "Clearing existing data, then "}
              processing {rawRows.length} rows
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 5: DONE ── */}
      {step === "done" && importResult && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            {importResult.success ? (
              <CheckCircle2 className="h-16 w-16 text-green-600 mb-4" />
            ) : (
              <AlertTriangle className="h-16 w-16 text-amber-500 mb-4" />
            )}
            <h2 className="text-2xl font-bold mb-2">Import Complete</h2>
            <div className="flex flex-wrap justify-center gap-3 mb-6">
              {importResult.mode === "replace" && importResult.deleted > 0 && (
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-sm px-3 py-1">
                  {importResult.deleted} old rows removed
                </Badge>
              )}
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm px-3 py-1">
                {importResult.imported} imported
              </Badge>
              {importResult.duplicatesSkipped > 0 && (
                <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-sm px-3 py-1">
                  {importResult.duplicatesSkipped} duplicates skipped
                </Badge>
              )}
              {importResult.errors > 0 && (
                <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-sm px-3 py-1">
                  {importResult.errors} errors
                </Badge>
              )}
            </div>
            {importResult.errorDetails.length > 0 && (
              <div className="w-full max-w-lg mb-6 rounded-md border p-4 text-xs space-y-1 max-h-40 overflow-y-auto">
                {importResult.errorDetails.slice(0, 20).map((e, i) => (
                  <p key={i} className="text-red-600">
                    Row {e.row}: {e.message}
                  </p>
                ))}
                {importResult.errorDetails.length > 20 && (
                  <p className="text-muted-foreground">
                    ...and {importResult.errorDetails.length - 20} more
                  </p>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <Button asChild>
                <Link href={importTarget === "roster" ? "/dashboard/roster" : "/dashboard/inventory"}>
                  {importTarget === "roster" ? "View Roster" : "View Inventory"}
                </Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setRawRows([]);
                  setHeaders([]);
                  setAllSheets([]);
                  setSelectedSheetIndices(new Set());
                  setColumnMap({});
                  setValidationResults([]);
                  setImportResult(null);
                }}
              >
                Import Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
