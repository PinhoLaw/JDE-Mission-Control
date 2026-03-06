"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal } from "@/types/database";
import { LoadingTableSkeleton } from "@/components/ui/loading-table-skeleton";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type ColumnSizingState,
  type Column,
  flexRender,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionsToolbar } from "@/components/ui/data-table-bulk-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Download,
  Plus,
  Loader2,
  Handshake,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { EditDealForm } from "@/components/deals/edit-deal-form";
import { LastSyncedIndicator } from "@/components/ui/last-synced-indicator";
import { bulkDeleteDeals, updateDealStatus } from "@/lib/actions/deals";
import { useRosterMembers } from "@/hooks/useRosterMembers";

const CLOSER_ROLE_COLORS: Record<string, string> = {
  sales: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  team_leader: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  fi_manager: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  closer: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  manager: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  home_team: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  funded: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  unwound: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const ROW_HEIGHT = 40;

/** Reusable sortable header — shows sort direction indicator */
function SortableHeader({
  column,
  children,
}: {
  column: Column<Deal, unknown>;
  children: React.ReactNode;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground text-left text-xs font-medium"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {children}
      {sorted === "asc" ? (
        <ChevronUp className="h-3 w-3 shrink-0" />
      ) : sorted === "desc" ? (
        <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
      )}
    </button>
  );
}

export default function DealsPage() {
  const { currentEvent } = useEvent();
  const { roster } = useRosterMembers();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    if (!currentEvent) return;
    setLoading(true);
    const supabase = createClient();

    supabase
      .from("sales_deals")
      .select("*")
      .eq("event_id", currentEvent.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setDeals(data ?? []);
        setLoading(false);
      });

    // Realtime
    const channel = supabase
      .channel(`deals-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sales_deals",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setDeals((prev) => [payload.new as Deal, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setDeals((prev) =>
              prev.map((d) =>
                d.id === (payload.new as Deal).id ? (payload.new as Deal) : d,
              ),
            );
          } else if (payload.eventType === "DELETE") {
            setDeals((prev) =>
              prev.filter((d) => d.id !== (payload.old as { id: string }).id),
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent]);

  const filteredDeals = useMemo(() => {
    if (statusFilter === "all") return deals;
    return deals.filter((d) => d.status === statusFilter);
  }, [deals, statusFilter]);

  const stats = useMemo(() => {
    const totalGross = filteredDeals.reduce((s, d) => s + (d.total_gross ?? 0), 0);
    const totalFront = filteredDeals.reduce((s, d) => s + (d.front_gross ?? 0), 0);
    const totalBack = filteredDeals.reduce((s, d) => s + (d.back_gross ?? 0), 0);
    const avgPVR = filteredDeals.length > 0 ? totalGross / filteredDeals.length : 0;

    // ── New aggregations (single pass) ──
    const spMap = new Map<string, { deals: number; gross: number }>();
    const lenderMap = new Map<string, number>();
    let warrantyCount = 0;
    let gapCount = 0;
    let newCount = 0, newGrossSum = 0;
    let usedCount = 0, usedGrossSum = 0;
    let highestDeal: { customer: string; gross: number; vehicle: string } | null = null;

    for (const d of filteredDeals) {
      // Salesperson ranking
      const sp = d.salesperson || "Unknown";
      const spEntry = spMap.get(sp) || { deals: 0, gross: 0 };
      spEntry.deals++;
      spEntry.gross += d.total_gross ?? 0;
      spMap.set(sp, spEntry);

      // Lender breakdown
      if (d.lender) lenderMap.set(d.lender, (lenderMap.get(d.lender) ?? 0) + 1);

      // Warranty & GAP counts
      if ((d.warranty ?? 0) > 0) warrantyCount++;
      if ((d.gap ?? 0) > 0) gapCount++;

      // New vs Used
      if (d.new_used === "New") { newCount++; newGrossSum += d.total_gross ?? 0; }
      else if (d.new_used === "Used" || d.new_used === "Certified") { usedCount++; usedGrossSum += d.total_gross ?? 0; }

      // Highest single deal
      const g = d.total_gross ?? 0;
      if (!highestDeal || g > highestDeal.gross) {
        highestDeal = { customer: d.customer_name || "N/A", gross: g, vehicle: `${d.vehicle_year ?? ""} ${d.vehicle_make ?? ""} ${d.vehicle_model ?? ""}`.trim() };
      }
    }

    const topSalespeople = [...spMap.entries()]
      .map(([name, s]) => ({ name, deals: s.deals, gross: s.gross }))
      .sort((a, b) => b.deals - a.deals)
      .slice(0, 5);

    const topLenders = [...lenderMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    return {
      totalGross, totalFront, totalBack, avgPVR, count: filteredDeals.length,
      topSalespeople, highestDeal, warrantyCount, gapCount, topLenders,
      newCount, newAvgPvr: newCount > 0 ? newGrossSum / newCount : 0,
      usedCount, usedAvgPvr: usedCount > 0 ? usedGrossSum / usedCount : 0,
    };
  }, [filteredDeals]);

  // Footer averages / totals for the summary row
  const footerStats = useMemo(() => {
    const n = filteredDeals.length;
    if (n === 0) return null;

    const avg = (key: keyof Deal) => {
      const vals = filteredDeals.filter((d) => d[key] != null).map((d) => d[key] as number);
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    };

    // Most frequent lender
    const lenderCounts = new Map<string, number>();
    filteredDeals.forEach((d) => {
      if (d.lender) lenderCounts.set(d.lender, (lenderCounts.get(d.lender) ?? 0) + 1);
    });
    let topLender = "—";
    let topCount = 0;
    lenderCounts.forEach((count, lender) => {
      if (count > topCount) { topCount = count; topLender = lender; }
    });

    return {
      avgFrontGross: avg("front_gross"),
      topLender,
      avgRate: avg("rate"),
      avgReserve: avg("reserve"),
      avgWarranty: avg("warranty"),
      avgAft1: avg("aftermarket_1"),
      avgGap: avg("gap"),
      avgFiTotal: avg("fi_total"),
      totalGross: filteredDeals.reduce((s, d) => s + (d.total_gross ?? 0), 0),
    };
  }, [filteredDeals]);

  // Currency cell helper — compact format for the spreadsheet-style table
  const currencyCell = (key: keyof Deal, color?: string) => ({
    accessorKey: key,
    cell: ({ row }: { row: { getValue: (k: string) => unknown } }) => {
      const v = row.getValue(key as string) as number | null;
      if (v == null) return "—";
      return <span className={color ?? ""}>{formatCurrency(v)}</span>;
    },
  });

  // Build name → role map for closer badge colors
  const rosterRoleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roster) map.set(r.name, r.role ?? "sales");
    return map;
  }, [roster]);

  const columns: ColumnDef<Deal>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table: t }) => (
          <Checkbox
            checked={t.getIsAllRowsSelected()}
            onCheckedChange={(value) => t.toggleAllRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableResizing: false,
        size: 36,
      },
      {
        accessorKey: "status",
        header: ({ column }) => <SortableHeader column={column}>Status</SortableHeader>,
        size: 110,
        cell: ({ row }) => {
          const st = row.getValue("status") as string;
          const deal = row.original;
          return (
            <Select
              value={st}
              onValueChange={async (newStatus) => {
                // Optimistic update
                setDeals((prev) =>
                  prev.map((d) =>
                    d.id === deal.id ? { ...d, status: newStatus as Deal["status"] } : d,
                  ),
                );
                try {
                  await updateDealStatus(deal.id, deal.event_id, newStatus);
                  toast.success(`Status → ${newStatus}`);
                } catch (err) {
                  // Revert on failure
                  setDeals((prev) =>
                    prev.map((d) =>
                      d.id === deal.id ? { ...d, status: st as Deal["status"] } : d,
                    ),
                  );
                  toast.error(
                    err instanceof Error ? err.message : "Failed to update status",
                  );
                }
              }}
            >
              <SelectTrigger
                className={`h-7 w-[100px] text-[11px] font-medium border-0 px-2 ${STATUS_COLORS[st] ?? ""}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="funded">Funded</SelectItem>
                <SelectItem value="unwound">Unwound</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          );
        },
      },
      {
        accessorKey: "stock_number",
        header: ({ column }) => <SortableHeader column={column}>Stock #</SortableHeader>,
        size: 100,
        cell: ({ row }) => {
          const sn = row.getValue("stock_number") as string | null;
          if (!sn) return "—";
          const deal = row.original;
          return (
            <span className="flex items-center gap-1">
              {sn}
              {deal.is_trade_turn && (
                <span
                  className="inline-flex items-center rounded-sm bg-orange-100 px-1 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                  title="Trade-In Turn — this vehicle was traded in and resold"
                >
                  TI
                </span>
              )}
            </span>
          );
        },
      },
      { accessorKey: "customer_name", header: ({ column }) => <SortableHeader column={column}>Customer</SortableHeader>, size: 120 },
      { accessorKey: "customer_zip", header: ({ column }) => <SortableHeader column={column}>Zip</SortableHeader>, size: 60 },
      {
        accessorKey: "new_used",
        header: ({ column }) => <SortableHeader column={column}>N/U</SortableHeader>,
        size: 50,
        cell: ({ row }) => {
          const v = row.getValue("new_used") as string | null;
          if (!v) return "—";
          return v === "New" ? "N" : v === "Certified" ? "CPO" : "U";
        },
      },
      { accessorKey: "vehicle_year", header: ({ column }) => <SortableHeader column={column}>Year</SortableHeader>, size: 50 },
      { accessorKey: "vehicle_make", header: ({ column }) => <SortableHeader column={column}>Make</SortableHeader>, size: 80 },
      { accessorKey: "vehicle_model", header: ({ column }) => <SortableHeader column={column}>Model</SortableHeader>, size: 100 },
      {
        ...currencyCell("vehicle_cost"),
        header: ({ column }) => <SortableHeader column={column}>Cost</SortableHeader>,
        size: 85,
      },
      // Trade-in section
      { accessorKey: "trade_year", header: ({ column }) => <SortableHeader column={column}>Tr Year</SortableHeader>, size: 55 },
      { accessorKey: "trade_make", header: ({ column }) => <SortableHeader column={column}>Tr Make</SortableHeader>, size: 75 },
      { accessorKey: "trade_model", header: ({ column }) => <SortableHeader column={column}>Tr Model</SortableHeader>, size: 90 },
      {
        accessorKey: "trade_mileage",
        header: ({ column }) => <SortableHeader column={column}>Miles</SortableHeader>,
        size: 70,
        cell: ({ row }) => {
          const v = row.getValue("trade_mileage") as number | null;
          return v != null ? v.toLocaleString() : "—";
        },
      },
      {
        ...currencyCell("trade_acv"),
        header: ({ column }) => <SortableHeader column={column}>ACV</SortableHeader>,
        size: 80,
      },
      {
        ...currencyCell("trade_payoff"),
        header: ({ column }) => <SortableHeader column={column}>Payoff</SortableHeader>,
        size: 80,
      },
      // Sales staff
      { accessorKey: "salesperson", header: ({ column }) => <SortableHeader column={column}>Salesperson</SortableHeader>, size: 120 },
      { accessorKey: "second_salesperson", header: ({ column }) => <SortableHeader column={column}>2nd SP</SortableHeader>, size: 110 },
      // Closer
      {
        accessorKey: "closer",
        header: ({ column }) => <SortableHeader column={column}>Closer</SortableHeader>,
        size: 110,
        cell: ({ row }) => {
          const closer = row.getValue("closer") as string | null;
          if (!closer) return "—";
          const role = closer === "Home Team" ? "home_team" : (rosterRoleMap.get(closer) ?? "sales");
          return (
            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${CLOSER_ROLE_COLORS[role] ?? CLOSER_ROLE_COLORS.sales}`}>
              {closer}
            </Badge>
          );
        },
      },
      // Gross & Finance
      {
        ...currencyCell("front_gross"),
        header: ({ column }) => <SortableHeader column={column}>Front Gross</SortableHeader>,
        size: 100,
        cell: ({ row }) => {
          const v = row.getValue("front_gross") as number | null;
          if (v == null) return "—";
          return (
            <span className={v >= 0 ? "font-medium" : "font-medium text-red-600 dark:text-red-400"}>
              {formatCurrency(v)}
            </span>
          );
        },
      },
      { accessorKey: "lender", header: ({ column }) => <SortableHeader column={column}>Lender</SortableHeader>, size: 90 },
      {
        accessorKey: "rate",
        header: ({ column }) => <SortableHeader column={column}>Rate</SortableHeader>,
        size: 55,
        cell: ({ row }) => {
          const v = row.getValue("rate") as number | null;
          return v != null ? `${v}%` : "—";
        },
      },
      {
        ...currencyCell("reserve"),
        header: ({ column }) => <SortableHeader column={column}>Reserve</SortableHeader>,
        size: 80,
      },
      {
        ...currencyCell("warranty"),
        header: ({ column }) => <SortableHeader column={column}>Warranty</SortableHeader>,
        size: 80,
      },
      {
        ...currencyCell("aftermarket_1"),
        header: ({ column }) => <SortableHeader column={column}>Aft 1</SortableHeader>,
        size: 70,
      },
      {
        ...currencyCell("gap"),
        header: ({ column }) => <SortableHeader column={column}>GAP</SortableHeader>,
        size: 70,
      },
      {
        ...currencyCell("fi_total", "text-blue-700 dark:text-blue-400 font-medium"),
        header: ({ column }) => <SortableHeader column={column}>FI Total</SortableHeader>,
        size: 85,
      },
      {
        ...currencyCell("total_gross", "font-bold text-green-700 dark:text-green-400"),
        header: ({ column }) => <SortableHeader column={column}>Total Gross</SortableHeader>,
        size: 100,
        cell: ({ row }) => {
          const v = row.getValue("total_gross") as number | null;
          if (v == null) return "—";
          return (
            <span
              className={`font-bold ${v >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
            >
              {formatCurrency(v)}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableResizing: false,
        size: 40,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingDeal(row.original)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Deal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [rosterRoleMap],
  );

  const table = useReactTable({
    data: filteredDeals,
    columns,
    state: { sorting, globalFilter, rowSelection, columnSizing },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const { rows } = table.getRowModel();

  const selectedIds = Object.keys(rowSelection)
    .filter((key) => rowSelection[key])
    .map((key) => {
      const row = rows[parseInt(key)];
      return row?.original?.id;
    })
    .filter(Boolean) as string[];

  const handleBulkDeleteDeals = async () => {
    if (!currentEvent || selectedIds.length === 0) return;
    setBulkLoading(true);
    const previousDeals = deals;
    setDeals((prev) => prev.filter((d) => !selectedIds.includes(d.id)));
    try {
      await bulkDeleteDeals(selectedIds, currentEvent.id);
      toast.success(`${selectedIds.length} deal(s) deleted`);
      setRowSelection({});
    } catch (err) {
      setDeals(previousDeals);
      toast.error(err instanceof Error ? err.message : "Failed to delete deals");
    } finally {
      setBulkLoading(false);
    }
  };

  // Virtualization for large deal lists
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => tableContainerRef.current,
    overscan: 20,
  });

  const exportCSV = () => {
    const csvHeaders = [
      "Stock #", "Customer", "Zip", "New/Used", "Year", "Make", "Model", "Cost",
      "Trade Year", "Trade Make", "Trade Model", "Miles", "ACV", "Payoff",
      "Salesperson", "2nd Salesperson", "Closer", "Front Gross", "Lender", "Rate",
      "Reserve", "Warranty", "Aft 1", "GAP", "FI Total", "Total Gross", "Status",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") ? `"${s}"` : s;
    };
    const csvRows = filteredDeals.map((d) =>
      [
        d.stock_number, d.customer_name, d.customer_zip, d.new_used,
        d.vehicle_year, d.vehicle_make, d.vehicle_model, d.vehicle_cost,
        d.trade_year, d.trade_make, d.trade_model, d.trade_mileage,
        d.trade_acv, d.trade_payoff,
        d.salesperson, d.second_salesperson, d.closer, d.front_gross, d.lender, d.rate,
        d.reserve, d.warranty, d.aftermarket_1, d.gap, d.fi_total,
        d.total_gross, d.status,
      ].map(esc).join(","),
    );
    const csv = [csvHeaders.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deals_${currentEvent?.name ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Deals exported to CSV");
  };

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Select an event to view deals</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Deal Log
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} — {stats.count} deals
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LastSyncedIndicator syncedAt={lastSyncedAt} />
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/deals/new">
              <Plus className="h-4 w-4" />
              New Deal
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Deals</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Gross</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {formatCurrency(stats.totalGross)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Front Gross</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(stats.totalFront)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Back Gross</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-700">
              {formatCurrency(stats.totalBack)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg PVR</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(stats.avgPVR)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stats Row 2 — Insights */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Top Salespeople</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {stats.topSalespeople.slice(0, 3).map((sp, i) => (
                <div key={sp.name} className="flex justify-between text-sm">
                  <span className="truncate">{i + 1}. {sp.name}</span>
                  <span className="font-semibold">{sp.deals} deals</span>
                </div>
              ))}
              {stats.topSalespeople.length === 0 && (
                <p className="text-sm text-muted-foreground">No data</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>New vs Used</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>New: {stats.newCount}</span>
                <span className="text-muted-foreground">Avg {formatCurrency(stats.newAvgPvr)}</span>
              </div>
              <div className="flex justify-between">
                <span>Used: {stats.usedCount}</span>
                <span className="text-muted-foreground">Avg {formatCurrency(stats.usedAvgPvr)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Warranty Sold</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {stats.warrantyCount}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                / {stats.count} ({stats.count > 0 ? Math.round((stats.warrantyCount / stats.count) * 100) : 0}%)
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>GAP Penetration</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {stats.gapCount}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                / {stats.count} ({stats.count > 0 ? Math.round((stats.gapCount / stats.count) * 100) : 0}%)
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Top Lenders</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {stats.topLenders.slice(0, 3).map((l, i) => (
                <div key={l.name} className="flex justify-between text-sm">
                  <span className="truncate">{i + 1}. {l.name}</span>
                  <span className="font-semibold">{l.count}</span>
                </div>
              ))}
              {stats.topLenders.length === 0 && (
                <p className="text-sm text-muted-foreground">No data</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search deals..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs h-9"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="funded">Funded</SelectItem>
            <SelectItem value="unwound">Unwound</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selectedIds.length}
          onClearSelection={() => setRowSelection({})}
          isLoading={bulkLoading}
        >
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={bulkLoading}
            onClick={handleBulkDeleteDeals}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete Selected
          </Button>
        </BulkActionsToolbar>
      )}

      {/* Virtualized Table */}
      {loading ? (
        <LoadingTableSkeleton rows={8} columns={7} />
      ) : rows.length === 0 ? (
        <div className="rounded-md border">
          <div className="flex flex-col items-center gap-2 py-16">
            {deals.length === 0 ? (
              <>
                <Handshake className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">No deals yet.</p>
                <Button size="sm" asChild>
                  <Link href="/dashboard/deals/new">Log First Deal</Link>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">No deals match your filters.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={tableContainerRef}
            className="rounded-md border overflow-auto"
            style={{ maxHeight: "calc(100vh - 380px)", minHeight: 300 }}
          >
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="whitespace-nowrap relative group/th"
                        style={
                          columnSizing[header.column.id] != null
                            ? { width: header.getSize(), minWidth: header.getSize() }
                            : {}
                        }
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                        {/* Column resize handle */}
                        {header.column.getCanResize() && (
                          <div
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            onDoubleClick={() => header.column.resetSize()}
                            className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none
                              ${header.column.getIsResizing()
                                ? "bg-primary"
                                : "bg-transparent group-hover/th:bg-border hover:!bg-primary/50"
                              }`}
                          />
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr>
                    <td
                      colSpan={columns.length}
                      style={{ height: rowVirtualizer.getVirtualItems()[0]?.start ?? 0, padding: 0 }}
                    />
                  </tr>
                )}
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return (
                    <TableRow key={row.id} style={{ height: ROW_HEIGHT }}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className="whitespace-nowrap py-1"
                          style={
                            columnSizing[cell.column.id] != null
                              ? { width: cell.column.getSize(), minWidth: cell.column.getSize() }
                              : {}
                          }
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr>
                    <td
                      colSpan={columns.length}
                      style={{
                        height:
                          rowVirtualizer.getTotalSize() -
                          (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                        padding: 0,
                      }}
                    />
                  </tr>
                )}
              </TableBody>
            </table>
          </div>

          {/* Averages / Totals footer bar */}
          {footerStats && (
            <div className="rounded-md border bg-muted/80 px-4 py-2">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">
                  Averages
                </span>
                <span>
                  Front Gross:{" "}
                  <span className="font-semibold">{formatCurrency(footerStats.avgFrontGross)}</span>
                </span>
                <span>
                  Lender:{" "}
                  <span className="font-semibold">{footerStats.topLender}</span>
                </span>
                <span>
                  Rate:{" "}
                  <span className="font-semibold">{footerStats.avgRate.toFixed(1)}%</span>
                </span>
                <span>
                  Reserve:{" "}
                  <span className="font-semibold">{formatCurrency(footerStats.avgReserve)}</span>
                </span>
                <span>
                  Warranty:{" "}
                  <span className="font-semibold">{formatCurrency(footerStats.avgWarranty)}</span>
                </span>
                <span>
                  Aft 1:{" "}
                  <span className="font-semibold">{formatCurrency(footerStats.avgAft1)}</span>
                </span>
                <span>
                  GAP:{" "}
                  <span className="font-semibold">{formatCurrency(footerStats.avgGap)}</span>
                </span>
                <span>
                  FI Total:{" "}
                  <span className="font-semibold text-blue-700 dark:text-blue-400">
                    {formatCurrency(footerStats.avgFiTotal)}
                  </span>
                </span>
                <span className="border-l pl-5 border-border">
                  Total Gross:{" "}
                  <span className="font-bold text-green-700 dark:text-green-400">
                    {formatCurrency(footerStats.totalGross)}
                  </span>
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end">
            <span className="text-xs text-muted-foreground">
              {rows.length} deals
            </span>
          </div>
        </>
      )}

      {/* Edit Deal Dialog */}
      <Dialog
        open={editingDeal !== null}
        onOpenChange={(open) => {
          if (!open) setEditingDeal(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] p-0">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>Edit Deal</DialogTitle>
            <DialogDescription>
              {editingDeal
                ? `${editingDeal.customer_name ?? ""} — ${editingDeal.stock_number ?? "No stock #"}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[calc(90vh-80px)] px-6 pb-6">
            {editingDeal && (
              <EditDealForm
                deal={editingDeal}
                onSuccess={() => setEditingDeal(null)}
                onSheetSynced={() => setLastSyncedAt(new Date())}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
