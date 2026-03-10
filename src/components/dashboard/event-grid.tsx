"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  ArrowDownWideNarrow,
  MapPin,
  CalendarDays,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

export interface EventCardData {
  id: string;
  name: string;
  dealerName: string | null;
  city: string | null;
  state: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  totalDeals: number;
  fundedDeals: number;
  totalGross: number;
  avgPvr: number;
  totalUps: number;
  closingRatio: string;
}

type SortOption = "gross" | "units" | "date" | "name";

/* ═══════════════════════════════════════════════════════════
   IMPROVEMENT 4 — Caveman-Friendly Controls
   Two large tabs, prominent search bar, sort dropdown,
   and the event card grid. All client-side interactivity.
   ═══════════════════════════════════════════════════════════ */

export function EventGrid({ events }: { events: EventCardData[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("gross");
  const [tab, setTab] = useState("all");

  const activeEvents = useMemo(
    () => events.filter((e) => e.status === "active"),
    [events],
  );

  const filteredEvents = useMemo(() => {
    let list = tab === "active" ? activeEvents : events;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          (e.dealerName || e.name).toLowerCase().includes(q) ||
          (e.city || "").toLowerCase().includes(q) ||
          (e.state || "").toLowerCase().includes(q),
      );
    }

    return [...list].sort((a, b) => {
      switch (sort) {
        case "gross":
          return b.totalGross - a.totalGross;
        case "units":
          return b.totalDeals - a.totalDeals;
        case "date":
          return (b.endDate || b.startDate || "").localeCompare(
            a.endDate || a.startDate || "",
          );
        case "name":
          return (a.dealerName || a.name).localeCompare(
            b.dealerName || b.name,
          );
        default:
          return 0;
      }
    });
  }, [events, activeEvents, search, sort, tab]);

  return (
    <section className="space-y-6">
      {/* ── IMPROVEMENT 4: Large tabs directly under hero ── */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-12 p-1 bg-muted/60">
          <TabsTrigger
            value="active"
            className="h-10 px-5 sm:px-8 text-sm sm:text-base font-bold"
          >
            Active Events
            <span className="ml-2 text-xs font-normal opacity-70">
              ({activeEvents.length})
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="all"
            className="h-10 px-5 sm:px-8 text-sm sm:text-base font-bold"
          >
            All Events
            <span className="ml-2 text-xs font-normal opacity-70">
              ({events.length})
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ── IMPROVEMENT 4: Prominent search + sort row ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 pl-12 text-base bg-card border-border/50 placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="relative shrink-0">
          <ArrowDownWideNarrow className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="h-12 w-full sm:w-auto pl-10 pr-8 rounded-md border border-border/50 bg-card text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          >
            <option value="gross">Sort by Gross ↓</option>
            <option value="units">Sort by Units ↓</option>
            <option value="date">Sort by Date ↓</option>
            <option value="name">Sort by Name A→Z</option>
          </select>
        </div>
      </div>

      {/* ── Event Cards Grid ── */}
      {filteredEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 py-20 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            No events found
          </p>
          {search && (
            <p className="mt-1 text-sm text-muted-foreground/70">
              Try a different search term
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   EVENT CARD — IMPROVEMENT 2
   Ruthlessly simplified layout:
     Top:    name + location + dates + status badge
     Center: MASSIVE Total Gross (the star of the card)
     Below:  Large Units Sold + horizontal progress bar
     Bottom: Two tiny lines — PVR and close rate
   All clutter removed. Instantly scannable.
   ═══════════════════════════════════════════════════════════ */

/** Format currency without cents for clean, bold display */
function dollars(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Format a date string for display */
function fmtDate(iso: string, withYear = false): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (withYear) opts.year = "numeric";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", opts);
}

function EventCard({ event }: { event: EventCardData }) {
  const location = [event.city, event.state].filter(Boolean).join(", ");

  const dateRange = event.startDate
    ? event.endDate
      ? `${fmtDate(event.startDate)} – ${fmtDate(event.endDate, true)}`
      : fmtDate(event.startDate, true)
    : null;

  const isCompleted = event.status === "completed";
  const isActive = event.status === "active";

  // Progress bar: funded / total. If no funded tracking yet, show full.
  const pct =
    event.totalDeals > 0
      ? event.fundedDeals > 0
        ? (event.fundedDeals / event.totalDeals) * 100
        : 100
      : 0;

  return (
    <Link href={`/dashboard/events/${event.id}`} className="block group">
      <Card
        className={cn(
          "h-full cursor-pointer overflow-hidden border-border/40 transition-all duration-200",
          "hover:shadow-xl hover:border-primary/50 hover:-translate-y-0.5",
        )}
      >
        <CardContent className="p-6 md:p-7 space-y-5">
          {/* ── TOP: Name + location + dates + status badge ── */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <h3 className="text-lg font-bold truncate leading-tight group-hover:text-primary transition-colors">
                {event.dealerName ?? event.name}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {location}
                  </span>
                )}
                {dateRange && (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3 shrink-0" />
                    {dateRange}
                  </span>
                )}
              </div>
            </div>

            {/* IMPROVEMENT 2: Solid green for completed, pulsing blue for active */}
            <Badge
              className={cn(
                "shrink-0 text-[10px] font-bold uppercase tracking-wider border-0 px-2.5",
                isCompleted && "bg-emerald-600 text-white",
                isActive && "bg-blue-600 text-white animate-pulse",
                !isCompleted &&
                  !isActive &&
                  "bg-muted text-muted-foreground",
              )}
            >
              {event.status}
            </Badge>
          </div>

          {/* ── CENTER: MASSIVE Total Gross — the star of the card ── */}
          {/* IMPROVEMENT 3: Strong green for all money values */}
          <div className="py-1">
            <p className="text-3xl sm:text-4xl font-black tracking-tight leading-none text-emerald-400">
              {dollars(event.totalGross)}
            </p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Total Gross
            </p>
          </div>

          {/* ── BELOW: Large Units Sold + clean horizontal progress bar ── */}
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

          {/* ── BOTTOM: Two tiny supporting lines only ── */}
          <div className="flex items-center justify-between pt-3 border-t border-border/30 text-xs text-muted-foreground">
            <span>
              PVR{" "}
              <span className="font-bold text-emerald-400">
                {dollars(event.avgPvr)}
              </span>
            </span>
            <span>
              Close Rate{" "}
              <span className="font-bold text-foreground">
                {event.closingRatio}
                {event.closingRatio !== "—" ? "%" : ""}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
