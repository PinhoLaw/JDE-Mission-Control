import { Suspense } from "react";
import Link from "next/link";
import { getLifetimeStats } from "@/lib/actions/lifetime-stats";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EventScoreCards } from "@/components/dashboard/event-scorecards";
import {
  Users,
  Car,
  DollarSign,
  Target,
  Plus,
  FileSpreadsheet,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE — Server Component
   ═══════════════════════════════════════════════════════════ */

export default async function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12">
      {/* ── Hero: Lifetime Per-Day Averages ── */}
      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection />
      </Suspense>

      {/* ── Event Scorecards (sorted by date, most recent first) ── */}
      <Suspense fallback={<ScoreCardsSkeleton />}>
        <EventScoreCards />
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
      label: "Avg Units / Day",
      value: stats.avgUnitsPerDay.toLocaleString(),
      icon: Car,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/60",
    },
    {
      label: "Avg Gross / Day",
      value: formatCurrency(stats.avgGrossPerDay),
      icon: DollarSign,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/60",
    },
    {
      label: "Avg PVR",
      value: formatCurrency(stats.avgPvr),
      icon: Target,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/60",
    },
    {
      label: "Avg Ups / Day",
      value: stats.avgUpsPerDay > 0 ? stats.avgUpsPerDay.toLocaleString() : "—",
      icon: Users,
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
          {stats.totalEvents !== 1 ? "s" : ""} &middot; {stats.totalDays} selling
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
   SKELETON LOADERS
   ═══════════════════════════════════════════════════════════ */

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

function ScoreCardsSkeleton() {
  return (
    <section>
      <Skeleton className="mb-3 h-5 w-24" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="shadow-sm">
            <CardContent className="p-5">
              <Skeleton className="mb-3 h-5 w-40" />
              <Skeleton className="mb-4 h-3 w-28" />
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <Skeleton className="h-8 w-8 rounded-md" />
                    <div>
                      <Skeleton className="mb-1 h-5 w-14" />
                      <Skeleton className="h-2.5 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
