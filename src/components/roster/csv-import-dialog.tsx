"use client";

import { useState, useCallback } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RosterRole = "sales" | "team_leader" | "fi_manager" | "closer" | "manager";

const FIELD_OPTIONS = [
  { value: "__skip__", label: "(Skip)" },
  { value: "name", label: "Name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "role", label: "Role" },
  { value: "team", label: "Team" },
  { value: "commission_pct", label: "Commission %" },
  { value: "notes", label: "Notes" },
] as const;

// Fuzzy header matching
const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  "full name": "name",
  "first name": "name",
  salesperson: "name",
  rep: "name",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  cell: "phone",
  email: "email",
  "email address": "email",
  "e-mail": "email",
  role: "role",
  position: "role",
  title: "role",
  team: "team",
  group: "team",
  commission: "commission_pct",
  "commission %": "commission_pct",
  "comm %": "commission_pct",
  "comm": "commission_pct",
  commission_pct: "commission_pct",
  notes: "notes",
  note: "notes",
  comments: "notes",
};

const ROLE_FROM_LABEL: Record<string, RosterRole> = {
  sales: "sales",
  salesperson: "sales",
  "team leader": "team_leader",
  "team_leader": "team_leader",
  "f&i manager": "fi_manager",
  "fi_manager": "fi_manager",
  "fi manager": "fi_manager",
  closer: "closer",
  manager: "manager",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  onImport: (
    members: Array<{
      name: string;
      phone?: string | null;
      email?: string | null;
      role: "manager" | "team_leader" | "fi_manager" | "sales" | "closer";
      team?: string | null;
      commission_pct?: number | null;
      notes?: string | null;
    }>,
  ) => Promise<{ insertedCount: number; updatedCount: number; skippedCount: number }>;
}

export function CSVImportDialog({
  open,
  onOpenChange,
  eventId,
  onImport,
}: CSVImportDialogProps) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [rawText, setRawText] = useState("");
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setRawText("");
    setParsedRows([]);
    setHeaders([]);
    setColumnMap({});
    setParseError(null);
  }, []);

  const parseCSV = useCallback((text: string) => {
    setParseError(null);

    if (!text.trim()) {
      setParseError("No data to parse");
      return;
    }

    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (result.errors.length > 0 && result.data.length === 0) {
      setParseError(result.errors[0].message);
      return;
    }

    const csvHeaders = result.meta.fields ?? [];
    setParsedRows(result.data);
    setHeaders(csvHeaders);

    // Auto-detect column mappings
    const autoMap: Record<string, string> = {};
    for (const h of csvHeaders) {
      const key = h.toLowerCase().trim();
      if (HEADER_ALIASES[key]) {
        autoMap[h] = HEADER_ALIASES[key];
      } else {
        autoMap[h] = "__skip__";
      }
    }
    setColumnMap(autoMap);
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setRawText(text);
        parseCSV(text);
      };
      reader.readAsText(file);
    },
    [parseCSV],
  );

  const handleImport = useCallback(async () => {
    // Ensure at least "name" is mapped
    const nameCol = Object.entries(columnMap).find(
      ([, v]) => v === "name",
    )?.[0];
    if (!nameCol) {
      toast.error("You must map a column to 'Name'");
      return;
    }

    setImporting(true);
    try {
      const members = parsedRows
        .map((row) => {
          const member: Record<string, unknown> = {};
          for (const [csvHeader, field] of Object.entries(columnMap)) {
            if (field === "__skip__") continue;
            const rawValue = row[csvHeader]?.trim() ?? "";
            if (!rawValue) continue;

            if (field === "commission_pct") {
              // Parse percentage: "25" → 0.25, "25%" → 0.25
              const num = parseFloat(rawValue.replace("%", ""));
              if (!isNaN(num)) {
                member.commission_pct = num > 1 ? num / 100 : num;
              }
            } else if (field === "role") {
              member.role =
                ROLE_FROM_LABEL[rawValue.toLowerCase().trim()] ?? "sales";
            } else {
              member[field] = rawValue;
            }
          }
          return member;
        })
        .filter((m) => m.name && typeof m.name === "string") as Array<{
        name: string;
        phone?: string | null;
        email?: string | null;
        role: "manager" | "team_leader" | "fi_manager" | "sales" | "closer";
        team?: string | null;
        commission_pct?: number | null;
        notes?: string | null;
      }>;

      // Default role to "sales" if missing
      for (const m of members) {
        if (!m.role) m.role = "sales";
      }

      if (members.length === 0) {
        toast.error("No valid members found in CSV data");
        return;
      }

      const result = await onImport(members);
      const parts: string[] = [];
      if (result.insertedCount > 0) parts.push(`${result.insertedCount} imported`);
      if (result.updatedCount > 0) parts.push(`${result.updatedCount} updated`);
      if (result.skippedCount > 0) parts.push(`${result.skippedCount} skipped`);
      toast.success(parts.join(", ") || "Import complete");

      resetState();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Import failed",
      );
    } finally {
      setImporting(false);
    }
  }, [parsedRows, columnMap, onImport, onOpenChange, resetState]);

  // Count how many valid rows have a name mapped
  const nameCol = Object.entries(columnMap).find(
    ([, v]) => v === "name",
  )?.[0];
  const validCount = nameCol
    ? parsedRows.filter((r) => r[nameCol]?.trim()).length
    : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resetState();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            CSV Import
          </DialogTitle>
          <DialogDescription>
            Paste CSV data from Excel or upload a .csv file to bulk-import
            roster members.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as "paste" | "file")}
        >
          <TabsList className="w-full">
            <TabsTrigger value="paste" className="flex-1">
              Paste CSV
            </TabsTrigger>
            <TabsTrigger value="file" className="flex-1">
              Upload File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-3">
            <Textarea
              rows={6}
              placeholder={`Paste CSV data here...\n\nExample:\nName,Role,Team,Commission %\nJohn Smith,Sales,Team A,25\nJane Doe,Closer,Team B,30`}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => parseCSV(rawText)}
              disabled={!rawText.trim()}
            >
              Parse CSV
            </Button>
          </TabsContent>

          <TabsContent value="file" className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="csv-file">Choose CSV File</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,.txt,.tsv"
                onChange={handleFileUpload}
              />
            </div>
          </TabsContent>
        </Tabs>

        {parseError && (
          <p className="text-sm text-destructive">{parseError}</p>
        )}

        {/* Column Mapping */}
        {headers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Column Mapping
              </Label>
              <Badge variant="secondary">
                {parsedRows.length} row{parsedRows.length !== 1 ? "s" : ""}{" "}
                parsed
              </Badge>
            </div>
            <div className="grid gap-2">
              {headers.map((h) => (
                <div
                  key={h}
                  className="flex items-center gap-3"
                >
                  <span className="text-sm text-muted-foreground min-w-[120px] truncate">
                    {h}
                  </span>
                  <Select
                    value={columnMap[h] ?? "__skip__"}
                    onValueChange={(v) =>
                      setColumnMap((m) => ({ ...m, [h]: v }))
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Preview */}
        {parsedRows.length > 0 && nameCol && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Preview (first 5 rows)
            </Label>
            <ScrollArea className="h-[180px] rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.entries(columnMap)
                      .filter(([, v]) => v !== "__skip__")
                      .map(([csvH, field]) => (
                        <TableHead key={csvH} className="text-xs">
                          {FIELD_OPTIONS.find((o) => o.value === field)
                            ?.label ?? field}
                        </TableHead>
                      ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.slice(0, 5).map((row, i) => (
                    <TableRow key={i}>
                      {Object.entries(columnMap)
                        .filter(([, v]) => v !== "__skip__")
                        .map(([csvH]) => (
                          <TableCell
                            key={csvH}
                            className="text-xs py-1"
                          >
                            {row[csvH] ?? ""}
                          </TableCell>
                        ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        {/* Import Button */}
        {parsedRows.length > 0 && (
          <Button
            onClick={handleImport}
            disabled={importing || validCount === 0}
            className="w-full"
          >
            {importing && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            Import {validCount} Member{validCount !== 1 ? "s" : ""}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
