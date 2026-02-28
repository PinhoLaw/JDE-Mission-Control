// Production-ready — Dashboard now pushes to Dashboard Push live mirror
"use client";

import { useCallback, useState } from "react";
import {
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
  Plus,
  Search,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type SheetRow = Record<string, string>;

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

// ─────────────────────────────────────────────────────────────
// Helper: call /api/sheets
// ─────────────────────────────────────────────────────────────

async function sheetsApi(body: Record<string, unknown>) {
  const res = await fetch("/api/sheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export default function SheetsTestPage() {
  // ── Table state ──
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  // ── Append form state ──
  const [appendForm, setAppendForm] = useState({
    "Stock #": "",
    Year: "",
    Make: "",
    Model: "",
    Status: "",
    Price: "",
  });
  const [appending, setAppending] = useState(false);

  // ── Update form state ──
  const [updateStockNum, setUpdateStockNum] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [updating, setUpdating] = useState(false);

  // ── Toast notifications ──
  const [toasts, setToasts] = useState<Toast[]>([]);
  let toastId = 0;

  function showToast(type: "success" | "error", message: string) {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }

  // ── Load Dashboard Push ──
  const loadSheet = useCallback(async () => {
    setLoading(true);
    setTableError(null);
    try {
      const data = await sheetsApi({ action: "read", sheetTitle: "Dashboard Push" });
      setHeaders(data.headers || []);
      setRows(data.rows || []);
      setLastFetched(new Date().toLocaleTimeString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTableError(msg);
      showToast("error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Append row ──
  async function handleAppend(e: React.FormEvent) {
    e.preventDefault();
    const hasValue = Object.values(appendForm).some((v) => v.trim() !== "");
    if (!hasValue) {
      showToast("error", "Fill in at least one field");
      return;
    }
    setAppending(true);
    try {
      const result = await sheetsApi({
        action: "append",
        sheetTitle: "Dashboard Push",
        data: appendForm,
      });
      showToast("success", `Row added at row ${result.rowNumber}`);
      setAppendForm({ "Stock #": "", Year: "", Make: "", Model: "", Status: "", Price: "" });
      await loadSheet();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setAppending(false);
    }
  }

  // ── Update by field ──
  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!updateStockNum.trim() || !updateStatus.trim()) {
      showToast("error", "Both Stock # and new Status are required");
      return;
    }
    setUpdating(true);
    try {
      const result = await sheetsApi({
        action: "update_by_field",
        sheetTitle: "Dashboard Push",
        matchColumn: "Stock #",
        matchValue: updateStockNum.trim(),
        data: { Status: updateStatus.trim() },
      });
      showToast(
        "success",
        `Updated row ${result.rowNumber}: Status → "${updateStatus.trim()}"`,
      );
      setUpdateStockNum("");
      setUpdateStatus("");
      await loadSheet();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* ── Toast Notifications ── */}
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-in slide-in-from-right fade-in flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg ${
              t.type === "success"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
                : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
            }`}
          >
            {t.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{t.message}</p>
          </div>
        ))}
      </div>

      {/* ── Header Bar ── */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Sheets Test &mdash; Dashboard Push
              </h1>
              {lastFetched && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {rows.length} rows &middot; Last loaded {lastFetched}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            onClick={loadSheet}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {loading ? "Loading..." : "Load Dashboard Push"}
          </Button>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* ── Action Cards ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Append Row Card ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4 text-primary" />
                Add Row to Dashboard Push
              </CardTitle>
              <CardDescription>
                Push a new vehicle row from Dashboard to Google Sheets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAppend} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="stock">Stock #</Label>
                    <Input
                      id="stock"
                      placeholder="MF1503A"
                      value={appendForm["Stock #"]}
                      onChange={(e) =>
                        setAppendForm((f) => ({ ...f, "Stock #": e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="year">Year</Label>
                    <Input
                      id="year"
                      placeholder="2024"
                      value={appendForm.Year}
                      onChange={(e) =>
                        setAppendForm((f) => ({ ...f, Year: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="make">Make</Label>
                    <Input
                      id="make"
                      placeholder="FORD"
                      value={appendForm.Make}
                      onChange={(e) =>
                        setAppendForm((f) => ({ ...f, Make: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="model">Model</Label>
                    <Input
                      id="model"
                      placeholder="F150 RAPTOR"
                      value={appendForm.Model}
                      onChange={(e) =>
                        setAppendForm((f) => ({ ...f, Model: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="status">Status</Label>
                    <Input
                      id="status"
                      placeholder="AVAILABLE"
                      value={appendForm.Status}
                      onChange={(e) =>
                        setAppendForm((f) => ({ ...f, Status: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="price">Price</Label>
                    <Input
                      id="price"
                      placeholder="$28,500"
                      value={appendForm.Price}
                      onChange={(e) =>
                        setAppendForm((f) => ({ ...f, Price: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={appending}>
                  {appending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {appending ? "Adding..." : "Add to Dashboard Push"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* ── Update Status Card ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-primary" />
                Update Status by Stock #
              </CardTitle>
              <CardDescription>
                Find a vehicle by Stock # and change its Status in Dashboard Push
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="find-stock">Stock # to find</Label>
                  <Input
                    id="find-stock"
                    placeholder="MF1503A"
                    value={updateStockNum}
                    onChange={(e) => setUpdateStockNum(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-status">New Status</Label>
                  <Input
                    id="new-status"
                    placeholder="SOLD"
                    value={updateStatus}
                    onChange={(e) => setUpdateStatus(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  className="w-full"
                  disabled={updating}
                >
                  {updating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {updating ? "Updating..." : "Update Status"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* ── Data Table ── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Dashboard Push Data</CardTitle>
              {rows.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {rows.length}
                  </span>{" "}
                  {rows.length === 1 ? "row" : "rows"} &middot;{" "}
                  <span className="font-semibold text-foreground">
                    {headers.length}
                  </span>{" "}
                  columns
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {/* Loading */}
            {loading && rows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Loading Dashboard Push data&hellip;
                </p>
              </div>
            )}

            {/* Error */}
            {tableError && (
              <div className="mx-6 mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-300">
                      {tableError}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-red-700 hover:text-red-800 dark:text-red-400"
                      onClick={loadSheet}
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      Retry
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Empty — not yet loaded */}
            {!loading && !tableError && rows.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <FileSpreadsheet className="mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">
                  {lastFetched ? "No data in Dashboard Push" : "Click \"Load Dashboard Push\" to fetch data"}
                </p>
              </div>
            )}

            {/* Table */}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/50">
                      <th className="sticky left-0 z-[1] whitespace-nowrap bg-muted/80 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        #
                      </th>
                      {headers.map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row, ri) => (
                      <tr
                        key={ri}
                        className="transition-colors hover:bg-muted/30"
                      >
                        <td className="sticky left-0 z-[1] whitespace-nowrap bg-card px-4 py-2.5 text-xs font-medium tabular-nums text-muted-foreground">
                          {ri + 1}
                        </td>
                        {headers.map((h) => {
                          const val = row[h] || "";
                          const isDollar = /^-?\$/.test(val);
                          const isNeg = /^-/.test(val);
                          return (
                            <td
                              key={h}
                              className={`whitespace-nowrap px-4 py-2.5 text-sm ${
                                isDollar
                                  ? isNeg
                                    ? "font-medium tabular-nums text-red-600 dark:text-red-400"
                                    : "font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                                  : val === ""
                                    ? "text-muted-foreground/40"
                                    : "text-foreground"
                              }`}
                            >
                              {val || "\u2014"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
