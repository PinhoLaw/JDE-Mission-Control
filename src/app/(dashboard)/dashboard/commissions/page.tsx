"use client";

import { useState, useEffect, useMemo } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal, EventConfig } from "@/types/database";
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
import { Loader2, DollarSign, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

interface CommissionEntry {
  name: string;
  commissionRate: number;
  fullDeals: number;
  splitDeals: number;
  weightedFrontGross: number;
  totalBackGross: number;
  totalGross: number;
  commission: number;
  washouts: number;
  avgPVR: number;
}

export default function CommissionsPage() {
  const { currentEvent } = useEvent();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [config, setConfig] = useState<EventConfig | null>(null);
  const [roster, setRoster] = useState<{ id: string; name: string; commission_pct: number | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentEvent) return;
    setLoading(true);
    const supabase = createClient();

    Promise.all([
      supabase
        .from("sales_deals")
        .select("*")
        .eq("event_id", currentEvent.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("event_config")
        .select("*")
        .eq("event_id", currentEvent.id)
        .maybeSingle(),
      supabase
        .from("roster")
        .select("id, name, commission_pct")
        .eq("event_id", currentEvent.id),
    ]).then(([dealsRes, configRes, rosterRes]) => {
      setDeals(dealsRes.data ?? []);
      setConfig(configRes.data);
      setRoster(rosterRes.data ?? []);
      setLoading(false);
    });

    // Realtime on deals
    const channel = supabase
      .channel(`comm-deals-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_deals",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        () => {
          supabase
            .from("sales_deals")
            .select("*")
            .eq("event_id", currentEvent.id)
            .then(({ data }) => setDeals(data ?? []));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent]);

  // Build per-person commission rate lookup from roster
  const rosterRateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const member of roster) {
      if (member.commission_pct != null) {
        map.set(member.name.toLowerCase().trim(), member.commission_pct);
      }
    }
    return map;
  }, [roster]);

  const defaultRate = config?.rep_commission_pct ?? 0.25;

  const commissions = useMemo(() => {
    const byPerson: Record<string, CommissionEntry> = {};

    for (const deal of deals) {
      const sp = deal.salesperson;
      if (!sp) continue;

      // Per-person rate from roster, fallback to config default
      const spRate =
        rosterRateMap.get(sp.toLowerCase().trim()) ?? defaultRate;

      if (!byPerson[sp]) {
        byPerson[sp] = {
          name: sp,
          commissionRate: spRate,
          fullDeals: 0,
          splitDeals: 0,
          weightedFrontGross: 0,
          totalBackGross: 0,
          totalGross: 0,
          commission: 0,
          washouts: 0,
          avgPVR: 0,
        };
      }

      const front = deal.front_gross ?? 0;
      const back = deal.back_gross ?? 0;
      const total = deal.total_gross ?? 0;
      const pct1 = deal.salesperson_pct ?? 1;

      if (deal.second_salesperson) {
        // Split deal — primary salesperson
        byPerson[sp].splitDeals += 1;
        byPerson[sp].weightedFrontGross += front * pct1;
        byPerson[sp].totalBackGross += back * pct1;
        byPerson[sp].totalGross += total * pct1;
        byPerson[sp].commission += front * spRate * pct1;

        // Second salesperson
        const sp2 = deal.second_salesperson;
        const sp2Rate =
          rosterRateMap.get(sp2.toLowerCase().trim()) ?? defaultRate;

        if (!byPerson[sp2]) {
          byPerson[sp2] = {
            name: sp2,
            commissionRate: sp2Rate,
            fullDeals: 0,
            splitDeals: 0,
            weightedFrontGross: 0,
            totalBackGross: 0,
            totalGross: 0,
            commission: 0,
            washouts: 0,
            avgPVR: 0,
          };
        }
        const pct2 = deal.second_sp_pct ?? 0.5;
        byPerson[sp2].splitDeals += 1;
        byPerson[sp2].weightedFrontGross += front * pct2;
        byPerson[sp2].totalBackGross += back * pct2;
        byPerson[sp2].totalGross += total * pct2;
        byPerson[sp2].commission += front * sp2Rate * pct2;
      } else {
        // Full deal
        byPerson[sp].fullDeals += 1;
        byPerson[sp].weightedFrontGross += front;
        byPerson[sp].totalBackGross += back;
        byPerson[sp].totalGross += total;
        byPerson[sp].commission += front * spRate;
      }

      if (deal.is_washout) {
        byPerson[sp].washouts += 1;
      }
    }

    // Calculate avg PVR
    for (const entry of Object.values(byPerson)) {
      const totalDeals = entry.fullDeals + entry.splitDeals;
      entry.avgPVR = totalDeals > 0 ? entry.totalGross / totalDeals : 0;
    }

    return Object.values(byPerson).sort((a, b) => b.commission - a.commission);
  }, [deals, defaultRate, rosterRateMap]);

  const totalComm = commissions.reduce((s, c) => s + c.commission, 0);
  const totalWashouts = commissions.reduce((s, c) => s + c.washouts, 0);

  const exportCSV = () => {
    const headers = [
      "Salesperson", "Rate", "Full Deals", "Splits", "Weighted Front",
      "Back Gross", "Total Gross", "Avg PVR", "Commission", "Washouts",
    ];
    const rows = commissions.map((c) =>
      [
        c.name,
        `${(c.commissionRate * 100).toFixed(0)}%`,
        c.fullDeals,
        c.splitDeals,
        c.weightedFrontGross.toFixed(2),
        c.totalBackGross.toFixed(2),
        c.totalGross.toFixed(2),
        c.avgPVR.toFixed(2),
        c.commission.toFixed(2),
        c.washouts,
      ].join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commissions_${currentEvent?.name ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Commissions exported");
  };

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">
          Select an event to view commissions
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Commissions
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} — Default{" "}
            {(defaultRate * 100).toFixed(0)}% commission rate
            {roster.length > 0 && " (individual rates from roster)"}
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
      ) : (
        <>
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Commissions</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-700">
                  {formatCurrency(totalComm)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Reps Earning</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{commissions.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Avg Commission</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {commissions.length > 0
                    ? formatCurrency(totalComm / commissions.length)
                    : "$0"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Washouts</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">
                  {totalWashouts}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Commission Table */}
          <Card>
            <CardHeader>
              <CardTitle>Commission Breakdown</CardTitle>
              <CardDescription>
                Individual rates from roster (default:{" "}
                {(defaultRate * 100).toFixed(0)}% of weighted front gross)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {commissions.length === 0 ? (
                <div className="flex flex-col items-center py-12">
                  <DollarSign className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    No deals with salesperson data yet.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Salesperson</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-center">Full</TableHead>
                        <TableHead className="text-center">Splits</TableHead>
                        <TableHead className="text-right">
                          Weighted Front
                        </TableHead>
                        <TableHead className="text-right">Back Gross</TableHead>
                        <TableHead className="text-right">
                          Total Gross
                        </TableHead>
                        <TableHead className="text-right">Avg PVR</TableHead>
                        <TableHead className="text-right">
                          Commission
                        </TableHead>
                        <TableHead className="text-center">Wash</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissions.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span
                              className={
                                c.commissionRate !== defaultRate
                                  ? "text-blue-600 font-medium"
                                  : ""
                              }
                            >
                              {(c.commissionRate * 100).toFixed(0)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            {c.fullDeals}
                          </TableCell>
                          <TableCell className="text-center">
                            {c.splitDeals}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(c.weightedFrontGross)}
                          </TableCell>
                          <TableCell className="text-right text-blue-700">
                            {formatCurrency(c.totalBackGross)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(c.totalGross)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(c.avgPVR)}
                          </TableCell>
                          <TableCell className="text-right font-bold text-green-700">
                            {formatCurrency(c.commission)}
                          </TableCell>
                          <TableCell className="text-center">
                            {c.washouts > 0 ? (
                              <Badge
                                variant="destructive"
                                className="text-[10px]"
                              >
                                {c.washouts}
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals row */}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell>TOTALS</TableCell>
                        <TableCell className="text-right">—</TableCell>
                        <TableCell className="text-center">
                          {commissions.reduce((s, c) => s + c.fullDeals, 0)}
                        </TableCell>
                        <TableCell className="text-center">
                          {commissions.reduce((s, c) => s + c.splitDeals, 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(
                            commissions.reduce(
                              (s, c) => s + c.weightedFrontGross,
                              0,
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-right text-blue-700">
                          {formatCurrency(
                            commissions.reduce(
                              (s, c) => s + c.totalBackGross,
                              0,
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(
                            commissions.reduce((s, c) => s + c.totalGross, 0),
                          )}
                        </TableCell>
                        <TableCell className="text-right">—</TableCell>
                        <TableCell className="text-right text-green-700">
                          {formatCurrency(totalComm)}
                        </TableCell>
                        <TableCell className="text-center">
                          {totalWashouts > 0 && (
                            <span className="flex items-center justify-center gap-1 text-red-600">
                              <AlertTriangle className="h-3 w-3" />
                              {totalWashouts}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
