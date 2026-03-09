"use server";

import { createClient } from "@/lib/supabase/server";

export interface LifetimeStats {
  avgUpsPerDay: number;
  avgUnitsPerDay: number;
  avgGrossPerDay: number;
  avgPvr: number;
  totalEvents: number;
  totalDays: number; // total selling days across all events
}

/**
 * Count selling days between two ISO date strings (inclusive).
 * Sundays (day 0 in JS) are excluded — JDE events are typically closed Sundays.
 */
function countSellingDays(startIso: string, endIso: string): number {
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  let days = 0;
  const d = new Date(start);
  while (d <= end) {
    if (d.getUTCDay() !== 0) days++; // 0 = Sunday
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/**
 * Compute all-time lifetime averages across every event the user has access to.
 *
 * Two data paths depending on how the event was created:
 *   1. Dashboard-created events → team leader inputs daily_metrics rows.
 *      We use those actual per-day numbers directly.
 *   2. Spreadsheet-imported events → no daily_metrics rows.
 *      We compute selling days from event start/end dates (excluding Sundays)
 *      and divide v_event_kpis totals by those selling days.
 *
 * The combined per-day averages merge both pools.
 */
export async function getLifetimeStats(): Promise<LifetimeStats> {
  const empty: LifetimeStats = {
    avgUpsPerDay: 0,
    avgUnitsPerDay: 0,
    avgGrossPerDay: 0,
    avgPvr: 0,
    totalEvents: 0,
    totalDays: 0,
  };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;

    // Get user's event memberships
    const { data: memberships } = await supabase
      .from("event_members")
      .select("event_id")
      .eq("user_id", user.id);

    const eventIds = memberships?.map((m) => m.event_id) ?? [];
    if (eventIds.length === 0) return empty;

    // Fetch events, daily_metrics, and KPIs in parallel
    const [eventsRes, metricsRes, kpisRes] = await Promise.all([
      supabase
        .from("events")
        .select("id, start_date, end_date")
        .in("id", eventIds),
      supabase
        .from("daily_metrics")
        .select("event_id, total_ups, total_sold, total_gross")
        .in("event_id", eventIds),
      supabase
        .from("v_event_kpis")
        .select("event_id, total_deals, total_gross, avg_pvr")
        .in("event_id", eventIds),
    ]);

    const events = eventsRes.data ?? [];
    const metrics = metricsRes.data ?? [];
    const kpis = kpisRes.data ?? [];

    if (events.length === 0) return empty;

    // ── Path 1: Events WITH daily_metrics (dashboard-created) ──
    // Group daily_metrics by event to identify which events have daily data
    const eventsWithDailyMetrics = new Set<string>();
    let dmUps = 0;
    let dmUnits = 0;
    let dmGross = 0;
    let dmDays = 0;

    for (const m of metrics) {
      eventsWithDailyMetrics.add(m.event_id);
      dmUps += (m.total_ups as number) ?? 0;
      dmUnits += (m.total_sold as number) ?? 0;
      dmGross += (m.total_gross as number) ?? 0;
      dmDays += 1;
    }

    // ── Path 2: Events WITHOUT daily_metrics (spreadsheet-imported) ──
    // Use event dates to compute selling days, use KPI totals
    let importedUnits = 0;
    let importedGross = 0;
    let importedDays = 0;

    // Build KPI lookup
    const kpiMap = new Map<
      string,
      { total_deals: number; total_gross: number }
    >();
    for (const k of kpis) {
      kpiMap.set(k.event_id, {
        total_deals: (k.total_deals as number) ?? 0,
        total_gross: (k.total_gross as number) ?? 0,
      });
    }

    for (const ev of events) {
      // Skip events that have daily_metrics — they're handled above
      if (eventsWithDailyMetrics.has(ev.id)) continue;

      // Need valid date range to compute selling days
      if (!ev.start_date || !ev.end_date) continue;

      const sellingDays = countSellingDays(ev.start_date, ev.end_date);
      if (sellingDays <= 0) continue;

      const kpi = kpiMap.get(ev.id);
      if (kpi) {
        importedUnits += kpi.total_deals;
        importedGross += kpi.total_gross;
        importedDays += sellingDays;
      }
    }

    // ── Combine both paths ──
    const totalDays = dmDays + importedDays;
    const totalUnits = dmUnits + importedUnits;
    const totalGross = dmGross + importedGross;
    const totalUps = dmUps; // Ups only available from daily_metrics

    // PVR: average of per-event avg_pvr values (all events, not per-day)
    const pvrValues = kpis
      .map((k) => (k.avg_pvr as number) ?? 0)
      .filter((v) => v > 0);
    const avgPvr =
      pvrValues.length > 0
        ? pvrValues.reduce((s, v) => s + v, 0) / pvrValues.length
        : 0;

    return {
      avgUpsPerDay: totalDays > 0 ? Math.round(totalUps / totalDays) : 0,
      avgUnitsPerDay:
        totalDays > 0
          ? Math.round((totalUnits / totalDays) * 10) / 10
          : 0,
      avgGrossPerDay:
        totalDays > 0 ? Math.round(totalGross / totalDays) : 0,
      avgPvr: Math.round(avgPvr),
      totalEvents: eventIds.length,
      totalDays,
    };
  } catch (error) {
    console.error("[getLifetimeStats] error:", error);
    return empty;
  }
}
