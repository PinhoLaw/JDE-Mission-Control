import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Plus, AlertTriangle } from "lucide-react";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { RecentDealsTable } from "@/components/dashboard/recent-deals-table";
import {
  KpiCardsSkeleton,
  RecentDealsSkeleton,
  AnalyticsOverviewSkeleton,
} from "@/components/dashboard/loading-skeletons";
import { AnalyticsOverview } from "@/components/dashboard/analytics-overview";
import { CsvExportButtons } from "@/components/dashboard/csv-export-buttons";

interface DashboardPageProps {
  searchParams: Promise<{ event?: string }>;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  console.log("[DashboardPage] render start");

  let eventId: string | undefined;
  let userId: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deals: any[] = [];

  try {
    const params = await searchParams;
    const supabase = await createClient();
    console.log("[DashboardPage] createClient OK, resolving event...");

    // Check auth
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    console.log(
      "[DashboardPage] AUTH:",
      user ? `${user.email} (${user.id})` : `NO USER: ${authErr?.message}`,
    );
    userId = user?.id;

    // Resolve the event ID: URL param → first active event → first event
    eventId = params.event;
    console.log("[DashboardPage] URL event param:", eventId ?? "NONE");

    if (!eventId) {
      if (user) {
        // Get user's event memberships
        const { data: memberships, error: memErr } = await supabase
          .from("event_members")
          .select("event_id")
          .eq("user_id", user.id);

        console.log(
          "[DashboardPage] memberships:",
          memberships?.length ?? 0,
          memErr ? `ERROR: ${memErr.message}` : "",
          memberships?.map((m) => m.event_id),
        );

        if (memberships && memberships.length > 0) {
          const ids = memberships.map((m) => m.event_id);
          const { data: events, error: evErr } = await supabase
            .from("events")
            .select("id, status")
            .in("id", ids)
            .order("created_at", { ascending: false });

          console.log(
            "[DashboardPage] events for memberships:",
            events?.length ?? 0,
            evErr ? `ERROR: ${evErr.message}` : "",
            events?.map((e) => `${e.id} (${e.status})`),
          );

          if (events && events.length > 0) {
            const active = events.find((e) => e.status === "active");
            eventId = active?.id ?? events[0].id;
          }
        } else {
          // Fallback for users without memberships
          const { data: events } = await supabase
            .from("events")
            .select("id, status")
            .order("created_at", { ascending: false })
            .limit(1);

          console.log("[DashboardPage] fallback events:", events?.length ?? 0);

          if (events && events.length > 0) {
            eventId = events[0].id;
          }
        }
      }
    }

    console.log("[DashboardPage] RESOLVED eventId:", eventId ?? "NONE");

    if (!eventId) {
      return <NoEventState />;
    }

    // Fetch event details + recent deals in parallel
    const [eventRes, dealsRes] = await Promise.all([
      supabase.from("events").select("*").eq("id", eventId).single(),
      supabase
        .from("sales_deals")
        .select(
          "id, deal_number, sale_day, stock_number, customer_name, vehicle_year, vehicle_make, vehicle_model, salesperson, lender, front_gross, back_gross, total_gross, new_used, status, created_at",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false }),
    ]);

    if (eventRes.error) {
      console.warn("[DashboardPage] events query error:", eventRes.error.message);
    }
    if (dealsRes.error) {
      console.warn("[DashboardPage] deals query error:", dealsRes.error.message);
    }

    event = eventRes.data;
    deals = dealsRes.data ?? [];
  } catch (error) {
    console.error("[DashboardPage] CRASH:", error);
    return <ErrorState message={error instanceof Error ? error.message : "Failed to load dashboard"} />;
  }

  if (!eventId) {
    return <NoEventState />;
  }

  const locationLine = event
    ? [event.city, event.state, event.zip].filter(Boolean).join(", ")
    : "";

  const subtitle = event
    ? [
        locationLine,
        event.franchise,
        event.sale_days ? `${event.sale_days} sale days` : null,
      ]
        .filter(Boolean)
        .join(" • ")
    : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {event?.dealer_name ?? event?.name ?? "Mission Control"}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButtons eventId={eventId} />
          <Button asChild size="sm">
            <Link href="/dashboard/events/new">
              <Plus className="h-4 w-4" />
              New Event
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards with Suspense */}
      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiCards eventId={eventId} />
      </Suspense>

      {/* Analytics Overview */}
      {userId && (
        <Suspense fallback={<AnalyticsOverviewSkeleton />}>
          <AnalyticsOverview userId={userId} />
        </Suspense>
      )}

      {/* Recent Deals with Suspense */}
      <Suspense fallback={<RecentDealsSkeleton />}>
        <RecentDealsTable deals={deals} eventId={eventId} />
      </Suspense>
    </div>
  );
}

function NoEventState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h2 className="text-2xl font-bold mb-2">No Events Yet</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        Create your first event to start tracking inventory, deals, and
        performance.
      </p>
      <Button asChild>
        <Link href="/dashboard/events/new">
          <Plus className="h-4 w-4" />
          Create Your First Event
        </Link>
      </Button>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
      <h2 className="text-2xl font-bold mb-2">Dashboard Error</h2>
      <p className="text-muted-foreground mb-6 max-w-md text-sm">{message}</p>
      <Button asChild variant="outline">
        <Link href="/api/health">Check System Health</Link>
      </Button>
    </div>
  );
}
