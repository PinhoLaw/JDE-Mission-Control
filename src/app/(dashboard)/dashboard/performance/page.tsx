"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal, RosterMember, DailySale, DailyMetric, MailTracking, UserAchievement, BadgeDef } from "@/types/database";
import { formatCurrency } from "@/lib/utils";
import { StatCard } from "@/components/ui/stat-card";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, Users, Target } from "lucide-react";
import { LoadingTableSkeleton } from "@/components/ui/loading-table-skeleton";
import { GrossPodium } from "@/components/performance/gross-podium";
import { DailySalesChart } from "@/components/performance/daily-sales-chart";
import { LeaderboardTable, type SalespersonRow } from "@/components/performance/leaderboard-table";
import { TrafficSummaryCard } from "@/components/performance/traffic-summary-card";
import { CloserLeaderboard } from "@/components/performance/closer-leaderboard";
import { FrontBackPie } from "@/components/performance/front-back-pie";
import { DailyPvrChart } from "@/components/performance/daily-pvr-chart";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------


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

// SalespersonRow type is imported from @/components/performance/leaderboard-table

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
          rosterId: s.rosterId,
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
          label="Total Deals"
          value={String(kpis.totalDeals)}
          icon={Users}
        />
        <StatCard
          label="Total Gross"
          value={formatCurrency(kpis.totalGross)}
          icon={BarChart3}
        />
        <StatCard
          label="Avg PVR"
          value={formatCurrency(kpis.avgPvr)}
          icon={TrendingUp}
        />
        <StatCard
          label="Closing Ratio"
          value={`${kpis.closingRatio}%`}
          subtitle={`${kpis.totalUps} ups / ${kpis.totalDeals} deals`}
          icon={Target}
        />
        <StatCard
          label="Front : Back Ratio"
          value={String(kpis.frontBackRatio)}
          subtitle={`${formatCurrency(kpis.totalFront)} / ${formatCurrency(kpis.totalBack)}`}
          icon={BarChart3}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DailySalesChart data={grossPerDay} overallConversion={overallConversion} />

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
                <GrossPodium entries={grossBySalesperson} />
                {grossBySalesperson.length > 3 && (
                  <div className="mt-4 space-y-4 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
                    {grossBySalesperson.slice(3).map((s, idx) => {
                      const maxGross = grossBySalesperson[0].totalGross;
                      const pct =
                        maxGross > 0 ? (s.totalGross / maxGross) * 100 : 0;
                      return (
                        <div key={s.rosterId} className="group flex items-center gap-3">
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

        <FrontBackPie data={frontBackPie} />
        <DailyPvrChart data={dailyPvrData} />
      </div>

      {/* ── Salesperson Rankings ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-tight">Salesperson Rankings</h2>
      </div>

      <CloserLeaderboard
        closerLeaderboard={closerLeaderboard}
        closerBadgeClasses={CLOSER_BADGE_CLASSES}
      />

      <LeaderboardTable
        leaderboard={leaderboard}
        achievementsByRoster={achievementsByRoster}
        roleBadgeClasses={ROLE_BADGE_CLASSES}
      />

      <TrafficSummaryCard trafficSummary={trafficSummary} />
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

