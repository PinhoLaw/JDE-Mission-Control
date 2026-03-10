import { Suspense } from "react";
import Link from "next/link";
import { getLifetimeStats } from "@/lib/actions/lifetime-stats";
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
   "So easy a caveman could do it"
   ═══════════════════════════════════════════════════════════ */

export default async function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-12 pb-16">
      {/* HERO ROW — IMPROVEMENT 1 */}
      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection />
      </Suspense>

      {/* EVENT CARDS — IMPROVEMENT 2 + IMPROVEMENT 4 (tabs/search/sort inside) */}
      <Suspense fallback={<ScoreCardsSkeleton />}>
        <EventScoreCards />
      </Suspense>

      {/* Quick Start */}
      <QuickStartRow />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HERO ROW — IMPROVEMENT 1
   Massive hero cards with huge numbers, large icons,
   generous breathing room, and instant scannability.
   ═══════════════════════════════════════════════════════════ */

import { formatCurrencyNoCents } from "@/lib/utils";

async function HeroSection() {
  const stats = await getLifetimeStats();

  const metrics = [
    {
      label: "Units / Day",
      value: stats.avgUnitsPerDay.toLocaleString(),
      icon: Car,
      iconBg: "bg-blue-500/20",
      iconColor: "text-blue-400",
      valueColor: "text-foreground",
    },
    {
      label: "Gross / Day",
      value: formatCurrencyNoCents(stats.avgGrossPerDay),
      icon: DollarSign,
      iconBg: "bg-emerald-500/20",
      iconColor: "text-emerald-400",
      // IMPROVEMENT 3 — strong green for money
      valueColor: "text-emerald-400",
    },
    {
      label: "Avg PVR",
      value: formatCurrencyNoCents(stats.avgPvr),
      icon: Target,
      iconBg: "bg-emerald-500/20",
      iconColor: "text-emerald-400",
      // IMPROVEMENT 3 — strong green for money
      valueColor: "text-emerald-400",
    },
    {
      label: "Ups / Day",
      value:
        stats.avgUpsPerDay > 0 ? stats.avgUpsPerDay.toLocaleString() : "—",
      icon: Users,
      iconBg: "bg-violet-500/20",
      iconColor: "text-violet-400",
      valueColor: "text-foreground",
    },
  ];

  return (
    <section>
      {/* Title block with generous spacing */}
      <div className="mb-10">
        <h1 className="text-4xl font-black tracking-tight md:text-5xl">
          Mission Control
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Lifetime averages across{" "}
          <span className="font-semibold text-foreground">
            {stats.totalEvents} events
          </span>
          {" · "}
          <span className="font-semibold text-foreground">
            {stats.totalDays} selling days
          </span>
        </p>
      </div>

      {/* IMPROVEMENT 1 — Massive metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        {metrics.map((m) => (
          <Card
            key={m.label}
            className="border-0 shadow-lg bg-card/90 backdrop-blur-sm"
          >
            <CardContent className="flex flex-col items-center text-center gap-4 p-6 md:p-8 lg:p-10">
              {/* Large icon in tinted circle */}
              <div className={`rounded-2xl p-3.5 md:p-4 ${m.iconBg}`}>
                <m.icon
                  className={`h-7 w-7 md:h-9 md:w-9 ${m.iconColor}`}
                  strokeWidth={2.5}
                />
              </div>

              {/* MASSIVE number — the hero of each card */}
              <p
                className={`text-3xl sm:text-4xl md:text-5xl lg:text-6xl 2xl:text-7xl font-black tracking-tight leading-none ${m.valueColor}`}
              >
                {m.value}
              </p>

              {/* Clean one-line label */}
              <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {m.label}
              </p>
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
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
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
   SKELETON LOADERS (updated for new caveman layout)
   ═══════════════════════════════════════════════════════════ */

function HeroSkeleton() {
  return (
    <section>
      <Skeleton className="mb-2 h-12 w-72" />
      <Skeleton className="mb-10 h-5 w-52" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="border-0 shadow-lg">
            <CardContent className="flex flex-col items-center gap-4 p-6 md:p-8 lg:p-10">
              <Skeleton className="h-16 w-16 rounded-2xl" />
              <Skeleton className="h-14 w-32" />
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ScoreCardsSkeleton() {
  return (
    <section className="space-y-6">
      <Skeleton className="h-12 w-72 rounded-md" />
      <div className="flex flex-col sm:flex-row gap-3">
        <Skeleton className="h-12 flex-1 rounded-md" />
        <Skeleton className="h-12 w-48 rounded-md" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-6 space-y-5">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-12 w-44" />
              <Skeleton className="h-2 w-full rounded-full" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
