"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal, EventConfig } from "@/types/database";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  DollarSign,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Filter,
  X,
  Users,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import type { CommissionEntry } from "@/lib/utils/commission-export";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_GREEN = "#16a34a";

// ---------------------------------------------------------------------------
// Custom Recharts Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-sm text-green-700 font-bold">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function CommissionsPage() {
  const { currentEvent } = useEvent();

  // ── Data ──
  const [deals, setDeals] = useState<Deal[]>([]);
  const [config, setConfig] = useState<EventConfig | null>(null);
  const [roster, setRoster] = useState<
    { id: string; name: string; commission_pct: number | null }[]
  >([]);
  const [loading, setLoading] = useState(true);

  // ── Filters ──
  const [salespersonFilter, setSalespersonFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // ── Export state ──
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  // ── Data fetching + realtime ──

  useEffect(() => {
    if (!currentEvent) return;
    setLoading(true);
    const supabase = createClient();

    Promise.all([
      supabase
        .from("sales_deals")
        .select("*")
        .eq("event_id", currentEvent.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("event_config")
        .select("*")
        .eq("event_id", currentEvent.id)
        .maybeSingle(),
      supabase
        .from("roster")
        .select("id, name, commission_pct")
        .eq("event_id", currentEvent.id),
    ]).then(([dealsRes, configRes, rosterRes]) => {
      setDeals(dealsRes.data ?? []);
      setConfig(configRes.data);
      setRoster(rosterRes.data ?? []);
      setLoading(false);
    });

    // Realtime on deals
    const channel = supabase
      .channel(`comm-deals-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_deals",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        () => {
          supabase
            .from("sales_deals")
            .select("*")
            .eq("event_id", currentEvent.id)
            .then(({ data }) => setDeals(data ?? []));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent]);

  // ── Derived: roster rate map ──

  const rosterRateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const member of roster) {
      if (member.commission_pct != null) {
        map.set(member.name.toLowerCase().trim(), member.commission_pct);
      }
    }
    return map;
  }, [roster]);

  const defaultRate = config?.rep_commission_pct ?? 0.25;

  // ── Unique salesperson names for filter dropdown ──

  const salespersonNames = useMemo(() => {
    const names = new Set<string>();
    for (const deal of deals) {
      if (deal.salesperson) names.add(deal.salesperson);
      if (deal.second_salesperson) names.add(deal.second_salesperson);
    }
    return Array.from(names).sort();
  }, [deals]);

  // ── Filtered deals ──

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      // Salesperson filter
      if (salespersonFilter) {
        const matchesPrimary = deal.salesperson === salespersonFilter;
        const matchesSecondary =
          deal.second_salesperson === salespersonFilter;
        if (!matchesPrimary && !matchesSecondary) return false;
      }
      // Date range
      if (dateFrom && deal.sale_date && deal.sale_date < dateFrom) return false;
      if (dateTo && deal.sale_date && deal.sale_date > dateTo) return false;
      return true;
    });
  }, [deals, salespersonFilter, dateFrom, dateTo]);

  const hasFilters = salespersonFilter || dateFrom || dateTo;

  // ── Commission calculations ──

  const commissions = useMemo(() => {
    const byPerson: Record<string, CommissionEntry> = {};

    for (const deal of filteredDeals) {
      const sp = deal.salesperson;
      if (!sp) continue;

      // Per-person rate from roster, fallback to config default
      const spRate =
        rosterRateMap.get(sp.toLowerCase().trim()) ?? defaultRate;

      if (!byPerson[sp]) {
        byPerson[sp] = {
          name: sp,
          commissionRate: spRate,
          fullDeals: 0,
          splitDeals: 0,
          weightedFrontGross: 0,
          totalBackGross: 0,
          totalGross: 0,
          commission: 0,
          washouts: 0,
          avgPVR: 0,
        };
      }

      const front = deal.front_gross ?? 0;
      const back = deal.back_gross ?? 0;
      const total = deal.total_gross ?? 0;
      const pct1 = deal.salesperson_pct ?? 1;

      if (deal.second_salesperson) {
        // Split deal — primary salesperson
        byPerson[sp].splitDeals += 1;
        byPerson[sp].weightedFrontGross += front * pct1;
        byPerson[sp].totalBackGross += back * pct1;
        byPerson[sp].totalGross += total * pct1;
        byPerson[sp].commission += front * spRate * pct1;

        // Second salesperson
        const sp2 = deal.second_salesperson;
        const sp2Rate =
          rosterRateMap.get(sp2.toLowerCase().trim()) ?? defaultRate;

        if (!byPerson[sp2]) {
          byPerson[sp2] = {
            name: sp2,
            commissionRate: sp2Rate,
            fullDeals: 0,
            splitDeals: 0,
            weightedFrontGross: 0,
            totalBackGross: 0,
            totalGross: 0,
            commission: 0,
            washouts: 0,
            avgPVR: 0,
          };
        }
        const pct2 = deal.second_sp_pct ?? 0.5;
        byPerson[sp2].splitDeals += 1;
        byPerson[sp2].weightedFrontGross += front * pct2;
        byPerson[sp2].totalBackGross += back * pct2;
        byPerson[sp2].totalGross += total * pct2;
        byPerson[sp2].commission += front * sp2Rate * pct2;
      } else {
        // Full deal
        byPerson[sp].fullDeals += 1;
        byPerson[sp].weightedFrontGross += front;
        byPerson[sp].totalBackGross += back;
        byPerson[sp].totalGross += total;
        byPerson[sp].commission += front * spRate;
      }

      if (deal.is_washout) {
        byPerson[sp].washouts += 1;
      }
    }

    // Calculate avg PVR
    for (const entry of Object.values(byPerson)) {
      const totalDeals = entry.fullDeals + entry.splitDeals;
      entry.avgPVR = totalDeals > 0 ? entry.totalGross / totalDeals : 0;
    }

    return Object.values(byPerson).sort((a, b) => b.commission - a.commission);
  }, [filteredDeals, defaultRate, rosterRateMap]);

  // ── Summary stats ──

  const totalComm = commissions.reduce((s, c) => s + c.commission, 0);
  const totalWashouts = commissions.reduce((s, c) => s + c.washouts, 0);
  const avgComm =
    commissions.length > 0 ? totalComm / commissions.length : 0;

  // ── Chart data ──

  const chartData = useMemo(
    () =>
      commissions.map((c) => ({
        name: c.name.length > 15 ? c.name.substring(0, 14) + "…" : c.name,
        commission: Math.round(c.commission * 100) / 100,
      })),
    [commissions],
  );

  // ── Export handlers ──

  const handleExportExcel = useCallback(async () => {
    if (!currentEvent) return;
    setExporting("excel");
    try {
      const { generateCommissionExcel } = await import(
        "@/lib/utils/commission-export"
      );
      await generateCommissionExcel(commissions, {
        eventName: currentEvent.dealer_name ?? currentEvent.name,
        defaultRate,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      toast.success("Excel report downloaded");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to export Excel",
      );
    } finally {
      setExporting(null);
    }
  }, [currentEvent, commissions, defaultRate, dateFrom, dateTo]);

  const handleExportPDF = useCallback(async () => {
    if (!currentEvent) return;
    setExporting("pdf");
    try {
      const { generateCommissionPDF } = await import(
        "@/lib/utils/commission-export"
      );
      await generateCommissionPDF(commissions, {
        eventName: currentEvent.dealer_name ?? currentEvent.name,
        defaultRate,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      toast.success("PDF report downloaded");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to export PDF",
      );
    } finally {
      setExporting(null);
    }
  }, [currentEvent, commissions, defaultRate, dateFrom, dateTo]);

  // ── No event ──

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">
          Select an event to view commissions
        </p>
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Commission Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} — Default{" "}
            {(defaultRate * 100).toFixed(0)}% commission rate
            {roster.length > 0 && " (individual rates from roster)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            disabled={exporting !== null || commissions.length === 0}
          >
            {exporting === "pdf" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-1.5 h-4 w-4" />
            )}
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={exporting !== null || commissions.length === 0}
          >
            {exporting === "excel" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            )}
            Export Excel
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-end gap-4 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Filter className="h-4 w-4" />
                  Filters
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Salesperson
                  </Label>
                  <Select
                    value={salespersonFilter || "__all__"}
                    onValueChange={(v) =>
                      setSalespersonFilter(v === "__all__" ? "" : v)
                    }
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="All salespeople" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All salespeople</SelectItem>
                      {salespersonNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Date From
                  </Label>
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Date To
                  </Label>
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSalespersonFilter("");
                      setDateFrom("");
                      setDateTo("");
                    }}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-green-600" />
                  Total Commission Owed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-700">
                  {formatCurrency(totalComm)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Salespeople
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{commissions.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Avg Commission
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {formatCurrency(avgComm)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  Total Washouts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">
                  {totalWashouts}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Bar Chart */}
          {commissions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Commission by Salesperson
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 5, right: 20, bottom: 60, left: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      angle={-45}
                      textAnchor="end"
                      interval={0}
                      fontSize={11}
                      height={80}
                    />
                    <YAxis
                      tickFormatter={(v: number) =>
                        `$${(v / 1000).toFixed(0)}k`
                      }
                      fontSize={11}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                    />
                    <Bar
                      dataKey="commission"
                      fill={CHART_GREEN}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Commission Breakdown Table */}
          <Card>
            <CardHeader>
              <CardTitle>Commission Breakdown</CardTitle>
              <CardDescription>
                Individual rates from roster (default:{" "}
                {(defaultRate * 100).toFixed(0)}% of weighted front gross)
                {hasFilters && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    Filtered
                  </Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {commissions.length === 0 ? (
                <div className="flex flex-col items-center py-12">
                  <DollarSign className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    {hasFilters
                      ? "No deals match the current filters."
                      : "No deals with salesperson data yet."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Salesperson</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-center">Full</TableHead>
                        <TableHead className="text-center">Splits</TableHead>
                        <TableHead className="text-right">
                          Weighted Front
                        </TableHead>
                        <TableHead className="text-right">
                          Back Gross
                        </TableHead>
                        <TableHead className="text-right">
                          Total Gross
                        </TableHead>
                        <TableHead className="text-right">Avg PVR</TableHead>
                        <TableHead className="text-right">
                          Commission
                        </TableHead>
                        <TableHead className="text-center">Wash</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissions.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="font-medium">
                            {c.name}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span
                              className={
                                c.commissionRate !== defaultRate
                                  ? "text-blue-600 font-medium"
                                  : ""
                              }
                            >
                              {(c.commissionRate * 100).toFixed(0)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            {c.fullDeals}
                          </TableCell>
                          <TableCell className="text-center">
                            {c.splitDeals}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(c.weightedFrontGross)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-blue-700">
                            {formatCurrency(c.totalBackGross)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(c.totalGross)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(c.avgPVR)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-bold text-green-700">
                            {formatCurrency(c.commission)}
                          </TableCell>
                          <TableCell className="text-center">
                            {c.washouts > 0 ? (
                              <Badge
                                variant="destructive"
                                className="text-[10px]"
                              >
                                {c.washouts}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals row */}
                      <TableRow className="border-t-2 font-bold bg-muted/50">
                        <TableCell>TOTALS</TableCell>
                        <TableCell className="text-right">—</TableCell>
                        <TableCell className="text-center">
                          {commissions.reduce((s, c) => s + c.fullDeals, 0)}
                        </TableCell>
                        <TableCell className="text-center">
                          {commissions.reduce((s, c) => s + c.splitDeals, 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            commissions.reduce(
                              (s, c) => s + c.weightedFrontGross,
                              0,
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-blue-700">
                          {formatCurrency(
                            commissions.reduce(
                              (s, c) => s + c.totalBackGross,
                              0,
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(
                            commissions.reduce(
                              (s, c) => s + c.totalGross,
                              0,
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-right">—</TableCell>
                        <TableCell className="text-right tabular-nums text-green-700">
                          {formatCurrency(totalComm)}
                        </TableCell>
                        <TableCell className="text-center">
                          {totalWashouts > 0 && (
                            <span className="flex items-center justify-center gap-1 text-red-600">
                              <AlertTriangle className="h-3 w-3" />
                              {totalWashouts}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
