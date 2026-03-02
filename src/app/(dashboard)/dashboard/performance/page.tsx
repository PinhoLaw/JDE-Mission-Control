"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal, RosterMember, DailySale, DailyMetric, UserAchievement, BadgeDef } from "@/types/database";
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
  LabelList,
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
import { BarChart3, TrendingUp, Loader2, Users, Target } from "lucide-react";
import { LoadingTableSkeleton } from "@/components/ui/loading-table-skeleton";
import { BadgeIcon } from "@/components/gamification/badge-icon";

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
  rosterId: string;
  name: string;
  role: string;
  deals: number;
  ups: number;
  closePct: number;
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
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [achievements, setAchievements] = useState<(UserAchievement & { badges: BadgeDef | null })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const loadData = useCallback(async () => {
    if (!currentEvent) return;

    setIsLoading(true);
    const supabase = createClient();

    try {
      const [dealsRes, rosterRes, dailyRes, metricsRes, achievementsRes] = await Promise.all([
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
        supabase
          .from("daily_metrics")
          .select("*")
          .eq("event_id", currentEvent.id)
          .order("sale_day", { ascending: true }),
        supabase
          .from("user_achievements")
          .select("*, badges(*)")
          .eq("event_id", currentEvent.id),
      ]);

      if (dealsRes.error) throw dealsRes.error;
      if (rosterRes.error) throw rosterRes.error;
      if (dailyRes.error) throw dailyRes.error;
      if (metricsRes.error) console.warn("daily_metrics fetch failed:", metricsRes.error);
      if (achievementsRes.error) console.warn("achievements fetch failed:", achievementsRes.error);

      setDeals(dealsRes.data ?? []);
      setRoster(rosterRes.data ?? []);
      setDailySales(dailyRes.data ?? []);
      setDailyMetrics(metricsRes.data ?? []);
      setAchievements((achievementsRes.data as any) ?? []);
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
        name: string;
        deals: number;
        ups: number;
        frontGross: number;
        backGross: number;
        totalGross: number;
        role: string;
      }
    > = {};

    // Seed from roster so everyone shows up even with zero deals (keyed by ID)
    for (const r of roster) {
      stats[r.id] = {
        name: r.name,
        deals: 0,
        ups: 0,
        frontGross: 0,
        backGross: 0,
        totalGross: 0,
        role: r.role ?? "sales",
      };
    }

    for (const deal of deals) {
      const sp = deal.salesperson;
      if (!sp) continue;
      // Use salesperson_id as key when available, fallback to name
      const key = deal.salesperson_id ?? sp;
      if (!stats[key]) {
        const rosterEntry = rosterMap.get(sp);
        stats[key] = {
          name: sp,
          deals: 0,
          ups: 0,
          frontGross: 0,
          backGross: 0,
          totalGross: 0,
          role: rosterEntry?.role ?? "sales",
        };
      }
      stats[key].deals += 1;
      stats[key].ups += deal.ups_count ?? 1;
      stats[key].frontGross += deal.front_gross ?? 0;
      stats[key].backGross += deal.back_gross ?? 0;
      stats[key].totalGross += deal.total_gross ?? 0;
    }

    return Object.entries(stats)
      .map(([key, data]) => {
        const closePct = data.ups > 0 ? (data.deals / data.ups) * 100 : 0;
        return {
          rosterId: key,
          name: data.name,
          role: data.role,
          deals: data.deals,
          ups: data.ups,
          closePct,
          frontGross: data.frontGross,
          backGross: data.backGross,
          totalGross: data.totalGross,
          avgPvr: data.deals > 0 ? data.totalGross / data.deals : 0,
        };
      })
      .sort((a, b) => b.totalGross - a.totalGross);
  }, [deals, roster, rosterMap]);

  // Summary KPIs — ups from daily_metrics (campaigns) when available
  const kpis = useMemo(() => {
    const totalDeals = deals.length;
    const totalUps =
      dailyMetrics.length > 0
        ? dailyMetrics.reduce((s, m) => s + (m.total_ups ?? 0), 0)
        : deals.reduce((s, d) => s + (d.ups_count ?? 1), 0);
    const totalGross = deals.reduce((s, d) => s + (d.total_gross ?? 0), 0);
    const totalFront = deals.reduce((s, d) => s + (d.front_gross ?? 0), 0);
    const totalBack = deals.reduce((s, d) => s + (d.back_gross ?? 0), 0);
    const avgPvr = totalDeals > 0 ? totalGross / totalDeals : 0;
    const closingRatio = totalUps > 0 ? ((totalDeals / totalUps) * 100).toFixed(0) : "N/A";
    const frontBackRatio =
      totalBack > 0 ? (totalFront / totalBack).toFixed(2) : "N/A";

    return { totalDeals, totalUps, totalGross, totalFront, totalBack, avgPvr, closingRatio, frontBackRatio };
  }, [deals, dailyMetrics]);

  // Achievements grouped by roster member for leaderboard badges column
  const achievementsByRoster = useMemo(() => {
    const map = new Map<string, { name: string; icon: string }[]>();
    for (const a of achievements) {
      if (!a.badges) continue;
      const list = map.get(a.roster_id) ?? [];
      list.push({ name: a.badges.name, icon: a.badges.icon });
      map.set(a.roster_id, list);
    }
    return map;
  }, [achievements]);

  // Chart data: Gross per Day
  // Primary source: daily_metrics (has ups, gross, sold per day)
  // Fallback: compute from individual deals when metrics aren't available
  const grossPerDay = useMemo(() => {
    if (dailyMetrics.length > 0) {
      // Use daily_metrics directly — authoritative source with ups
      return dailyMetrics.map((m) => {
        const d = m.sale_date ? new Date(m.sale_date) : null;
        const date = d
          ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
          : `Day ${m.sale_day}`;
        const sortKey = m.sale_date ?? `day-${String(m.sale_day).padStart(2, "0")}`;
        return {
          date,
          gross: m.total_gross ?? 0,
          deals: m.total_sold ?? 0,
          ups: m.total_ups ?? 0,
          sortKey,
        };
      }).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }

    // Fallback: compute from deals grouped by sale_date
    const byDate: Record<string, { gross: number; deals: number; sortKey: string }> = {};
    for (const deal of deals) {
      const raw = deal.sale_date ?? deal.created_at;
      if (!raw) continue;
      const d = new Date(raw);
      const sortKey = d.toISOString().slice(0, 10);
      const dateKey = d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      if (!byDate[dateKey]) byDate[dateKey] = { gross: 0, deals: 0, sortKey };
      byDate[dateKey].gross += deal.total_gross ?? 0;
      byDate[dateKey].deals += 1;
    }

    return Object.entries(byDate)
      .map(([date, data]) => ({ date, gross: data.gross, deals: data.deals, ups: 0, sortKey: data.sortKey }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [deals, dailyMetrics]);

  // Chart data: Gross by salesperson (top 10 for readability)
  const grossBySalesperson = useMemo(
    () =>
      leaderboard
        .filter((s) => s.totalGross > 0)
        .slice(0, 10)
        .map((s) => ({
          name: s.name,
          totalGross: s.totalGross,
          deals: s.deals,
          avgPvr: s.avgPvr,
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
    return <LoadingTableSkeleton rows={8} columns={6} />;
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
          title="Closing Ratio"
          value={`${kpis.closingRatio}%`}
          description={`${kpis.totalUps} ups / ${kpis.totalDeals} deals`}
          icon={<Target className="h-4 w-4 text-muted-foreground" />}
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
        {/* 1. Gross per Day */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gross per Day</CardTitle>
            <CardDescription>
              Total gross profit broken down by sale date
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={grossPerDay} margin={{ top: 28, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) =>
                      `$${(v / 1000).toFixed(0)}k`
                    }
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
                    dataKey="gross"
                    name="Total Gross"
                    fill={CHART_COLORS.primary}
                    radius={[4, 4, 0, 0]}
                  >
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <LabelList
                      content={(props: any) => {
                        const { x, y, width, index } = props;
                        if (x == null || y == null || width == null || index == null) return null;
                        const entry = grossPerDay[index as number];
                        if (!entry || (entry.deals + entry.ups === 0)) return null;
                        const cx = Number(x) + Number(width) / 2;
                        const cy = Number(y) - 10;
                        const label = entry.ups > 0
                          ? `${entry.deals} sold \u2022 ${entry.ups} ups`
                          : `${entry.deals} sold`;
                        return (
                          <text
                            key={`label-${index}`}
                            x={cx}
                            y={cy}
                            textAnchor="middle"
                            fontSize={10.5}
                            fontWeight={500}
                            letterSpacing={0.2}
                            className="fill-muted-foreground"
                          >
                            {label}
                          </text>
                        );
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* 2. Gross by Salesperson */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gross by Salesperson</CardTitle>
            <CardDescription>
              Top performers ranked by total gross
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[320px] overflow-y-auto pr-1 scrollbar-thin">
              <div className="space-y-4">
                {grossBySalesperson.length > 0 ? (
                  grossBySalesperson.map((s, idx) => {
                    const maxGross = grossBySalesperson[0].totalGross;
                    const pct =
                      maxGross > 0 ? (s.totalGross / maxGross) * 100 : 0;
                    return (
                      <div key={s.name} className="group flex items-center gap-3">
                        <span className="w-5 text-xs font-bold text-muted-foreground text-right shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2 mb-1.5">
                            <span
                              className="text-sm font-medium truncate"
                              title={s.name}
                            >
                              {s.name}
                            </span>
                            <div className="flex items-baseline gap-2 shrink-0">
                              <span className="text-[11px] text-muted-foreground">
                                {s.deals} deal{s.deals !== 1 ? "s" : ""}
                              </span>
                              <span className="text-sm font-bold tabular-nums">
                                {formatCurrency(s.totalGross)}
                              </span>
                            </div>
                          </div>
                          <div className="h-6 bg-muted/60 rounded-sm overflow-hidden">
                            <div
                              className="h-full rounded-sm transition-all duration-500 bg-blue-600 dark:bg-blue-500 group-hover:bg-blue-700 dark:group-hover:bg-blue-400"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No salesperson data available.
                  </p>
                )}
              </div>
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
                <TableHead className="text-center">Ups</TableHead>
                <TableHead className="text-center">Close %</TableHead>
                <TableHead className="text-right">Front Gross</TableHead>
                <TableHead className="text-right">Back Gross</TableHead>
                <TableHead className="text-right">Total Gross</TableHead>
                <TableHead className="text-right">Avg PVR</TableHead>
                <TableHead className="text-center">Badges</TableHead>
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
                  <TableCell className="text-center">{row.ups || "—"}</TableCell>
                  <TableCell className="text-center">
                    {row.ups > 0 ? (
                      <span
                        className={`font-medium ${
                          row.closePct >= 30
                            ? "text-green-600 dark:text-green-400"
                            : row.closePct >= 15
                              ? "text-yellow-600 dark:text-yellow-400"
                              : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {row.closePct.toFixed(0)}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
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
                  <TableCell className="text-center">
                    {(() => {
                      const badges = achievementsByRoster.get(row.rosterId) ?? [];
                      if (badges.length === 0) return <span className="text-muted-foreground">—</span>;
                      const shown = badges.slice(0, 4);
                      const overflow = badges.length - shown.length;
                      return (
                        <div className="flex items-center justify-center gap-1">
                          {shown.map((b, i) => (
                            <span key={i} title={b.name}>
                              <BadgeIcon name={b.icon} className="h-4 w-4 text-yellow-500" />
                            </span>
                          ))}
                          {overflow > 0 && (
                            <span className="text-xs text-muted-foreground font-medium">
                              +{overflow}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
              {leaderboard.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={11}
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
