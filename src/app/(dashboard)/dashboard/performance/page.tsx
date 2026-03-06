"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal, RosterMember, DailySale, DailyMetric, MailTracking, UserAchievement, BadgeDef } from "@/types/database";
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
  ComposedChart,
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
import { BarChart3, TrendingUp, Loader2, Users, Target, Activity, MapPin } from "lucide-react";
import { LoadingTableSkeleton } from "@/components/ui/loading-table-skeleton";
import { BadgeIcon } from "@/components/gamification/badge-icon";
import { GrossPodium } from "@/components/performance/gross-podium";
import { motion } from "framer-motion";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_COLORS = {
  primary: "#2563eb",
  secondary: "#16a34a",
  accent: "#f59e0b",
} as const;

const PIE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6"];

const CLOSER_ROLE_COLORS: Record<string, string> = {
  sales: "border-blue-400/60",
  team_leader: "border-purple-400/60",
  fi_manager: "border-green-400/60",
  closer: "border-orange-400/60",
  manager: "border-red-400/60",
  home_team: "border-sky-400/60",
};

const CLOSER_BADGE_CLASSES: Record<string, string> = {
  sales: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  team_leader: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  fi_manager: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  closer: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  manager: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  home_team: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

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
// Custom combo-chart tooltip (Daily Sales & Traffic)
// ---------------------------------------------------------------------------

function ComboTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const sold = payload.find((p) => p.dataKey === "deals")?.value ?? 0;
  const ups = payload.find((p) => p.dataKey === "ups")?.value ?? 0;
  const convRate = ups > 0 ? ((sold / ups) * 100).toFixed(1) : "—";

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md min-w-[160px]">
      <p className="mb-1.5 font-medium text-popover-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
        <span className="text-muted-foreground">Cars Sold:</span>
        <span className="font-medium text-popover-foreground">{sold}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#93c5fd" }} />
        <span className="text-muted-foreground">Visits:</span>
        <span className="font-medium text-popover-foreground">{ups}</span>
      </div>
      <div className="mt-1.5 border-t pt-1.5 flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Conversion:</span>
        <span className="font-semibold text-popover-foreground text-xs">{convRate}%</span>
      </div>
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
  const [mailTracking, setMailTracking] = useState<MailTracking[]>([]);
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
      const [dealsRes, rosterRes, dailyRes, metricsRes, mailRes, achievementsRes] = await Promise.all([
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
          .from("mail_tracking")
          .select("*")
          .eq("event_id", currentEvent.id)
          .order("pieces_sent", { ascending: false }),
        supabase
          .from("user_achievements")
          .select("*, badges(*)")
          .eq("event_id", currentEvent.id),
      ]);

      if (dealsRes.error) throw dealsRes.error;
      if (rosterRes.error) throw rosterRes.error;
      if (dailyRes.error) throw dailyRes.error;
      if (metricsRes.error) console.warn("daily_metrics fetch failed:", metricsRes.error);
      if (mailRes.error) console.warn("mail_tracking fetch failed:", mailRes.error);
      if (achievementsRes.error) console.warn("achievements fetch failed:", achievementsRes.error);

      setDeals(dealsRes.data ?? []);
      setRoster(rosterRes.data ?? []);
      setDailySales(dailyRes.data ?? []);
      setDailyMetrics(metricsRes.data ?? []);
      setMailTracking(mailRes.data ?? []);
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
      stats[key].ups += deal.ups_count ?? 0;
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
        : deals.reduce((s, d) => s + (d.ups_count ?? 0), 0);
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

  // Chart data: Daily Sales & Traffic
  // Primary source: daily_metrics (has ups, gross, sold per day)
  // Fallback: compute from individual deals when metrics aren't available
  const grossPerDay = useMemo(() => {
    if (dailyMetrics.length > 0) {
      // Use daily_metrics directly — authoritative source with ups
      return dailyMetrics.map((m) => {
        const d = m.sale_date ? new Date(m.sale_date + "T12:00:00") : null;
        const date = d
          ? `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`
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
      const dateKey = `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
      if (!byDate[dateKey]) byDate[dateKey] = { gross: 0, deals: 0, sortKey };
      byDate[dateKey].gross += deal.total_gross ?? 0;
      byDate[dateKey].deals += 1;
    }

    return Object.entries(byDate)
      .map(([date, data]) => ({ date, gross: data.gross, deals: data.deals, ups: 0, sortKey: data.sortKey }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [deals, dailyMetrics]);

  // Aggregate conversion rate across all days
  const overallConversion = useMemo(() => {
    const totalSold = grossPerDay.reduce((s, d) => s + d.deals, 0);
    const totalUps = grossPerDay.reduce((s, d) => s + d.ups, 0);
    return totalUps > 0 ? ((totalSold / totalUps) * 100).toFixed(1) : null;
  }, [grossPerDay]);

  // Traffic summary — aggregated stats from daily_metrics + mail_tracking
  const trafficSummary = useMemo(() => {
    const totalUps = kpis.totalUps;
    const totalSold = kpis.totalDeals;
    const saleDays = dailyMetrics.length || grossPerDay.length || 1;
    const closeRate = totalUps > 0 ? ((totalSold / totalUps) * 100).toFixed(1) : null;
    const upsPerDay = totalUps > 0 ? (totalUps / saleDays).toFixed(1) : null;

    // Zip breakdown from mail_tracking (campaign data)
    const zipBreakdown = mailTracking
      .filter((m) => m.total_responses > 0)
      .map((m) => ({
        zip: m.zip_code,
        town: m.town,
        ups: m.total_responses,
        piecesSent: m.pieces_sent,
        sold: m.sold_from_mail ?? 0,
        responseRate: m.response_rate ? `${(m.response_rate * 100).toFixed(1)}%` : "—",
      }))
      .sort((a, b) => b.ups - a.ups);

    const totalMailUps = zipBreakdown.reduce((s, z) => s + z.ups, 0);

    return { totalUps, totalSold, saleDays, closeRate, upsPerDay, zipBreakdown, totalMailUps };
  }, [kpis, dailyMetrics, grossPerDay, mailTracking]);

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

  // Closer leaderboard: aggregate by closer name
  const closerLeaderboard = useMemo(() => {
    const stats: Record<string, { closes: number; totalGross: number; role: string }> = {};
    for (const deal of deals) {
      const closer = deal.closer;
      if (!closer) continue;
      if (!stats[closer]) {
        const role = closer === "Home Team" ? "home_team" : (rosterMap.get(closer)?.role ?? "sales");
        stats[closer] = { closes: 0, totalGross: 0, role };
      }
      stats[closer].closes += 1;
      stats[closer].totalGross += deal.total_gross ?? 0;
    }
    return Object.entries(stats)
      .map(([name, data]) => ({
        name,
        totalGross: data.totalGross,
        deals: data.closes,
        avgPvr: data.closes > 0 ? data.totalGross / data.closes : 0,
        role: data.role,
      }))
      .sort((a, b) => b.deals - a.deals || b.totalGross - a.totalGross);
  }, [deals, rosterMap]);

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
        {/* 1. Daily Sales & Traffic — combo chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Sales &amp; Traffic</CardTitle>
            <CardDescription>
              Units sold vs customer visits per sale day
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={grossPerDay} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  {/* Left Y — units sold (bars) */}
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    allowDecimals={false}
                    className="fill-muted-foreground"
                    label={{
                      value: "Units Sold",
                      angle: -90,
                      position: "insideLeft",
                      offset: 10,
                      style: { fontSize: 11, fill: "var(--muted-foreground)" },
                    }}
                  />
                  {/* Right Y — visits/ups (line) */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    allowDecimals={false}
                    className="fill-muted-foreground"
                    label={{
                      value: "Visits",
                      angle: 90,
                      position: "insideRight",
                      offset: 10,
                      style: { fontSize: 11, fill: "var(--muted-foreground)" },
                    }}
                  />
                  <Tooltip content={<ComboTooltipContent />} />
                  <Legend
                    verticalAlign="top"
                    height={28}
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="deals"
                    name="Cars Sold"
                    fill="#3b82f6"
                    fillOpacity={0.85}
                    radius={[4, 4, 0, 0]}
                    barSize={32}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="ups"
                    name="Visits"
                    stroke="#93c5fd"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#93c5fd", stroke: "#93c5fd" }}
                    activeDot={{ r: 6 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Conversion rate insight */}
            {overallConversion && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                <Target className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{overallConversion}%</span> overall conversion rate
                  {grossPerDay.length >= 2 && (() => {
                    const half = Math.ceil(grossPerDay.length / 2);
                    const first = grossPerDay.slice(0, half);
                    const second = grossPerDay.slice(half);
                    const firstUps = first.reduce((s, d) => s + d.ups, 0);
                    const secondUps = second.reduce((s, d) => s + d.ups, 0);
                    const firstSold = first.reduce((s, d) => s + d.deals, 0);
                    const secondSold = second.reduce((s, d) => s + d.deals, 0);
                    if (firstUps === 0 || secondUps === 0) return null;
                    const earlyPct = ((firstSold / firstUps) * 100).toFixed(1);
                    const latePct = ((secondSold / secondUps) * 100).toFixed(1);
                    return (
                      <span className="ml-1">
                        — Early {earlyPct}% vs Late {latePct}%
                      </span>
                    );
                  })()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Gross by Salesperson — Podium + remaining */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gross by Salesperson</CardTitle>
            <CardDescription>
              Top performers ranked by total gross
            </CardDescription>
          </CardHeader>
          <CardContent>
            {grossBySalesperson.length > 0 ? (
              <>
                {/* Podium: top 3 */}
                <GrossPodium entries={grossBySalesperson} />

                {/* 4th place and below — unchanged bar style */}
                {grossBySalesperson.length > 3 && (
                  <div className="mt-4 space-y-4 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
                    {grossBySalesperson.slice(3).map((s, idx) => {
                      const maxGross = grossBySalesperson[0].totalGross;
                      const pct =
                        maxGross > 0 ? (s.totalGross / maxGross) * 100 : 0;
                      return (
                        <div key={s.name} className="group flex items-center gap-3">
                          <span className="w-5 text-xs font-bold text-muted-foreground text-right shrink-0">
                            {idx + 4}
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
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No salesperson data available.
              </p>
            )}
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

      {/* Traffic Summary */}
      {trafficSummary.totalUps > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-blue-500" />
              Traffic Summary
            </CardTitle>
            <CardDescription>
              Event-level ups, conversion, and zone breakdown
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* KPI row */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">Total Ups</p>
                <p className="text-2xl font-bold tabular-nums">{trafficSummary.totalUps.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">Total Sold</p>
                <p className="text-2xl font-bold tabular-nums">{trafficSummary.totalSold.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">Close Rate</p>
                <p className="text-2xl font-bold tabular-nums">
                  {trafficSummary.closeRate ?? "N/A"}
                  {trafficSummary.closeRate && <span className="text-sm font-normal text-muted-foreground">%</span>}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">Ups / Sale Day</p>
                <p className="text-2xl font-bold tabular-nums">{trafficSummary.upsPerDay ?? "N/A"}</p>
                <p className="text-[11px] text-muted-foreground">{trafficSummary.saleDays} sale day{trafficSummary.saleDays !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Per-salesperson close rates (from deal-level ups) */}
            {leaderboard.some((r) => r.ups > 0) && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Close Rate by Salesperson</h4>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {leaderboard
                    .filter((r) => r.deals > 0)
                    .map((row) => (
                      <div
                        key={row.rosterId}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{row.name}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 tabular-nums text-sm">
                          <span className="text-muted-foreground">
                            {row.deals}/{row.ups || "—"}
                          </span>
                          <span
                            className={`font-semibold ${
                              row.closePct >= 30
                                ? "text-green-600 dark:text-green-400"
                                : row.closePct >= 15
                                  ? "text-yellow-600 dark:text-yellow-400"
                                  : row.ups > 0
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-muted-foreground"
                            }`}
                          >
                            {row.ups > 0 ? `${row.closePct.toFixed(0)}%` : "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Close rate = deals ÷ ups per salesperson. Ups attributed from deal log (ups_count field).
                </p>
              </div>
            )}

            {/* Zip / Mail Zone breakdown */}
            {trafficSummary.zipBreakdown.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  Ups by Zip / Mail Zone
                </h4>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Zip</TableHead>
                        <TableHead>Town</TableHead>
                        <TableHead className="text-right">Pieces Sent</TableHead>
                        <TableHead className="text-right">Ups</TableHead>
                        <TableHead className="text-right">Sold</TableHead>
                        <TableHead className="text-right">Response Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trafficSummary.zipBreakdown.map((z) => (
                        <TableRow key={z.zip}>
                          <TableCell className="font-mono text-sm">{z.zip}</TableCell>
                          <TableCell className="text-muted-foreground">{z.town || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{z.piecesSent.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{z.ups.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{z.sold}</TableCell>
                          <TableCell className="text-right tabular-nums">{z.responseRate}</TableCell>
                        </TableRow>
                      ))}
                      {/* Totals row */}
                      <TableRow className="border-t-2 font-semibold">
                        <TableCell colSpan={2}>Total</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {trafficSummary.zipBreakdown.reduce((s, z) => s + z.piecesSent, 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {trafficSummary.totalMailUps.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {trafficSummary.zipBreakdown.reduce((s, z) => s + z.sold, 0)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Closes by Closer */}
      {closerLeaderboard.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Closes by Closer</CardTitle>
            <CardDescription>
              Ranked by number of deals closed
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Podium: top 3 closers */}
            <GrossPodium entries={closerLeaderboard} />

            {/* 4th place and below */}
            {closerLeaderboard.length > 3 && (
              <div className="mt-4 space-y-3 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
                {closerLeaderboard.slice(3).map((c, idx) => (
                  <motion.div
                    key={c.name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * idx }}
                    className="flex items-center gap-3"
                  >
                    <span className="w-5 text-xs font-bold text-muted-foreground text-right shrink-0">
                      {idx + 4}
                    </span>
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{c.name}</span>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-1.5 py-0 shrink-0 ${CLOSER_BADGE_CLASSES[c.role] ?? CLOSER_BADGE_CLASSES.sales}`}
                        >
                          {c.role.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex items-baseline gap-2 shrink-0">
                        <span className="text-[11px] text-muted-foreground">
                          {c.deals} close{c.deals !== 1 ? "s" : ""}
                        </span>
                        <span className="text-sm font-bold tabular-nums">
                          {formatCurrency(c.totalGross)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
