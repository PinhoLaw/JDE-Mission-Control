import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLifetimeStats } from "@/lib/actions/lifetime-stats";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Car,
  DollarSign,
  Target,
  Plus,
  FileSpreadsheet,
  ArrowRight,
  Handshake,
  TrendingUp,
  MapPin,
  CalendarDays,
  AlertTriangle,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE — Server Component
   ═══════════════════════════════════════════════════════════ */

export default async function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12">
      {/* ── Hero: Lifetime Averages ── */}
      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection />
      </Suspense>

      {/* ── Active Event Spotlight ── */}
      <Suspense fallback={<SpotlightSkeleton />}>
        <ActiveEventSpotlight />
      </Suspense>

      {/* ── Quick Start ── */}
      <QuickStartRow />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HERO — All-Time Lifetime Averages
   ═══════════════════════════════════════════════════════════ */

async function HeroSection() {
  const stats = await getLifetimeStats();

  const metrics = [
    {
      label: "Avg Ups / Day",
      value: stats.avgUpsPerDay.toLocaleString(),
      icon: Users,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/60",
    },
    {
      label: "Avg Units / Day",
      value: stats.avgUnitsPerDay.toLocaleString(),
      icon: Car,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/60",
    },
    {
      label: "Avg Gross / Day",
      value: formatCurrency(stats.avgGrossPerDay),
      icon: DollarSign,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/60",
    },
    {
      label: "Avg PVR",
      value: formatCurrency(stats.avgPvr),
      icon: Target,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-50 dark:bg-violet-950/60",
    },
  ];

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Mission Control
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All-time averages across {stats.totalEvents} event
          {stats.totalEvents !== 1 ? "s" : ""} &middot; {stats.totalDays} sale
          day{stats.totalDays !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card
            key={m.label}
            className="border-0 shadow-sm bg-card/80 backdrop-blur-sm"
          >
            <CardContent className="flex flex-col items-start gap-3 p-5 md:p-6">
              <div className={`rounded-lg p-2.5 ${m.bg}`}>
                <m.icon className={`h-5 w-5 ${m.color}`} />
              </div>
              <div>
                <p className="text-3xl font-bold tracking-tight md:text-4xl">
                  {m.value}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {m.label}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   ACTIVE EVENT SPOTLIGHT
   ═══════════════════════════════════════════════════════════ */

const statusStyle: Record<string, string> = {
  active:
    "bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300",
  draft:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-300",
  completed:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
};

async function ActiveEventSpotlight() {
  let eventId: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let kpi: any = null;
  let totalUps = 0;
  let saleDays = 0;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return <NoEventState />;

    // Resolve most recent active event
    const { data: memberships } = await supabase
      .from("event_members")
      .select("event_id")
      .eq("user_id", user.id);

    const ids = memberships?.map((m) => m.event_id) ?? [];
    if (ids.length === 0) return <NoEventState />;

    const { data: events } = await supabase
      .from("events")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });

    if (!events || events.length === 0) return <NoEventState />;

    const active = events.find((e) => e.status === "active");
    event = active ?? events[0];
    eventId = event.id as string;

    const resolvedId = eventId;

    // Fetch KPIs + daily metrics for this event
    const [kpiRes, metricsRes] = await Promise.all([
      supabase
        .from("v_event_kpis")
        .select("*")
        .eq("event_id", resolvedId)
        .maybeSingle(),
      supabase
        .from("daily_metrics")
        .select("total_ups")
        .eq("event_id", resolvedId),
    ]);

    kpi = kpiRes.data;
    const metrics = metricsRes.data ?? [];
    totalUps = metrics.reduce(
      (s, m) => s + ((m.total_ups as number) ?? 0),
      0,
    );
    saleDays = metrics.length;
  } catch (error) {
    console.error("[ActiveEventSpotlight] error:", error);
    return <ErrorState message="Could not load active event" />;
  }

  if (!event || !eventId) return <NoEventState />;

  const totalDeals = (kpi?.total_deals as number) ?? 0;
  const totalGross = (kpi?.total_gross as number) ?? 0;
  const avgPvr = (kpi?.avg_pvr as number) ?? 0;
  const closingPct =
    totalUps > 0 ? ((totalDeals / totalUps) * 100).toFixed(0) : "—";

  const location = [event.city, event.state].filter(Boolean).join(", ");
  const dateRange = event.start_date
    ? event.end_date
      ? `${fmt(event.start_date)} – ${fmt(event.end_date)}`
      : fmt(event.start_date)
    : null;

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Active Event
      </h2>

      <Card className="overflow-hidden border shadow-sm">
        <CardContent className="p-0">
          {/* Top: event name + metadata */}
          <div className="flex flex-col gap-3 border-b p-5 md:flex-row md:items-center md:justify-between md:p-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h3 className="truncate text-xl font-bold md:text-2xl">
                  {event.dealer_name ?? event.name}
                </h3>
                <Badge
                  variant="secondary"
                  className={`shrink-0 text-[11px] font-medium ${statusStyle[event.status] ?? ""}`}
                >
                  {event.status}
                </Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {location}
                  </span>
                )}
                {dateRange && (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {dateRange}
                  </span>
                )}
                {saleDays > 0 && (
                  <span className="text-xs">
                    {saleDays} day{saleDays !== 1 ? "s" : ""} tracked
                  </span>
                )}
              </div>
            </div>

            <Button asChild variant="default" className="shrink-0">
              <Link href={`/dashboard/events/${eventId}/recap`}>
                View Full Recap
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Bottom: KPI row */}
          <div className="grid grid-cols-2 divide-y md:grid-cols-4 md:divide-x md:divide-y-0">
            <Stat
              icon={Handshake}
              value={totalDeals.toString()}
              label="Units Sold"
              color="text-blue-600 dark:text-blue-400"
              bg="bg-blue-50 dark:bg-blue-950/60"
            />
            <Stat
              icon={DollarSign}
              value={formatCurrency(totalGross)}
              label="Total Gross"
              color="text-emerald-600 dark:text-emerald-400"
              bg="bg-emerald-50 dark:bg-emerald-950/60"
            />
            <Stat
              icon={Target}
              value={formatCurrency(avgPvr)}
              label="Avg PVR"
              color="text-violet-600 dark:text-violet-400"
              bg="bg-violet-50 dark:bg-violet-950/60"
            />
            <Stat
              icon={TrendingUp}
              value={`${closingPct}${closingPct !== "—" ? "%" : ""}`}
              label={`Close Rate · ${totalUps} ups`}
              color="text-amber-600 dark:text-amber-400"
              bg="bg-amber-50 dark:bg-amber-950/60"
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   QUICK START ROW
   ═══════════════════════════════════════════════════════════ */

function QuickStartRow() {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Quick Start
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Button
          asChild
          size="lg"
          className="h-14 text-base font-semibold shadow-sm"
        >
          <Link href="/dashboard/deals/new">
            <Plus className="mr-2 h-5 w-5" />
            Create New Sale
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="h-14 text-base font-semibold shadow-sm"
        >
          <Link href="/dashboard/inventory/import">
            <FileSpreadsheet className="mr-2 h-5 w-5" />
            Import Old Spreadsheet
          </Link>
        </Button>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════ */

function Stat({
  icon: Icon,
  value,
  label,
  color,
  bg,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 md:p-5">
      <div className={`rounded-lg p-2 ${bg}`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <p className="text-lg font-bold leading-tight md:text-xl">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ── Empty / Error States ── */

function NoEventState() {
  return (
    <section className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <h2 className="text-xl font-bold">No Events Yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create your first event to start tracking.
      </p>
      <Button asChild className="mt-5">
        <Link href="/dashboard/events/new">
          <Plus className="mr-2 h-4 w-4" />
          Create First Event
        </Link>
      </Button>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
      <h2 className="text-xl font-bold">Something went wrong</h2>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </section>
  );
}

/* ── Skeleton Loaders ── */

function HeroSkeleton() {
  return (
    <section>
      <Skeleton className="mb-2 h-10 w-56" />
      <Skeleton className="mb-6 h-4 w-40" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-5 md:p-6">
              <Skeleton className="mb-3 h-10 w-10 rounded-lg" />
              <Skeleton className="mb-2 h-9 w-24" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SpotlightSkeleton() {
  return (
    <section>
      <Skeleton className="mb-3 h-3 w-24" />
      <Card className="overflow-hidden shadow-sm">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b p-6">
            <div>
              <Skeleton className="mb-2 h-7 w-56" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-10 w-36 rounded-md" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-5">
                <Skeleton className="mb-2 h-6 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
