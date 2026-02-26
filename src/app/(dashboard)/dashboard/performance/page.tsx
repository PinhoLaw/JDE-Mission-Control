"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal, RosterMember, DailySale } from "@/types/database";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, Loader2, Users } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_COLORS = {
  primary: "#2563eb",
  secondary: "#16a34a",
  accent: "#f59e0b",
} as const;

const PIE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6"];

const ROLE_BADGE_CLASSES: Record<string, string> = {
  sales: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  team_leader:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  fi_manager:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  closer:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  manager: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// ---------------------------------------------------------------------------
// Custom Recharts tooltip
// ---------------------------------------------------------------------------

function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-popover-foreground">
            {formatter ? formatter(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types for derived data
// ---------------------------------------------------------------------------

interface SalespersonRow {
  name: string;
  role: string;
  deals: number;
  frontGross: number;
  backGross: number;
  totalGross: number;
  avgPvr: number;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function PerformancePage() {
  const { currentEvent, isLoading: eventLoading } = useEvent();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [dailySales, setDailySales] = useState<DailySale[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const loadData = useCallback(async () => {
    if (!currentEvent) return;

    setIsLoading(true);
    const supabase = createClient();

    try {
      const [dealsRes, rosterRes, dailyRes] = await Promise.all([
        supabase
          .from("sales_deals")
          .select("*")
          .eq("event_id", currentEvent.id)
          .not("status", "eq", "cancelled"),
        supabase
          .from("roster")
          .select("*")
          .eq("event_id", currentEvent.id),
        supabase
          .from("v_daily_sales")
          .select("*")
          .eq("event_id", currentEvent.id)
          .order("sale_day", { ascending: true }),
      ]);

      if (dealsRes.error) throw dealsRes.error;
      if (rosterRes.error) throw rosterRes.error;
      if (dailyRes.error) throw dailyRes.error;

      setDeals(dealsRes.data ?? []);
      setRoster(rosterRes.data ?? []);
      setDailySales(dailyRes.data ?? []);
    } catch (err) {
      console.error("Failed to load performance data:", err);
      toast.error("Failed to load performance data");
    } finally {
      setIsLoading(false);
    }
  }, [currentEvent]);

  useEffect(() => {
    if (!eventLoading && currentEvent) {
      loadData();
    }
    if (!eventLoading && !currentEvent) {
      setIsLoading(false);
    }
  }, [eventLoading, currentEvent, loadData]);

  // -----------------------------------------------------------------------
  // Derived computations
  // -----------------------------------------------------------------------

  const rosterMap = useMemo(() => {
    const map = new Map<string, RosterMember>();
    for (const r of roster) {
      map.set(r.id, r);
      map.set(r.name, r);
    }
    return map;
  }, [roster]);

  const leaderboard = useMemo<SalespersonRow[]>(() => {
    const stats: Record<
      string,
      {
        deals: number;
        frontGross: number;
        backGross: number;
        totalGross: number;
        role: string;
      }
    > = {};

    // Seed from roster so everyone shows up even with zero deals
    for (const r of roster) {
      stats[r.name] = {
        deals: 0,
        frontGross: 0,
        backGross: 0,
        totalGross: 0,
        role: r.role ?? "sales",
      };
    }

    for (const deal of deals) {
      const sp = deal.salesperson;
      if (!sp) continue;
      if (!stats[sp]) {
        // Salesperson not found on roster -- infer role from roster map
        const rosterEntry = rosterMap.get(sp);
        stats[sp] = {
          deals: 0,
          frontGross: 0,
          backGross: 0,
          totalGross: 0,
          role: rosterEntry?.role ?? "sales",
        };
      }
      stats[sp].deals += 1;
      stats[sp].frontGross += deal.front_gross ?? 0;
      stats[sp].backGross += deal.back_gross ?? 0;
      stats[sp].totalGross += deal.total_gross ?? 0;
    }

    return Object.entries(stats)
      .map(([name, data]) => ({
        name,
        role: data.role,
        deals: data.deals,
        frontGross: data.frontGross,
        backGross: data.backGross,
        totalGross: data.totalGross,
        avgPvr: data.deals > 0 ? data.totalGross / data.deals : 0,
      }))
      .sort((a, b) => b.totalGross - a.totalGross);
  }, [deals, roster, rosterMap]);

  // Summary KPIs
  const kpis = useMemo(() => {
    const totalDeals = deals.length;
    const totalGross = deals.reduce((s, d) => s + (d.total_gross ?? 0), 0);
    const totalFront = deals.reduce((s, d) => s + (d.front_gross ?? 0), 0);
    const totalBack = deals.reduce((s, d) => s + (d.back_gross ?? 0), 0);
    const avgPvr = totalDeals > 0 ? totalGross / totalDeals : 0;
    const frontBackRatio =
      totalBack > 0 ? (totalFront / totalBack).toFixed(2) : "N/A";

    return { totalDeals, totalGross, totalFront, totalBack, avgPvr, frontBackRatio };
  }, [deals]);

  // Chart data: Daily Sales Trend
  const dailyTrendData = useMemo(
    () =>
      dailySales.map((d) => ({
        name: `Day ${d.sale_day}`,
        deals_count: d.deals_count,
        day_total_gross: d.day_total_gross,
      })),
    [dailySales],
  );

  // Chart data: Gross by salesperson (top 10 for readability)
  const grossBySalesperson = useMemo(
    () =>
      leaderboard
        .filter((s) => s.totalGross > 0)
        .slice(0, 10)
        .map((s) => ({
          name: s.name,
          totalGross: s.totalGross,
        })),
    [leaderboard],
  );

  // Chart data: Front vs Back pie
  const frontBackPie = useMemo(
    () => [
      { name: "Front Gross", value: kpis.totalFront },
      { name: "Back Gross", value: kpis.totalBack },
    ],
    [kpis.totalFront, kpis.totalBack],
  );

  // Chart data: Daily PVR Trend
  const dailyPvrData = useMemo(
    () =>
      dailySales.map((d) => ({
        name: `Day ${d.sale_day}`,
        day_avg_pvr: d.day_avg_pvr,
      })),
    [dailySales],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isLoading || eventLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Loading performance data...
        </p>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Empty / no event state
  // -----------------------------------------------------------------------

  if (!currentEvent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Event Selected</h2>
        <p className="text-muted-foreground max-w-md">
          Select an event from the event switcher to view performance analytics.
        </p>
      </div>
    );
  }

  const hasData = deals.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <TrendingUp className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-2xl font-bold mb-2">No Deals Yet</h2>
          <p className="text-muted-foreground max-w-md">
            Once deals are logged for this event, performance charts and the
            leaderboard will appear here.
          </p>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <PageHeader />

      {/* KPI Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Deals"
          value={String(kpis.totalDeals)}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Total Gross"
          value={formatCurrency(kpis.totalGross)}
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Avg PVR"
          value={formatCurrency(kpis.avgPvr)}
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Front : Back Ratio"
          value={String(kpis.frontBackRatio)}
          description={`${formatCurrency(kpis.totalFront)} / ${formatCurrency(kpis.totalBack)}`}
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. Daily Sales Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Sales Trend</CardTitle>
            <CardDescription>
              Deals sold and total gross by sale day
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyTrendData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) =>
                      `$${(v / 1000).toFixed(0)}k`
                    }
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v: number) =>
                          v >= 1000 ? formatCurrency(v) : String(v)
                        }
                      />
                    }
                  />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="deals_count"
                    name="Deals"
                    fill={CHART_COLORS.primary}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="day_total_gross"
                    name="Total Gross"
                    fill={CHART_COLORS.secondary}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 2. Gross by Salesperson (Horizontal) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gross by Salesperson</CardTitle>
            <CardDescription>
              Top performers ranked by total gross
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={grossBySalesperson}
                  layout="vertical"
                  margin={{ left: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) =>
                      `$${(v / 1000).toFixed(0)}k`
                    }
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    width={100}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v: number) => formatCurrency(v)}
                      />
                    }
                  />
                  <Bar
                    dataKey="totalGross"
                    name="Total Gross"
                    fill={CHART_COLORS.primary}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 3. Front vs Back Gross Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Front vs Back Gross Breakdown
            </CardTitle>
            <CardDescription>
              Distribution of front-end and back-end gross profit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={frontBackPie}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }: { name: string; percent: number }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {frontBackPie.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={PIE_COLORS[idx % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 4. Daily PVR Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily PVR Trend</CardTitle>
            <CardDescription>
              Average per-vehicle retailed gross by sale day
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyPvrData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) => `$${v.toLocaleString()}`}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        formatter={(v: number) => formatCurrency(v)}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="day_avg_pvr"
                    name="Avg PVR"
                    stroke={CHART_COLORS.accent}
                    strokeWidth={2}
                    dot={{ r: 4, fill: CHART_COLORS.accent }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard Table */}
      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
          <CardDescription>
            Salesperson performance ranked by total gross production
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-center">Deals</TableHead>
                <TableHead className="text-right">Front Gross</TableHead>
                <TableHead className="text-right">Back Gross</TableHead>
                <TableHead className="text-right">Total Gross</TableHead>
                <TableHead className="text-right">Avg PVR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.map((row, idx) => (
                <TableRow key={row.name}>
                  <TableCell className="font-bold text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        ROLE_BADGE_CLASSES[row.role] ?? ROLE_BADGE_CLASSES.sales
                      }
                    >
                      {row.role.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{row.deals}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(row.frontGross)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(row.backGross)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(row.totalGross)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.deals > 0 ? formatCurrency(row.avgPvr) : "\u2014"}
                  </TableCell>
                </TableRow>
              ))}
              {leaderboard.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No salesperson data available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageHeader() {
  return (
    <div className="flex items-center justify-between flex-wrap gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Performance</h1>
        <p className="text-muted-foreground">
          Analytics, charts, and salesperson leaderboard
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        <TrendingUp className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}
