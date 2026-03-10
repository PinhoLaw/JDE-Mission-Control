import { createClient } from "@/lib/supabase/server";
import {
  EventGrid,
  type EventCardData,
} from "@/components/dashboard/event-grid";

/* ═══════════════════════════════════════════════════════════
   EVENT SCORECARDS — Server Component (Data Fetching)
   Fetches all event data, transforms it into serialisable
   EventCardData[], and delegates rendering to the
   EventGrid client component (tabs, search, sort, cards).
   ═══════════════════════════════════════════════════════════ */

export async function EventScoreCards() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // 1. Get user's event memberships
  const { data: memberships } = await supabase
    .from("event_members")
    .select("event_id")
    .eq("user_id", user.id);

  const eventIds = memberships?.map((m) => m.event_id) ?? [];
  if (eventIds.length === 0) return null;

  // 2. Fetch events + KPIs + ups data in parallel
  const [eventsRes, kpisRes, metricsRes] = await Promise.all([
    supabase.from("events").select("*").in("id", eventIds),
    supabase.from("v_event_kpis").select("*").in("event_id", eventIds),
    supabase
      .from("daily_metrics")
      .select("event_id, total_ups")
      .in("event_id", eventIds),
  ]);

  const eventsRaw = eventsRes.data ?? [];
  const kpis = kpisRes.data ?? [];
  const metricsData = metricsRes.data ?? [];

  // Sort by most recent event date: end_date desc, falling back to start_date
  const events = eventsRaw.sort((a, b) => {
    const dateA = a.end_date || a.start_date || "";
    const dateB = b.end_date || b.start_date || "";
    return dateB.localeCompare(dateA);
  });

  // 3. Build lookups
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kpiMap = new Map<string, any>();
  for (const k of kpis) {
    kpiMap.set(k.event_id as string, k);
  }

  const upsMap = new Map<string, number>();
  for (const m of metricsData) {
    const eid = m.event_id as string;
    upsMap.set(eid, (upsMap.get(eid) ?? 0) + ((m.total_ups as number) ?? 0));
  }

  if (events.length === 0) return null;

  // 4. Transform into serialisable EventCardData for the client component
  const cards: EventCardData[] = events.map((event) => {
    const k = kpiMap.get(event.id);
    const totalDeals = (k?.total_deals as number) ?? 0;
    const fundedDeals = (k?.funded_deals as number) ?? 0;
    const totalGross = (k?.total_gross as number) ?? 0;
    const avgPvr = (k?.avg_pvr as number) ?? 0;
    const totalUps = upsMap.get(event.id) ?? 0;
    const closingRatio =
      totalUps > 0 ? ((totalDeals / totalUps) * 100).toFixed(0) : "—";

    return {
      id: event.id,
      name: event.name,
      dealerName: event.dealer_name,
      city: event.city,
      state: event.state,
      startDate: event.start_date,
      endDate: event.end_date,
      status: event.status,
      totalDeals,
      fundedDeals,
      totalGross,
      avgPvr,
      totalUps,
      closingRatio,
    };
  });

  // IMPROVEMENT 4 — Delegate to EventGrid client component for
  // tabs, search, sort, and the redesigned event cards.
  return <EventGrid events={cards} />;
}
