import {
  createClient,
  isPreviewMode,
  createAdminClient,
} from "@/lib/supabase/server";
import {
  EventGrid,
  type EventCardData,
} from "@/components/dashboard/event-grid";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════
   EVENT SCORECARDS — Server Component (Data Fetching)
   Fetches all event data, transforms it into serialisable
   EventCardData[], and delegates rendering to the
   EventGrid client component (tabs, search, sort, cards).
   ═══════════════════════════════════════════════════════════ */

export async function EventScoreCards() {
  // ─── TEMPORARY PREVIEW BYPASS — DELETE AFTER REVIEW ───
  // In preview mode, use the service-role client (bypasses RLS)
  // and the owner's user ID so the dashboard shows real data.
  const preview = await isPreviewMode();
  const supabase = preview ? createAdminClient() : await createClient();
  const userId = preview
    ? "f66caa46-4a80-4d45-b329-dcb82793a2b3"
    : (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return null;
  // ─── END TEMPORARY PREVIEW BYPASS ───

  // 1. Get user's event memberships
  const { data: memberships } = await supabase
    .from("event_members")
    .select("event_id")
    .eq("user_id", userId);

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

  // ─────── TEMPORARY SERVER-RENDER PREVIEW MODE — DELETE AFTER GROK REVIEW ───────
  // In preview mode, render a PURE SERVER HTML version of the event grid
  // so tools like Grok that cannot execute client-side JS see the full design.
  // Normal logged-in users still get the interactive EventGrid client component.
  if (preview) {
    // Sort by gross descending (matching default client sort)
    const sorted = [...cards].sort((a, b) => b.totalGross - a.totalGross);
    const activeCount = sorted.filter((e) => e.status === "active").length;

    return (
      <section className="space-y-6">
        {/* Static tabs — matching the client component design */}
        <div className="inline-flex h-12 items-center justify-center rounded-lg bg-muted/60 p-1 text-muted-foreground">
          <div className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-5 sm:px-8 h-10 text-sm sm:text-base font-bold">
            Active Events
            <span className="ml-2 text-xs font-normal opacity-70">
              ({activeCount})
            </span>
          </div>
          <div className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-5 sm:px-8 h-10 text-sm sm:text-base font-bold bg-background text-foreground shadow-sm">
            All Events
            <span className="ml-2 text-xs font-normal opacity-70">
              ({sorted.length})
            </span>
          </div>
        </div>

        {/* Static search + sort row */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search events..."
              readOnly
              className="flex h-12 w-full rounded-md border border-border/50 bg-card px-3 py-2 pl-12 text-base placeholder:text-muted-foreground/60 ring-offset-background"
            />
          </div>
          <div className="relative shrink-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            >
              <path d="m3 16 4 4 4-4" />
              <path d="M7 20V4" />
              <path d="M11 4h4" />
              <path d="M11 8h7" />
              <path d="M11 12h10" />
            </svg>
            <div className="h-12 w-full sm:w-auto pl-10 pr-8 rounded-md border border-border/50 bg-card text-sm font-medium flex items-center">
              Sort by Gross
            </div>
          </div>
        </div>

        {/* Event Cards Grid — pure server HTML, pixel-matching the client design */}
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((event) => (
            <ServerEventCard key={event.id} event={event} />
          ))}
        </div>
      </section>
    );
  }
  // ─────── END TEMPORARY SERVER-RENDER PREVIEW MODE ───────

  // IMPROVEMENT 4 — Delegate to EventGrid client component for
  // tabs, search, sort, and the redesigned event cards.
  return <EventGrid events={cards} />;
}

// ─────── TEMPORARY SERVER-RENDER PREVIEW MODE — DELETE AFTER GROK REVIEW ───────
// Pure server-rendered event card that outputs the same HTML
// as the client EventCard component — no "use client" needed.

/** Format currency without cents for clean, bold display */
function previewDollars(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Format a date string for display */
function previewDate(iso: string, withYear = false): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (withYear) opts.year = "numeric";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", opts);
}

function ServerEventCard({ event }: { event: EventCardData }) {
  const location = [event.city, event.state].filter(Boolean).join(", ");

  const dateRange = event.startDate
    ? event.endDate
      ? `${previewDate(event.startDate)} - ${previewDate(event.endDate, true)}`
      : previewDate(event.startDate, true)
    : null;

  const isCompleted = event.status === "completed";
  const isActive = event.status === "active";

  const pct =
    event.totalDeals > 0
      ? event.fundedDeals > 0
        ? (event.fundedDeals / event.totalDeals) * 100
        : 100
      : 0;

  return (
    <a
      href={`/dashboard/events/${event.id}`}
      className="block group"
    >
      <Card
        className={cn(
          "h-full cursor-pointer overflow-hidden border-border/40 transition-all duration-200",
          "hover:shadow-xl hover:border-primary/50 hover:-translate-y-0.5",
        )}
      >
        <CardContent className="p-6 md:p-7 space-y-5">
          {/* TOP: Name + location + dates + status badge */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h3 className="text-lg font-bold truncate leading-tight group-hover:text-primary transition-colors">
                {event.dealerName ?? event.name}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {location && (
                  <span className="flex items-center gap-1">
                    {/* MapPin icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    {location}
                  </span>
                )}
                {dateRange && (
                  <span className="flex items-center gap-1">
                    {/* CalendarDays icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>
                    {dateRange}
                  </span>
                )}
              </div>
            </div>

            {/* Status badge — solid green for completed, pulsing blue for active */}
            <div
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border-0 shrink-0",
                isCompleted && "bg-emerald-600 text-white",
                isActive && "bg-blue-600 text-white animate-pulse",
                !isCompleted && !isActive && "bg-muted text-muted-foreground",
              )}
            >
              {event.status}
            </div>
          </div>

          {/* CENTER: MASSIVE Total Gross — the star of the card */}
          <div className="py-1">
            <p className="text-3xl sm:text-4xl font-black tracking-tight leading-none text-emerald-400">
              {previewDollars(event.totalGross)}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Total Gross
            </p>
          </div>

          {/* BELOW: Large Units Sold + clean horizontal progress bar */}
          <div className="space-y-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold leading-none">
                {event.totalDeals}
              </span>
              <span className="text-sm text-muted-foreground font-medium">
                units sold
              </span>
            </div>

            {/* Progress bar — green for completed, blue for active */}
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out",
                  isActive ? "bg-blue-500" : "bg-emerald-500",
                )}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>

            {event.fundedDeals > 0 && (
              <p className="text-[10px] text-muted-foreground/70">
                {event.fundedDeals} of {event.totalDeals} funded
              </p>
            )}
          </div>

          {/* BOTTOM: Two tiny supporting lines only */}
          <div className="flex items-center justify-between pt-3 border-t border-border/30 text-xs text-muted-foreground">
            <span>
              PVR{" "}
              <span className="font-bold text-emerald-400">
                {previewDollars(event.avgPvr)}
              </span>
            </span>
            <span>
              Close Rate{" "}
              <span className="font-bold text-foreground">
                {event.closingRatio}
                {event.closingRatio !== "\u2014" ? "%" : ""}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}
// ─────── END TEMPORARY SERVER-RENDER PREVIEW MODE ───────
