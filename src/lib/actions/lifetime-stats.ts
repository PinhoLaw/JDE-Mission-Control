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
    if (!user?.id) return empty;
    const userId = user.id;

    // Get user's event memberships
    const { data: memberships } = await supabase
      .from("event_members")
      .select("event_id")
      .eq("user_id", userId);

    const eventIds = memberships?.map((m) => m.event_id) ?? [];
    if (eventIds.length === 0) return empty;

    // Fetch only COMPLETED events — active/in-progress events shouldn't
    // dilute lifetime averages until they're finished.
    const [eventsRes, metricsRes, kpisRes] = await Promise.all([
      supabase
        .from("events")
        .select("id, start_date, end_date")
        .in("id", eventIds)
        .eq("status", "completed"),
      supabase
        .from("daily_metrics")
        .select("event_id, total_ups, total_sold, total_gross")
        .in("event_id", eventIds),
      supabase
        .from("v_event_kpis")
        .select("event_id, total_deals, total_gross")
        .in("event_id", eventIds),
    ]);

    const events = eventsRes.data ?? [];
    const completedIds = new Set(events.map((e) => e.id));
    const metrics = (metricsRes.data ?? []).filter((m) =>
      completedIds.has(m.event_id),
    );
    const kpis = (kpisRes.data ?? []).filter((k) =>
      completedIds.has(k.event_id),
    );

    if (events.length === 0) return empty;

    // ── Path 1: Events WITH real daily sales data (dashboard-created) ──
    // Only rows with total_sold > 0 count toward units/gross/days.
    // Ups-only rows (from computed closing ratios) are collected separately.
    const eventsWithSalesMetrics = new Set<string>();
    const eventsWithUps = new Set<string>();
    let dmUps = 0;
    let dmUnits = 0;
    let dmGross = 0;
    let dmDays = 0;
    let upsOnlyTotal = 0;

    for (const m of metrics) {
      const sold = (m.total_sold as number) ?? 0;
      const gross = (m.total_gross as number) ?? 0;
      const ups = (m.total_ups as number) ?? 0;

      if (sold > 0 || gross > 0) {
        // Real daily metrics row with actual sales data
        eventsWithSalesMetrics.add(m.event_id);
        if (ups > 0) eventsWithUps.add(m.event_id);
        dmUps += ups;
        dmUnits += sold;
        dmGross += gross;
        dmDays += 1;
      } else if (ups > 0) {
        // Ups-only row (computed from closing ratio for imported events)
        eventsWithUps.add(m.event_id);
        upsOnlyTotal += ups;
      }
    }

    // Build event lookup for selling day computation
    const eventMap = new Map<string, { start_date: string | null; end_date: string | null }>();
    for (const ev of events) {
      eventMap.set(ev.id, { start_date: ev.start_date, end_date: ev.end_date });
    }

    // Compute selling days ONLY for events that have ups data
    // (so avg ups/day isn't diluted by events without traffic info)
    let upsDays = 0;
    for (const eid of eventsWithUps) {
      const ev = eventMap.get(eid);
      if (ev?.start_date && ev?.end_date) {
        upsDays += countSellingDays(ev.start_date, ev.end_date);
      }
    }

    // ── Path 2: Events WITHOUT real daily sales data (spreadsheet-imported) ──
    // Use event dates to compute selling days, use KPI totals.
    // Events with ups-only rows still go through Path 2 for units/gross.
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
      // Skip events that have real daily sales metrics — handled above
      if (eventsWithSalesMetrics.has(ev.id)) continue;

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
    const totalUps = dmUps + upsOnlyTotal; // Ups from both real daily data + computed rows

    // PVR: weighted average across all deals (totalGross / totalUnits).
    // Previously this was average-of-averages which over-weights small events.
    const avgPvr = totalUnits > 0 ? totalGross / totalUnits : 0;

    return {
      avgUpsPerDay: upsDays > 0 ? Math.round(totalUps / upsDays) : 0,
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
