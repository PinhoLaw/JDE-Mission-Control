"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import { saveRecapConfig } from "@/lib/actions/deals";
import type { Deal, EventConfig, RosterMember } from "@/types/database";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  FileSpreadsheet,
  FileText,
  Save,
  Settings2,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────
type CommTier = { min: number; max: number | null; pct: number };

const DEFAULT_TIERS: CommTier[] = [
  { min: 0, max: 299999, pct: 0.22 },
  { min: 300000, max: 349999, pct: 0.24 },
  { min: 350000, max: null, pct: 0.25 },
];

interface SpSummary {
  name: string;
  units: number;
  ups: number;
  closePct: number;
  gross: number;
  commission: number;
}

// ─── Helpers ─────────────────────────────────────────────
function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function fmtTierRange(tier: CommTier): string {
  const min = `$${tier.min.toLocaleString()}`;
  if (tier.max == null) return `${min}+`;
  return `${min} to $${tier.max.toLocaleString()}`;
}

function pickTierPct(tiers: CommTier[], gross: number): number {
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (gross >= tiers[i].min) return tiers[i].pct;
  }
  return tiers[0]?.pct ?? 0.22;
}

// ═════════════════════════════════════════════════════════
// Page Component
// ═════════════════════════════════════════════════════════
export default function RecapPage() {
  const { currentEvent } = useEvent();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;

  // ── Data state ──
  const [deals, setDeals] = useState<Deal[]>([]);
  const [config, setConfig] = useState<EventConfig | null>(null);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Configurable fields (editable) ──
  const [marketingCost, setMarketingCost] = useState(0);
  const [tiers, setTiers] = useState<CommTier[]>(DEFAULT_TIERS);
  const [miscExpenses, setMiscExpenses] = useState(0);
  const [prizeGiveaways, setPrizeGiveaways] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  // ── Data fetching ──
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
        .select("*")
        .eq("event_id", currentEvent.id),
    ]).then(([dealsRes, configRes, rosterRes]) => {
      setDeals(dealsRes.data ?? []);
      const cfg = configRes.data;
      setConfig(cfg);
      setRoster(rosterRes.data ?? []);

      // Hydrate configurable fields from DB
      if (cfg) {
        setMarketingCost(cfg.marketing_cost ?? 0);
        setTiers(
          Array.isArray(cfg.jde_commission_tiers) && cfg.jde_commission_tiers.length > 0
            ? (cfg.jde_commission_tiers as unknown as CommTier[])
            : DEFAULT_TIERS,
        );
        setMiscExpenses(cfg.misc_expenses ?? 0);
        setPrizeGiveaways(cfg.prize_giveaways ?? 0);
      }
      setLoading(false);
    });

    // Realtime on deals
    const channel = supabase
      .channel(`recap-deals-${currentEvent.id}`)
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

  // ── Roster rate map (keyed by ID + name fallback) ──
  const rosterRateMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of roster) {
      if (m.commission_pct != null) {
        map.set(m.id, m.commission_pct);
        map.set(m.name.toLowerCase().trim(), m.commission_pct);
      }
    }
    return map;
  }, [roster]);

  const defaultRate = config?.rep_commission_pct ?? 0.25;

  // ── P&L Calculations ──
  const pnl = useMemo(() => {
    const docFee = config?.doc_fee ?? 0;
    const pack = config?.pack ?? 0;

    const totalUnits = deals.length;
    const totalUps = deals.reduce((s, d) => s + (d.ups_count ?? 1), 0);
    const closingRatio = totalUps > 0 ? (totalUnits / totalUps) * 100 : 0;
    const newUnits = deals.filter((d) => d.new_used === "New").length;
    const usedUnits = totalUnits - newUnits;

    const totalFrontGross = deals.reduce((s, d) => s + (d.front_gross ?? 0), 0);
    const totalBackGross = deals.reduce((s, d) => s + (d.back_gross ?? 0), 0);
    const totalCommissionableGross = totalFrontGross + totalBackGross;

    // JDE Commission — tier based on commissionable gross
    const jdePct = pickTierPct(tiers, totalCommissionableGross);
    const jdeCommission = totalCommissionableGross * jdePct;

    // Non-commissionable gross (doc fees + pack per deal)
    const nonCommGross = (docFee + pack) * totalUnits;

    // Total Sale Gross
    const totalSaleGross =
      totalCommissionableGross - jdeCommission - marketingCost + nonCommGross;

    // Reps commissions (same logic as commissions page, uses ID-based lookup)
    let repsCommissions = 0;
    for (const deal of deals) {
      const sp = deal.salesperson;
      if (!sp) continue;
      const front = deal.front_gross ?? 0;
      const spRate =
        (deal.salesperson_id ? rosterRateMap.get(deal.salesperson_id) : undefined) ??
        rosterRateMap.get(sp.toLowerCase().trim()) ?? defaultRate;

      if (deal.second_salesperson) {
        const pct1 = deal.salesperson_pct ?? 0.5;
        const pct2 = deal.second_sp_pct ?? 0.5;
        const sp2 = deal.second_salesperson;
        const sp2Rate =
          (deal.second_sp_id ? rosterRateMap.get(deal.second_sp_id) : undefined) ??
          rosterRateMap.get(sp2.toLowerCase().trim()) ?? defaultRate;
        repsCommissions += front * spRate * pct1;
        repsCommissions += front * sp2Rate * pct2;
      } else {
        repsCommissions += front * spRate;
      }
    }

    const variableNet = totalSaleGross - repsCommissions;
    const totalNet = variableNet;

    return {
      totalUnits,
      totalUps,
      closingRatio,
      newUnits,
      usedUnits,
      totalFrontGross,
      totalBackGross,
      totalCommissionableGross,
      jdePct,
      jdeCommission,
      nonCommGross,
      totalSaleGross,
      repsCommissions,
      variableNet,
      totalNet,
    };
  }, [deals, config, tiers, marketingCost, defaultRate, rosterRateMap]);

  // ── Salesperson summary (grouped by ID, fallback to name) ──
  const spSummary = useMemo(() => {
    const map: Record<string, SpSummary> = {};

    for (const deal of deals) {
      const sp = deal.salesperson;
      if (!sp) continue;
      const spKey = deal.salesperson_id ?? sp;
      const front = deal.front_gross ?? 0;
      const total = deal.total_gross ?? 0;
      const spRate =
        (deal.salesperson_id ? rosterRateMap.get(deal.salesperson_id) : undefined) ??
        rosterRateMap.get(sp.toLowerCase().trim()) ?? defaultRate;

      if (!map[spKey]) {
        map[spKey] = { name: sp, units: 0, ups: 0, closePct: 0, gross: 0, commission: 0 };
      }

      const dealUps = deal.ups_count ?? 1;

      if (deal.second_salesperson) {
        const pct1 = deal.salesperson_pct ?? 0.5;
        const pct2 = deal.second_sp_pct ?? 0.5;
        map[spKey].units += pct1;
        map[spKey].ups += dealUps;
        map[spKey].gross += total * pct1;
        map[spKey].commission += front * spRate * pct1;

        const sp2 = deal.second_salesperson;
        const sp2Key = deal.second_sp_id ?? sp2;
        const sp2Rate =
          (deal.second_sp_id ? rosterRateMap.get(deal.second_sp_id) : undefined) ??
          rosterRateMap.get(sp2.toLowerCase().trim()) ?? defaultRate;
        if (!map[sp2Key]) {
          map[sp2Key] = { name: sp2, units: 0, ups: 0, closePct: 0, gross: 0, commission: 0 };
        }
        map[sp2Key].units += pct2;
        // Don't double-count ups for split deals
        map[sp2Key].gross += total * pct2;
        map[sp2Key].commission += front * sp2Rate * pct2;
      } else {
        map[spKey].units += 1;
        map[spKey].ups += dealUps;
        map[spKey].gross += total;
        map[spKey].commission += front * spRate;
      }
    }

    // Compute closing percentages
    const results = Object.values(map);
    for (const s of results) {
      s.closePct = s.ups > 0 ? (s.units / s.ups) * 100 : 0;
    }

    return results.sort((a, b) => b.gross - a.gross);
  }, [deals, defaultRate, rosterRateMap]);

  const spTotals = useMemo(() => {
    return spSummary.reduce(
      (acc, s) => ({
        units: acc.units + s.units,
        ups: acc.ups + s.ups,
        gross: acc.gross + s.gross,
        commission: acc.commission + s.commission,
      }),
      { units: 0, ups: 0, gross: 0, commission: 0 },
    );
  }, [spSummary]);

  // ── Save config ──
  const handleSave = useCallback(async () => {
    if (!currentEvent) return;
    setSaving(true);
    try {
      await saveRecapConfig(currentEvent.id, {
        marketing_cost: marketingCost,
        jde_commission_tiers: tiers,
        misc_expenses: miscExpenses,
        prize_giveaways: prizeGiveaways,
      });
      toast.success("Recap configuration saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [currentEvent, marketingCost, tiers, miscExpenses, prizeGiveaways]);

  // ── Export ──
  const handleExport = useCallback(
    async (type: "pdf" | "excel") => {
      if (!currentEvent) return;
      setExporting(type);
      try {
        const mod = await import("@/lib/utils/recap-export");
        const exportData = {
          eventName: currentEvent.dealer_name ?? currentEvent.name,
          month: currentEvent.start_date
            ? new Date(currentEvent.start_date).toLocaleString("en-US", { month: "long" })
            : "",
          year: currentEvent.start_date
            ? new Date(currentEvent.start_date).getFullYear().toString()
            : "",
          pnl,
          marketingCost,
          miscExpenses,
          prizeGiveaways,
          spSummary,
          spTotals,
        };
        if (type === "pdf") {
          await mod.generateRecapPDF(exportData);
        } else {
          await mod.generateRecapExcel(exportData);
        }
        toast.success(`${type.toUpperCase()} exported`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Export failed");
      } finally {
        setExporting(null);
      }
    },
    [currentEvent, pnl, marketingCost, miscExpenses, prizeGiveaways, spSummary, spTotals],
  );

  // ── Derived display values ──
  const dealerName = currentEvent?.dealer_name ?? currentEvent?.name ?? "";
  const eventMonth = currentEvent?.start_date
    ? new Date(currentEvent.start_date).toLocaleString("en-US", { month: "long" })
    : "";
  const eventYear = currentEvent?.start_date
    ? new Date(currentEvent.start_date).getFullYear()
    : "";

  // ── Render ──
  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Select an event to view the recap</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Green highlight style
  const greenRow =
    "bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200 font-bold";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/events">
                <ArrowLeft className="h-4 w-4" />
                Events
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/events/${eventId}/overview`}>
                <BarChart3 className="h-4 w-4" />
                Overview
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Event Recap
          </h1>
          <p className="text-sm text-muted-foreground">
            Financial P&L summary for {dealerName}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("excel")}
            disabled={exporting !== null}
          >
            {exporting === "excel" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" />
            )}
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null}
          >
            {exporting === "pdf" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            PDF
          </Button>
        </div>
      </div>

      {/* ── Pre-Sale Financial Setup ── */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setShowSetup((p) => !p)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Pre-Sale Financial Setup</CardTitle>
                <CardDescription>
                  Configure marketing cost, JDE commission tiers, and expenses
                </CardDescription>
              </div>
            </div>
            {showSetup ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {showSetup && (
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label>Marketing Cost</Label>
                <Input
                  type="number"
                  value={marketingCost || ""}
                  onChange={(e) => setMarketingCost(Number(e.target.value) || 0)}
                  placeholder="e.g. 45750"
                />
              </div>
              <div>
                <Label>Misc Expenses</Label>
                <Input
                  type="number"
                  value={miscExpenses || ""}
                  onChange={(e) => setMiscExpenses(Number(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Helium / Prize Giveaways</Label>
                <Input
                  type="number"
                  value={prizeGiveaways || ""}
                  onChange={(e) => setPrizeGiveaways(Number(e.target.value) || 0)}
                  placeholder="0"
                />
              </div>
            </div>

            <Separator />

            <div>
              <Label className="mb-2 block">JDE Commission Tiers</Label>
              <div className="space-y-2">
                {tiers.map((tier, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span className="w-8 font-mono text-muted-foreground">
                      T{i + 1}
                    </span>
                    <Input
                      type="number"
                      className="w-32"
                      value={tier.min || ""}
                      onChange={(e) => {
                        const next = [...tiers];
                        next[i] = { ...next[i], min: Number(e.target.value) || 0 };
                        setTiers(next);
                      }}
                      placeholder="Min"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="number"
                      className="w-32"
                      value={tier.max ?? ""}
                      onChange={(e) => {
                        const next = [...tiers];
                        const val = e.target.value;
                        next[i] = {
                          ...next[i],
                          max: val === "" ? null : Number(val) || 0,
                        };
                        setTiers(next);
                      }}
                      placeholder="Max (empty = unlimited)"
                    />
                    <span className="text-muted-foreground">=</span>
                    <Input
                      type="number"
                      className="w-20"
                      value={(tier.pct * 100) || ""}
                      onChange={(e) => {
                        const next = [...tiers];
                        next[i] = {
                          ...next[i],
                          pct: (Number(e.target.value) || 0) / 100,
                        };
                        setTiers(next);
                      }}
                      placeholder="%"
                    />
                    <span className="text-muted-foreground">%</span>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() =>
                  setTiers((prev) => [
                    ...prev,
                    {
                      min: prev.length > 0 ? (prev[prev.length - 1].max ?? 0) + 1 : 0,
                      max: null,
                      pct: 0.25,
                    },
                  ])
                }
              >
                + Add tier
              </Button>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Configuration
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── No deals empty state ── */}
      {deals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-lg text-muted-foreground">No deals logged yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Data will appear here once deals are added to the Deal Log.
            </p>
          </CardContent>
        </Card>
      ) : (
        /* ── Two-Column Layout ── */
        <div className="grid gap-6 lg:grid-cols-5">
          {/* LEFT COLUMN — P&L (3 cols) */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg uppercase tracking-wide">
                {dealerName} {eventMonth} {eventYear}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableBody>
                    {/* TOTAL COMMISSIONABLE GROSS */}
                    <TableRow>
                      <TableCell className="font-medium">
                        TOTAL COMMISSIONABLE GROSS
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-base">
                        {fmtCurrency(pnl.totalCommissionableGross)}
                      </TableCell>
                    </TableRow>

                    {/* JDE COMMISSION */}
                    <TableRow>
                      <TableCell className="font-medium">
                        JDE COMMISSION{" "}
                        <span className="text-muted-foreground text-xs">
                          [{fmtPct(pnl.jdePct)}]
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                        - {fmtCurrency(pnl.jdeCommission)}
                      </TableCell>
                    </TableRow>

                    {/* MARKETING COST */}
                    <TableRow>
                      <TableCell className="font-medium">MARKETING COST</TableCell>
                      <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                        - {fmtCurrency(marketingCost)}
                      </TableCell>
                    </TableRow>

                    {/* NON COMM GROSS */}
                    <TableRow>
                      <TableCell className="font-medium">
                        NON COMM GROSS{" "}
                        <span className="text-muted-foreground text-xs">
                          (doc fee + pack) &times; {pnl.totalUnits}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600 dark:text-green-400">
                        + {fmtCurrency(pnl.nonCommGross)}
                      </TableCell>
                    </TableRow>

                    {/* TOTAL SALE GROSS — green */}
                    <TableRow className={greenRow}>
                      <TableCell className="font-bold text-base">
                        TOTAL SALE GROSS
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-base">
                        {fmtCurrency(pnl.totalSaleGross)}
                      </TableCell>
                    </TableRow>

                    {/* REPS COMMISSIONS */}
                    <TableRow>
                      <TableCell className="font-medium">REPS COMMISSIONS</TableCell>
                      <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                        - {fmtCurrency(pnl.repsCommissions)}
                      </TableCell>
                    </TableRow>

                    {/* VARIABLE NET — green */}
                    <TableRow className={greenRow}>
                      <TableCell className="font-bold text-base">VARIABLE NET</TableCell>
                      <TableCell className="text-right font-mono font-bold text-base">
                        {fmtCurrency(pnl.variableNet)}
                      </TableCell>
                    </TableRow>

                    {/* TOTAL NET — green */}
                    <TableRow className={greenRow}>
                      <TableCell className="font-bold text-base">TOTAL NET</TableCell>
                      <TableCell className="text-right font-mono font-bold text-base">
                        {fmtCurrency(pnl.totalNet)}
                      </TableCell>
                    </TableRow>

                    {/* Separator */}
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="h-2 bg-muted/50 p-0"
                      />
                    </TableRow>

                    {/* MIS EXPENSES */}
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium">
                        MIS EXPENSES
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmtCurrency(miscExpenses)}
                      </TableCell>
                    </TableRow>

                    {/* HELIUM / PRIZE GIVEAWAYS */}
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium">
                        HELIUM / PRIZE GIVEAWAYS ETC
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmtCurrency(prizeGiveaways)}
                      </TableCell>
                    </TableRow>

                    {/* JDE COMMISSION (display) */}
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium">
                        JDE COMMISSION
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {fmtCurrency(pnl.jdeCommission)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* NEW / USED / CLOSING RATIO box */}
              <div className="mt-4 flex gap-4">
                <div className="flex-1 rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-4 text-center">
                  <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">
                    {pnl.newUnits}
                  </p>
                  <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                    NEW
                  </p>
                </div>
                <div className="flex-1 rounded-lg border-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950 p-4 text-center">
                  <p className="text-3xl font-bold text-orange-700 dark:text-orange-300">
                    {pnl.usedUnits}
                  </p>
                  <p className="text-sm font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wide">
                    USED
                  </p>
                </div>
                <div className="flex-1 rounded-lg border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 p-4 text-center">
                  <p className="text-3xl font-bold text-indigo-700 dark:text-indigo-300">
                    {pnl.closingRatio.toFixed(0)}%
                  </p>
                  <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                    CLOSE RATE
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pnl.totalUnits} / {pnl.totalUps} ups
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* RIGHT COLUMN — Salespeople Summary (2 cols) */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg uppercase tracking-wide">
                Sales People Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Salesperson</TableHead>
                      <TableHead className="text-center">Units</TableHead>
                      <TableHead className="text-center">Ups</TableHead>
                      <TableHead className="text-center">Close %</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spSummary.map((sp) => (
                      <TableRow key={sp.name}>
                        <TableCell className="font-medium text-sm">
                          {sp.name}
                        </TableCell>
                        <TableCell className="text-center font-mono">
                          {sp.units % 1 === 0 ? sp.units : sp.units.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-center font-mono">
                          {sp.ups || "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {sp.ups > 0 ? (
                            <span
                              className={`font-medium ${
                                sp.closePct >= 30
                                  ? "text-green-600 dark:text-green-400"
                                  : sp.closePct >= 15
                                    ? "text-yellow-600 dark:text-yellow-400"
                                    : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {sp.closePct.toFixed(0)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {fmtCurrency(sp.gross)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-green-700 dark:text-green-400">
                          {fmtCurrency(sp.commission)}
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* TOTAL REPS row */}
                    <TableRow className="border-t-2 border-foreground/20 font-bold">
                      <TableCell className="font-bold">TOTAL REPS</TableCell>
                      <TableCell className="text-center font-mono font-bold">
                        {spTotals.units % 1 === 0
                          ? spTotals.units
                          : spTotals.units.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-center font-mono font-bold">
                        {spTotals.ups}
                      </TableCell>
                      <TableCell className="text-center font-mono font-bold">
                        {spTotals.ups > 0
                          ? `${((spTotals.units / spTotals.ups) * 100).toFixed(0)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {fmtCurrency(spTotals.gross)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-green-700 dark:text-green-400">
                        {fmtCurrency(spTotals.commission)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
