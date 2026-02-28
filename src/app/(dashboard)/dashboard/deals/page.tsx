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
  flexRender,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { bulkDeleteDeals } from "@/lib/actions/deals";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  funded: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  unwound: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const ROW_HEIGHT = 40;

export default function DealsPage() {
  const { currentEvent } = useEvent();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
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
    return { totalGross, totalFront, totalBack, avgPVR, count: filteredDeals.length };
  }, [filteredDeals]);

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
        size: 40,
      },
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
            <span className={v >= 0 ? "font-medium" : "font-medium text-red-600 dark:text-red-400"}>
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
            <span className="text-blue-700 dark:text-blue-400">{formatCurrency(v)}</span>
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
              className={`font-bold ${v >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
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
      {
        id: "actions",
        header: "",
        size: 50,
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
    [],
  );

  const table = useReactTable({
    data: filteredDeals,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
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
      "Deal #", "Status", "Day", "Stock #", "Customer", "Vehicle", "Sales",
      "Lender", "Front", "Back", "Total", "Washout",
    ];
    const csvRows = filteredDeals.map((d) =>
      [
        d.deal_number, d.status, d.sale_day, d.stock_number, d.customer_name,
        `${d.vehicle_year ?? ""} ${d.vehicle_make ?? ""} ${d.vehicle_model ?? ""}`.trim(),
        d.salesperson, d.lender, d.front_gross, d.back_gross, d.total_gross,
        d.is_washout ? "Y" : "N",
      ].join(","),
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
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
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
                        <TableCell key={cell.id} className="whitespace-nowrap py-1">
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
            </Table>
          </div>

          {/* Totals footer */}
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
            <span className="text-xs text-muted-foreground">
              {rows.length} deals (virtualized)
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
