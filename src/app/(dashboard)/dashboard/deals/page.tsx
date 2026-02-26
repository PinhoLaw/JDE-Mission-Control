"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Deal } from "@/types/database";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type SortingState,
  flexRender,
} from "@tanstack/react-table";
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
import { Badge } from "@/components/ui/badge";
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
  ArrowUpDown,
  Download,
  Plus,
  Loader2,
  Handshake,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  funded: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  unwound: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export default function DealsPage() {
  const { currentEvent } = useEvent();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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
    return { totalGross, totalFront, totalBack, avgPVR, count: filteredDeals.length };
  }, [filteredDeals]);

  const columns: ColumnDef<Deal>[] = useMemo(
    () => [
      { accessorKey: "deal_number", header: "Deal #", size: 60 },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const st = row.getValue("status") as string;
          return (
            <Badge variant="secondary" className={STATUS_COLORS[st] ?? ""}>
              {st}
            </Badge>
          );
        },
      },
      { accessorKey: "sale_day", header: "Day", size: 50 },
      { accessorKey: "stock_number", header: "Stock #" },
      { accessorKey: "customer_name", header: "Customer" },
      {
        id: "vehicle",
        header: "Vehicle",
        cell: ({ row }) =>
          `${row.original.vehicle_year ?? ""} ${row.original.vehicle_make ?? ""} ${row.original.vehicle_model ?? ""}`.trim() ||
          "—",
      },
      { accessorKey: "salesperson", header: "Sales" },
      { accessorKey: "lender", header: "Lender" },
      {
        accessorKey: "front_gross",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Front <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("front_gross") as number | null;
          if (v == null) return "—";
          return (
            <span className={v >= 0 ? "font-medium" : "font-medium text-red-600"}>
              {formatCurrency(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "back_gross",
        header: "Back",
        cell: ({ row }) => {
          const v = row.getValue("back_gross") as number | null;
          return v != null ? (
            <span className="text-blue-700">{formatCurrency(v)}</span>
          ) : (
            "—"
          );
        },
      },
      {
        accessorKey: "total_gross",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Total <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("total_gross") as number | null;
          if (v == null) return "—";
          return (
            <span
              className={`font-bold ${v >= 0 ? "text-green-700" : "text-red-600"}`}
            >
              {formatCurrency(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "is_washout",
        header: "Wash",
        size: 50,
        cell: ({ row }) =>
          row.original.is_washout ? (
            <Badge variant="destructive" className="text-[10px]">
              W
            </Badge>
          ) : null,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredDeals,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  const exportCSV = () => {
    const csvHeaders = [
      "Deal #", "Status", "Day", "Stock #", "Customer", "Vehicle", "Sales",
      "Lender", "Front", "Back", "Total", "Washout",
    ];
    const rows = filteredDeals.map((d) =>
      [
        d.deal_number, d.status, d.sale_day, d.stock_number, d.customer_name,
        `${d.vehicle_year ?? ""} ${d.vehicle_make ?? ""} ${d.vehicle_model ?? ""}`.trim(),
        d.salesperson, d.lender, d.front_gross, d.back_gross, d.total_gross,
        d.is_washout ? "Y" : "N",
      ].join(","),
    );
    const csv = [csvHeaders.join(","), ...rows].join("\n");
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
            {currentEvent.dealer_name ?? currentEvent.name} — All deals with
            front/back gross and F&I breakdown
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="whitespace-nowrap">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      {deals.length === 0 ? (
                        <div className="flex flex-col items-center gap-2">
                          <Handshake className="h-8 w-8 text-muted-foreground" />
                          <p className="text-muted-foreground">No deals yet.</p>
                          <Button size="sm" asChild>
                            <Link href="/dashboard/deals/new">
                              Log First Deal
                            </Link>
                          </Button>
                        </div>
                      ) : (
                        "No deals match your filters."
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Totals + Pagination */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex gap-6 font-medium">
              <span>
                Front:{" "}
                <span className="text-green-700">
                  {formatCurrency(stats.totalFront)}
                </span>
              </span>
              <span>
                Back:{" "}
                <span className="text-blue-700">
                  {formatCurrency(stats.totalBack)}
                </span>
              </span>
              <span>
                Total:{" "}
                <span className="text-green-700 font-bold">
                  {formatCurrency(stats.totalGross)}
                </span>
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
