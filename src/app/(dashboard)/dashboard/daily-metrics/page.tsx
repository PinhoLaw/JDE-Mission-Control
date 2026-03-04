// Daily Metrics auto-sync from Google Sheet Deal Log — removes double entry
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { DailyMetric } from "@/types/database";
import { formatCurrency } from "@/lib/utils";
import {
  bulkUpsertDailyMetrics,
  deleteDailyMetric,
  refreshDailyMetricsFromSheet,
} from "@/lib/actions/daily-metrics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  CalendarDays,
  TrendingUp,
  Users,
  DollarSign,
  RotateCcw,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types for editable row state
// ---------------------------------------------------------------------------

interface EditableRow {
  id?: string; // undefined = new row
  sale_day: number;
  sale_date: string;
  total_ups: number;
  total_sold: number;
  total_gross: number;
  total_front: number;
  total_back: number;
  notes: string;
  _dirty: boolean; // track if row was modified
  _isNew: boolean; // track if this is a new unsaved row
  _fromSheet: boolean; // track if sold/gross data came from Google Sheet
}

function metricToRow(m: DailyMetric, sheetDates?: Set<string>): EditableRow {
  return {
    id: m.id,
    sale_day: m.sale_day,
    sale_date: m.sale_date ?? "",
    total_ups: m.total_ups ?? 0,
    total_sold: m.total_sold ?? 0,
    total_gross: m.total_gross ?? 0,
    total_front: m.total_front ?? 0,
    total_back: m.total_back ?? 0,
    notes: m.notes ?? "",
    _dirty: false,
    _isNew: false,
    _fromSheet: sheetDates ? sheetDates.has(m.sale_date ?? "") : false,
  };
}

function emptyRow(saleDay: number): EditableRow {
  return {
    sale_day: saleDay,
    sale_date: "",
    total_ups: 0,
    total_sold: 0,
    total_gross: 0,
    total_front: 0,
    total_back: 0,
    notes: "",
    _dirty: true,
    _isNew: true,
    _fromSheet: false,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function DailyMetricsPage() {
  const { currentEvent } = useEvent();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Track which dates have sheet-synced data
  const [sheetDates, setSheetDates] = useState<Set<string>>(new Set());

  const hasLinkedSheet = !!(currentEvent?.sheet_id);

  // -----------------------------------------------------------------------
  // Fetch existing daily_metrics
  // -----------------------------------------------------------------------

  const loadData = useCallback(async () => {
    if (!currentEvent) return;
    setLoading(true);
    const supabase = createClient();

    const { data, error } = await supabase
      .from("daily_metrics")
      .select("*")
      .eq("event_id", currentEvent.id)
      .order("sale_day", { ascending: true });

    if (error) {
      console.error("Failed to load daily metrics:", error);
      toast.error("Failed to load daily metrics");
    }

    setRows((data ?? []).map((m) => metricToRow(m, sheetDates)));
    setLoading(false);
  }, [currentEvent, sheetDates]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -----------------------------------------------------------------------
  // Refresh from Google Sheet
  // -----------------------------------------------------------------------

  const syncFromSheet = useCallback(async () => {
    if (!currentEvent?.sheet_id) return;
    setSyncing(true);

    try {
      const result = await refreshDailyMetricsFromSheet(
        currentEvent.id,
        currentEvent.sheet_id,
      );

      if (result.success) {
        // Track which dates came from the sheet
        const dates = new Set(result.sheetMetrics.map((m) => m.sale_date));
        setSheetDates(dates);

        toast.success(
          `Synced ${result.daysUpdated} day(s), ${result.totalDeals} deals from Google Sheet`,
        );
        // Reload to get updated data
        await loadData();
      }
    } catch (err) {
      toast.error(
        `Sheet sync failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSyncing(false);
    }
  }, [currentEvent, loadData]);

  // -----------------------------------------------------------------------
  // Row manipulation
  // -----------------------------------------------------------------------

  const addDay = () => {
    const nextDay =
      rows.length > 0 ? Math.max(...rows.map((r) => r.sale_day)) + 1 : 1;

    // Auto-calculate date if event has start_date
    let autoDate = "";
    if (currentEvent?.start_date) {
      const start = new Date(currentEvent.start_date + "T12:00:00");
      start.setDate(start.getDate() + (nextDay - 1));
      autoDate = start.toISOString().split("T")[0];
    }

    const newRow = emptyRow(nextDay);
    newRow.sale_date = autoDate;
    setRows([...rows, newRow]);
  };

  const updateRow = (
    index: number,
    field: keyof EditableRow,
    value: string | number,
  ) => {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, [field]: value, _dirty: true } : r,
      ),
    );
  };

  const removeRow = async (index: number) => {
    const row = rows[index];

    // If it's already saved in DB, delete it
    if (row.id && currentEvent) {
      try {
        await deleteDailyMetric(row.id, currentEvent.id);
        toast.success(`Day ${row.sale_day} deleted`);
      } catch (err) {
        toast.error(
          `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
        return;
      }
    }

    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  // -----------------------------------------------------------------------
  // Save all dirty rows
  // -----------------------------------------------------------------------

  const dirtyRows = rows.filter((r) => r._dirty);

  const saveAll = async () => {
    if (!currentEvent || dirtyRows.length === 0) return;
    setSaving(true);

    try {
      await bulkUpsertDailyMetrics({
        event_id: currentEvent.id,
        rows: dirtyRows.map((r) => ({
          id: r.id,
          event_id: currentEvent.id,
          sale_day: r.sale_day,
          sale_date: r.sale_date || null,
          total_ups: r.total_ups,
          total_sold: r.total_sold,
          total_gross: r.total_gross || null,
          total_front: r.total_front || null,
          total_back: r.total_back || null,
          notes: r.notes || null,
        })),
      });

      toast.success(`Saved ${dirtyRows.length} day(s)`);
      // Reload to get IDs for newly inserted rows
      await loadData();
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Summary stats
  // -----------------------------------------------------------------------

  const totals = useMemo(() => {
    const ups = rows.reduce((s, r) => s + r.total_ups, 0);
    const sold = rows.reduce((s, r) => s + r.total_sold, 0);
    const gross = rows.reduce((s, r) => s + r.total_gross, 0);
    const front = rows.reduce((s, r) => s + r.total_front, 0);
    const back = rows.reduce((s, r) => s + r.total_back, 0);
    const closePct = ups > 0 ? (sold / ups) * 100 : 0;
    return { ups, sold, gross, front, back, closePct };
  }, [rows]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">
          Select an event to manage daily metrics
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Daily Metrics
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} — Enter daily ups,
            sold, and gross numbers
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh from Google Sheet — prominent green button */}
          {hasLinkedSheet && (
            <Button
              variant="outline"
              size="sm"
              onClick={syncFromSheet}
              disabled={syncing || loading}
              className="border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Refresh from Google Sheet
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
          >
            <RotateCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={addDay}>
            <Plus className="h-4 w-4" /> Add Day
          </Button>
          <Button
            size="sm"
            onClick={saveAll}
            disabled={saving || dirtyRows.length === 0}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save{dirtyRows.length > 0 ? ` (${dirtyRows.length})` : ""}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          {rows.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> Days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{rows.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> Total Ups
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {totals.ups.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Total Sold
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{totals.sold}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" /> Total Gross
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-700">
                    {formatCurrency(totals.gross)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Closing %</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-blue-700">
                    {totals.closePct.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totals.sold} / {totals.ups}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Editable Table */}
          <Card>
            <CardHeader>
              <CardTitle>Day-by-Day Entry</CardTitle>
              <CardDescription>
                {hasLinkedSheet ? (
                  <>
                    Sold, Gross, Front &amp; Back are auto-filled from the
                    Google Sheet. <strong>Ups</strong> and{" "}
                    <strong>Notes</strong> are manual.
                  </>
                ) : (
                  <>
                    Enter or edit metrics for each sale day. Changed rows are
                    highlighted and saved with the Save button.
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <CalendarDays className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">
                    {hasLinkedSheet
                      ? 'No daily metrics yet. Click "Refresh from Google Sheet" to pull deal data, or "Add Day" to enter manually.'
                      : 'No daily metrics yet. Click "Add Day" to start entering data.'}
                  </p>
                  <div className="flex gap-2">
                    {hasLinkedSheet && (
                      <Button
                        variant="outline"
                        onClick={syncFromSheet}
                        disabled={syncing}
                        className="border-green-300 text-green-700 hover:bg-green-50"
                      >
                        {syncing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileSpreadsheet className="h-4 w-4" />
                        )}
                        Refresh from Google Sheet
                      </Button>
                    )}
                    <Button variant="outline" onClick={addDay}>
                      <Plus className="h-4 w-4" /> Add Day 1
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[60px]">Day</TableHead>
                        <TableHead className="w-[140px]">Date</TableHead>
                        <TableHead className="w-[100px] text-right">
                          Ups
                        </TableHead>
                        <TableHead className="w-[100px] text-right">
                          Sold
                        </TableHead>
                        <TableHead className="w-[130px] text-right">
                          Total Gross
                        </TableHead>
                        <TableHead className="w-[130px] text-right">
                          Front Gross
                        </TableHead>
                        <TableHead className="w-[130px] text-right">
                          Back Gross
                        </TableHead>
                        <TableHead className="w-[90px] text-right">
                          Close %
                        </TableHead>
                        <TableHead className="min-w-[140px]">Notes</TableHead>
                        <TableHead className="w-[50px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, idx) => {
                        const closePct =
                          row.total_ups > 0
                            ? ((row.total_sold / row.total_ups) * 100).toFixed(
                                1,
                              )
                            : "—";
                        const dayLabel = row.sale_date
                          ? new Date(
                              row.sale_date + "T12:00:00",
                            ).toLocaleDateString("en-US", {
                              weekday: "short",
                            })
                          : "";
                        const isAutoFilled =
                          row._fromSheet ||
                          sheetDates.has(row.sale_date);

                        return (
                          <TableRow
                            key={idx}
                            className={
                              row._dirty
                                ? "bg-yellow-50 dark:bg-yellow-950/30"
                                : isAutoFilled
                                  ? "bg-green-50/50 dark:bg-green-950/20"
                                  : ""
                            }
                          >
                            {/* Day number */}
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-sm">
                                  {row.sale_day}
                                </span>
                                {row._isNew && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] px-1 py-0"
                                  >
                                    new
                                  </Badge>
                                )}
                                {isAutoFilled && !row._isNew && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1 py-0 border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                                  >
                                    <FileSpreadsheet className="h-2.5 w-2.5 mr-0.5" />
                                    Sheet
                                  </Badge>
                                )}
                              </div>
                              {dayLabel && (
                                <span className="text-xs text-muted-foreground">
                                  {dayLabel}
                                </span>
                              )}
                            </TableCell>

                            {/* Date */}
                            <TableCell>
                              <Input
                                type="date"
                                value={row.sale_date}
                                onChange={(e) =>
                                  updateRow(idx, "sale_date", e.target.value)
                                }
                                className="h-8 text-sm"
                              />
                            </TableCell>

                            {/* Ups — always manual/editable */}
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                value={row.total_ups || ""}
                                onChange={(e) =>
                                  updateRow(
                                    idx,
                                    "total_ups",
                                    parseInt(e.target.value) || 0,
                                  )
                                }
                                placeholder="0"
                                className="h-8 text-sm text-right"
                              />
                            </TableCell>

                            {/* Sold — auto-filled when sheet linked, otherwise editable */}
                            <TableCell>
                              {isAutoFilled ? (
                                <div className="text-right text-sm font-medium pr-3 text-green-700 dark:text-green-400">
                                  {row.total_sold}
                                </div>
                              ) : (
                                <Input
                                  type="number"
                                  min={0}
                                  value={row.total_sold || ""}
                                  onChange={(e) =>
                                    updateRow(
                                      idx,
                                      "total_sold",
                                      parseInt(e.target.value) || 0,
                                    )
                                  }
                                  placeholder="0"
                                  className="h-8 text-sm text-right"
                                />
                              )}
                            </TableCell>

                            {/* Total Gross — auto-filled when sheet linked */}
                            <TableCell>
                              {isAutoFilled ? (
                                <div className="text-right text-sm font-medium pr-3 text-green-700 dark:text-green-400">
                                  {formatCurrency(row.total_gross)}
                                </div>
                              ) : (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={row.total_gross || ""}
                                  onChange={(e) =>
                                    updateRow(
                                      idx,
                                      "total_gross",
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  placeholder="0.00"
                                  className="h-8 text-sm text-right"
                                />
                              )}
                            </TableCell>

                            {/* Front Gross — auto-filled when sheet linked */}
                            <TableCell>
                              {isAutoFilled ? (
                                <div className="text-right text-sm font-medium pr-3 text-green-700 dark:text-green-400">
                                  {formatCurrency(row.total_front)}
                                </div>
                              ) : (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={row.total_front || ""}
                                  onChange={(e) =>
                                    updateRow(
                                      idx,
                                      "total_front",
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  placeholder="0.00"
                                  className="h-8 text-sm text-right"
                                />
                              )}
                            </TableCell>

                            {/* Back Gross — auto-filled when sheet linked */}
                            <TableCell>
                              {isAutoFilled ? (
                                <div className="text-right text-sm font-medium pr-3 text-green-700 dark:text-green-400">
                                  {formatCurrency(row.total_back)}
                                </div>
                              ) : (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={row.total_back || ""}
                                  onChange={(e) =>
                                    updateRow(
                                      idx,
                                      "total_back",
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  placeholder="0.00"
                                  className="h-8 text-sm text-right"
                                />
                              )}
                            </TableCell>

                            {/* Close % (computed, read-only) */}
                            <TableCell className="text-right">
                              <span
                                className={`text-sm font-medium ${
                                  closePct !== "—"
                                    ? "text-blue-700 dark:text-blue-400"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {closePct}
                                {closePct !== "—" ? "%" : ""}
                              </span>
                            </TableCell>

                            {/* Notes — always manual/editable */}
                            <TableCell>
                              <Input
                                value={row.notes}
                                onChange={(e) =>
                                  updateRow(idx, "notes", e.target.value)
                                }
                                placeholder="Optional notes..."
                                className="h-8 text-sm"
                              />
                            </TableCell>

                            {/* Delete */}
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeRow(idx)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}

                      {/* Totals Row */}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell colSpan={2} className="text-right text-sm">
                          Totals
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {totals.ups.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {totals.sold}
                        </TableCell>
                        <TableCell className="text-right text-sm text-green-700">
                          {formatCurrency(totals.gross)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(totals.front)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(totals.back)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-blue-700">
                          {totals.closePct.toFixed(1)}%
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Add another day button below table */}
              {rows.length > 0 && (
                <div className="flex items-center justify-between mt-4">
                  <Button variant="outline" size="sm" onClick={addDay}>
                    <Plus className="h-4 w-4" /> Add Day {rows.length + 1}
                  </Button>
                  {dirtyRows.length > 0 && (
                    <p className="text-sm text-yellow-600 dark:text-yellow-400">
                      {dirtyRows.length} unsaved change(s)
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
