"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import { getDealsPerZip, getGrossPerZip } from "@/lib/actions/deals";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Megaphone, Download } from "lucide-react";
import { toast } from "sonner";

export default function CampaignsPage() {
  const { currentEvent } = useEvent();
  const [data, setData] = useState<MailTracking[]>([]);
  const [loading, setLoading] = useState(true);
  // Deal zip counts: { "62656": 5, "62526": 3, ... }
  const [soldByZip, setSoldByZip] = useState<Record<string, number>>({});
  // Deal gross sums per zip: { "62656": 12500, "62526": 8300, ... }
  const [grossByZip, setGrossByZip] = useState<Record<string, number>>({});

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
      supabase
        .from("mail_tracking")
        .select("*")
        .eq("event_id", currentEvent.id)
        .order("pieces_sent", { ascending: false })
        .then(({ data: rows }) => setData(rows ?? [])),
      refreshDealStats(currentEvent.id),
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
            .then(({ data: rows }) => setData(rows ?? []));
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

  const stats = useMemo(() => {
    const totalPieces = data.reduce((s, d) => s + (d.pieces_sent ?? 0), 0);
    const totalResponses = data.reduce((s, d) => s + d.total_responses, 0);
    const totalSold = data.reduce(
      (s, d) => s + (soldByZip[d.zip_code] ?? 0),
      0,
    );
    const totalGross = data.reduce(
      (s, d) => s + (grossByZip[d.zip_code] ?? 0),
      0,
    );
    const rate = totalPieces > 0 ? (totalResponses / totalPieces) * 100 : 0;
    const closeRate = totalResponses > 0 ? (totalSold / totalResponses) * 100 : 0;
    const topZips = [...data]
      .sort((a, b) => b.total_responses - a.total_responses)
      .slice(0, 5);
    return { totalPieces, totalResponses, totalSold, totalGross, rate, closeRate, topZips };
  }, [data, soldByZip, grossByZip]);

  const exportCSV = () => {
    const headers = [
      "Zip", "Town", "Pieces", "Day1", "Day2", "Day3", "Day4", "Day5",
      "Day6", "Day7", "Total", "Sold", "Gross", "Rate", "Close %",
    ];
    const rows = data.map((r) => {
      const sold = soldByZip[r.zip_code] ?? 0;
      const gross = grossByZip[r.zip_code] ?? 0;
      const closePct = r.total_responses > 0
        ? ((sold / r.total_responses) * 100).toFixed(1)
        : "0.0";
      return [
        r.zip_code, r.town, r.pieces_sent, r.day_1, r.day_2, r.day_3,
        r.day_4, r.day_5, r.day_6, r.day_7, r.total_responses,
        sold, gross.toFixed(2), r.response_rate, `${closePct}%`,
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mail_campaign_${currentEvent?.name ?? "export"}.csv`;
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
        <Button variant="outline" size="sm" onClick={exportCSV}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Megaphone className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No mail campaign data yet.</p>
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
                  {stats.topZips.map((z) => (
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
                        {(soldByZip[z.zip_code] ?? 0) > 0 && (
                          <span className="text-blue-700 dark:text-blue-400 font-medium">
                            {" "}
                            • {soldByZip[z.zip_code]} sold
                          </span>
                        )}
                        {(grossByZip[z.zip_code] ?? 0) > 0 && (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            {" "}
                            • ${grossByZip[z.zip_code].toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Full Table */}
          <Card>
            <CardHeader>
              <CardTitle>Response by Zip Code</CardTitle>
              <CardDescription>Daily breakdown per zip</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zip</TableHead>
                      <TableHead>Town</TableHead>
                      <TableHead className="text-right">Pieces</TableHead>
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <TableHead key={d} className="text-center">
                          Day {d}
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
                    {data.map((row) => (
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
                        {(
                          [
                            row.day_1,
                            row.day_2,
                            row.day_3,
                            row.day_4,
                            row.day_5,
                            row.day_6,
                            row.day_7,
                          ] as number[]
                        ).map((val, idx) => (
                          <TableCell key={idx} className="text-center">
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
                        ))}
                        <TableCell className="text-right font-bold">
                          {row.total_responses}
                        </TableCell>
                        <TableCell className="text-right font-medium text-blue-700">
                          {soldByZip[row.zip_code] ?? 0}
                        </TableCell>
                        <TableCell className="text-right font-medium text-emerald-700">
                          {(grossByZip[row.zip_code] ?? 0) > 0
                            ? `$${grossByZip[row.zip_code].toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.response_rate != null
                            ? `${(row.response_rate * 100).toFixed(1)}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium text-purple-700">
                          {row.total_responses > 0
                            ? `${(((soldByZip[row.zip_code] ?? 0) / row.total_responses) * 100).toFixed(1)}%`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
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
