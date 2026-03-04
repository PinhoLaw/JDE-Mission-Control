"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import { getDealsPerZip, getGrossPerZip, getCampaignSources } from "@/lib/actions/deals";
import type { MailTracking } from "@/types/database";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Megaphone, Download } from "lucide-react";
import { toast } from "sonner";

// Day column keys for mail_tracking (day_1 through day_12)
const ALL_DAY_KEYS = [
  "day_1", "day_2", "day_3", "day_4", "day_5", "day_6",
  "day_7", "day_8", "day_9", "day_10", "day_11", "day_12",
] as const;
type DayKey = (typeof ALL_DAY_KEYS)[number];

/** Determine which day columns actually have data (> 0) in any row */
function getActiveDayColumns(rows: MailTracking[]): DayKey[] {
  const active = new Set<DayKey>();
  for (const row of rows) {
    for (const key of ALL_DAY_KEYS) {
      if ((row[key] as number) > 0) active.add(key);
    }
  }
  // Return in order, but only up to the last active day
  const indices = [...active].map((k) => ALL_DAY_KEYS.indexOf(k));
  if (indices.length === 0) return [];
  const maxIdx = Math.max(...indices);
  return ALL_DAY_KEYS.slice(0, maxIdx + 1);
}

export default function CampaignsPage() {
  const { currentEvent } = useEvent();
  const [allData, setAllData] = useState<MailTracking[]>([]);
  const [loading, setLoading] = useState(true);
  // Deal zip counts and gross sums (from actual deals, for cross-reference)
  const [soldByZip, setSoldByZip] = useState<Record<string, number>>({});
  const [grossByZip, setGrossByZip] = useState<Record<string, number>>({});

  // Campaign source toggle
  const [campaignSources, setCampaignSources] = useState<string[]>(["current"]);
  const [selectedSource, setSelectedSource] = useState<string>("current");

  // Server-action fetch for deals per zip (reliable on production)
  const refreshDealStats = useCallback(
    (eventId: string) =>
      Promise.all([
        getDealsPerZip(eventId).then((counts) => setSoldByZip(counts)),
        getGrossPerZip(eventId).then((sums) => setGrossByZip(sums)),
      ]),
    [],
  );

  useEffect(() => {
    if (!currentEvent) return;
    setLoading(true);
    const supabase = createClient();

    Promise.all([
      // Fetch all mail_tracking rows for this event (all campaign sources)
      supabase
        .from("mail_tracking")
        .select("*")
        .eq("event_id", currentEvent.id)
        .order("pieces_sent", { ascending: false })
        .then(({ data: rows }) => setAllData(rows ?? [])),
      refreshDealStats(currentEvent.id),
      getCampaignSources(currentEvent.id).then((sources) => {
        setCampaignSources(sources);
        // Default to "current" if available
        if (sources.includes("current")) {
          setSelectedSource("current");
        } else if (sources.length > 0) {
          setSelectedSource(sources[0]);
        }
      }),
    ]).then(() => setLoading(false));

    // Realtime on mail_tracking
    const mailChannel = supabase
      .channel(`mail-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mail_tracking",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        () => {
          supabase
            .from("mail_tracking")
            .select("*")
            .eq("event_id", currentEvent.id)
            .order("pieces_sent", { ascending: false })
            .then(({ data: rows }) => setAllData(rows ?? []));
          getCampaignSources(currentEvent.id).then(setCampaignSources);
        },
      )
      .subscribe();

    // Realtime on deals — recount zips when deals change
    const dealsChannel = supabase
      .channel(`camp-deals-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_deals",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        () => {
          refreshDealStats(currentEvent.id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(mailChannel);
      supabase.removeChannel(dealsChannel);
    };
  }, [currentEvent, refreshDealStats]);

  // Filter data by selected campaign source
  const data = useMemo(
    () => allData.filter((r) => r.campaign_source === selectedSource),
    [allData, selectedSource],
  );

  // Determine which day columns have data for the selected source
  const activeDays = useMemo(() => getActiveDayColumns(data), [data]);

  // Determine if this is "current" campaign (show deal cross-ref) or historical
  const isCurrent = selectedSource === "current";

  // Previous campaign sources (everything except "current")
  const previousSources = useMemo(
    () => campaignSources.filter((s) => s !== "current"),
    [campaignSources],
  );

  const stats = useMemo(() => {
    const totalPieces = data.reduce((s, d) => s + (d.pieces_sent ?? 0), 0);
    const totalResponses = data.reduce((s, d) => s + d.total_responses, 0);

    // For "current" campaign: use deal cross-reference for sold/gross
    // For historical: use stored sold_from_mail / gross_from_mail values
    let totalSold: number;
    let totalGross: number;
    if (isCurrent) {
      totalSold = data.reduce(
        (s, d) => s + (soldByZip[d.zip_code] ?? 0),
        0,
      );
      totalGross = data.reduce(
        (s, d) => s + (grossByZip[d.zip_code] ?? 0),
        0,
      );
    } else {
      totalSold = data.reduce((s, d) => s + (d.sold_from_mail ?? 0), 0);
      totalGross = data.reduce((s, d) => s + (d.gross_from_mail ?? 0), 0);
    }

    const rate = totalPieces > 0 ? (totalResponses / totalPieces) * 100 : 0;
    const closeRate = totalResponses > 0 ? (totalSold / totalResponses) * 100 : 0;
    const topZips = [...data]
      .sort((a, b) => b.total_responses - a.total_responses)
      .slice(0, 5);
    return { totalPieces, totalResponses, totalSold, totalGross, rate, closeRate, topZips };
  }, [data, soldByZip, grossByZip, isCurrent]);

  /** Get sold count for a single row */
  const getSoldForRow = useCallback(
    (row: MailTracking) =>
      isCurrent ? (soldByZip[row.zip_code] ?? 0) : (row.sold_from_mail ?? 0),
    [isCurrent, soldByZip],
  );

  /** Get gross amount for a single row */
  const getGrossForRow = useCallback(
    (row: MailTracking) =>
      isCurrent ? (grossByZip[row.zip_code] ?? 0) : (row.gross_from_mail ?? 0),
    [isCurrent, grossByZip],
  );

  const exportCSV = () => {
    const dayHeaders = activeDays.map(
      (k) => `Day ${k.replace("day_", "")}`,
    );
    const headers = [
      "Zip", "Town", "Pieces", ...dayHeaders,
      "Total", "Sold", "Gross", "Rate", "Close %",
    ];
    const rows = data.map((r) => {
      const sold = getSoldForRow(r);
      const gross = getGrossForRow(r);
      const closePct = r.total_responses > 0
        ? ((sold / r.total_responses) * 100).toFixed(1)
        : "0.0";
      const dayValues = activeDays.map((k) => r[k] ?? 0);
      return [
        r.zip_code, r.town ?? "", r.pieces_sent, ...dayValues,
        r.total_responses, sold, gross.toFixed(2),
        r.response_rate, `${closePct}%`,
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const sourceLabel = isCurrent ? "current" : selectedSource.replace(/\s+/g, "_");
    a.download = `mail_campaign_${sourceLabel}_${currentEvent?.name ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Campaign data exported");
  };

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Select an event to view campaigns</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Mail Campaigns
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} — Direct mail
            response tracking by zip code
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Campaign Source Toggle */}
      {(previousSources.length > 0 || campaignSources.length > 1) && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border p-1 bg-muted/50">
            <button
              onClick={() => setSelectedSource("current")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isCurrent
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Current Campaign
            </button>
            <button
              onClick={() => {
                if (previousSources.length > 0) {
                  setSelectedSource(previousSources[0]);
                }
              }}
              disabled={previousSources.length === 0}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                !isCurrent
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Previous Campaign Data
            </button>
          </div>
          {!isCurrent && previousSources.length > 1 && (
            <Select
              value={selectedSource}
              onValueChange={setSelectedSource}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {previousSources.map((src) => (
                  <SelectItem key={src} value={src}>
                    {src}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Megaphone className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {isCurrent
              ? "No mail campaign data yet."
              : `No data for "${selectedSource}".`}
          </p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Pieces</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {stats.totalPieces.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Responses</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{stats.totalResponses}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Sold from Mail</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-blue-700">
                  {stats.totalSold}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Gross from Mail</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-emerald-700">
                  ${stats.totalGross.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Response Rate</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-700">
                  {stats.rate.toFixed(2)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Close Rate</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-purple-700">
                  {stats.closeRate.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Top Zips */}
          {stats.topZips.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Performing Zip Codes</CardTitle>
                <CardDescription>Highest response counts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {stats.topZips.map((z) => {
                    const sold = getSoldForRow(z);
                    const gross = getGrossForRow(z);
                    return (
                      <div
                        key={z.id}
                        className="rounded-lg border p-3 space-y-1 min-w-[140px]"
                      >
                        <p className="text-sm font-medium">{z.town ?? "—"}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {z.zip_code}
                        </p>
                        <p className="text-lg font-bold text-green-700">
                          {z.total_responses} responses
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {z.pieces_sent?.toLocaleString()} sent •{" "}
                          {z.response_rate != null
                            ? `${(z.response_rate * 100).toFixed(1)}%`
                            : "—"}
                          {sold > 0 && (
                            <span className="text-blue-700 dark:text-blue-400 font-medium">
                              {" "}
                              • {sold} sold
                            </span>
                          )}
                          {gross > 0 && (
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                              {" "}
                              • ${gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Full Table */}
          <Card>
            <CardHeader>
              <CardTitle>Response by Zip Code</CardTitle>
              <CardDescription>
                {isCurrent ? "Daily breakdown per zip" : `${selectedSource} — Daily breakdown per zip`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zip</TableHead>
                      <TableHead>Town</TableHead>
                      <TableHead className="text-right">Pieces</TableHead>
                      {activeDays.map((key) => (
                        <TableHead key={key} className="text-center">
                          Day {key.replace("day_", "")}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Close %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row) => {
                      const sold = getSoldForRow(row);
                      const gross = getGrossForRow(row);
                      const closePct = row.total_responses > 0
                        ? ((sold / row.total_responses) * 100).toFixed(1)
                        : "0.0";
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-sm">
                            {row.zip_code}
                          </TableCell>
                          <TableCell className="font-medium">
                            {row.town ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.pieces_sent?.toLocaleString()}
                          </TableCell>
                          {activeDays.map((key) => {
                            const val = (row[key] as number) ?? 0;
                            return (
                              <TableCell key={key} className="text-center">
                                {val > 0 ? (
                                  <Badge
                                    variant="secondary"
                                    className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                                  >
                                    {val}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right font-bold">
                            {row.total_responses}
                          </TableCell>
                          <TableCell className="text-right font-medium text-blue-700">
                            {sold}
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {gross > 0
                              ? `$${gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.response_rate != null
                              ? `${(row.response_rate * 100).toFixed(1)}%`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium text-purple-700">
                            {row.total_responses > 0
                              ? `${closePct}%`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
