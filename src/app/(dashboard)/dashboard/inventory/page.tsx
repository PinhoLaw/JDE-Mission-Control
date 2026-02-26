"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Vehicle } from "@/types/database";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
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
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpDown,
  Download,
  Upload,
  MoreHorizontal,
  Trash2,
  Package,
  Handshake,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  updateVehicleStatus,
  deleteVehicles,
} from "@/lib/actions/inventory";

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  sold: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  hold: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  wholesale: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export default function InventoryPage() {
  const { currentEvent } = useEvent();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [makeFilter, setMakeFilter] = useState("all");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkLoading, setBulkLoading] = useState(false);

  // Load vehicles for current event
  useEffect(() => {
    if (!currentEvent) return;
    setLoading(true);
    const supabase = createClient();

    supabase
      .from("vehicle_inventory")
      .select("*")
      .eq("event_id", currentEvent.id)
      .order("hat_number", { ascending: true })
      .then(({ data }) => {
        setVehicles(data ?? []);
        setLoading(false);
      });

    // Realtime subscription
    const channel = supabase
      .channel(`inventory-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vehicle_inventory",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setVehicles((prev) => [...prev, payload.new as Vehicle]);
          } else if (payload.eventType === "UPDATE") {
            setVehicles((prev) =>
              prev.map((v) =>
                v.id === (payload.new as Vehicle).id
                  ? (payload.new as Vehicle)
                  : v,
              ),
            );
          } else if (payload.eventType === "DELETE") {
            setVehicles((prev) =>
              prev.filter((v) => v.id !== (payload.old as { id: string }).id),
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent]);

  // Derived data
  const filteredVehicles = useMemo(() => {
    let data = vehicles;
    if (statusFilter !== "all") data = data.filter((v) => v.status === statusFilter);
    if (makeFilter !== "all") data = data.filter((v) => v.make === makeFilter);
    return data;
  }, [vehicles, statusFilter, makeFilter]);

  const makes = useMemo(
    () => [...new Set(vehicles.map((v) => v.make).filter(Boolean))].sort(),
    [vehicles],
  );

  const stats = useMemo(() => {
    const total = filteredVehicles.length;
    const available = filteredVehicles.filter((v) => v.status === "available").length;
    const sold = filteredVehicles.filter((v) => v.status === "sold").length;
    const totalCost = filteredVehicles.reduce((s, v) => s + (v.acquisition_cost ?? 0), 0);
    const avgCost = total > 0 ? totalCost / total : 0;
    return { total, available, sold, totalCost, avgCost };
  }, [filteredVehicles]);

  // Columns
  const columns: ColumnDef<Vehicle>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table: t }) => (
          <Checkbox
            checked={t.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => t.toggleAllPageRowsSelected(!!value)}
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
      { accessorKey: "hat_number", header: "#", size: 50 },
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
      { accessorKey: "stock_number", header: "Stock #" },
      { accessorKey: "year", header: "Year", size: 60 },
      { accessorKey: "make", header: "Make" },
      { accessorKey: "model", header: "Model" },
      { accessorKey: "trim", header: "Trim" },
      { accessorKey: "color", header: "Color" },
      {
        accessorKey: "mileage",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Miles <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("mileage") as number | null;
          return v != null ? v.toLocaleString() : "—";
        },
      },
      {
        accessorKey: "acquisition_cost",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Cost <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("acquisition_cost") as number | null;
          return v != null ? formatCurrency(v) : "—";
        },
      },
      {
        accessorKey: "asking_price_120",
        header: "Ask 120%",
        cell: ({ row }) => {
          const v = row.getValue("asking_price_120") as number | null;
          return v != null ? formatCurrency(v) : "—";
        },
      },
      {
        accessorKey: "profit_120",
        header: "Profit 20%",
        cell: ({ row }) => {
          const v = row.original.profit_120;
          if (v == null) return "—";
          return (
            <span className={v >= 0 ? "text-green-700 font-medium" : "text-red-600"}>
              {formatCurrency(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "retail_spread",
        header: "Spread",
        cell: ({ row }) => {
          const v = row.original.retail_spread;
          if (v == null) return "—";
          return (
            <span className={v >= 0 ? "text-green-700 font-bold" : "text-red-600 font-bold"}>
              {formatCurrency(v)}
            </span>
          );
        },
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const vehicle = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {vehicle.status === "available" && (
                  <DropdownMenuItem asChild>
                    <Link
                      href={`/dashboard/deals/new?stock=${vehicle.stock_number ?? ""}&vehicleId=${vehicle.id}`}
                    >
                      <Handshake className="mr-2 h-4 w-4" />
                      Quick Log Deal
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => handleStatusChange([vehicle.id], "hold")}
                >
                  Mark Hold
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChange([vehicle.id], "available")}
                >
                  Mark Available
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChange([vehicle.id], "wholesale")}
                >
                  Mark Wholesale
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        size: 50,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const table = useReactTable({
    data: filteredVehicles,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
    enableRowSelection: true,
  });

  const selectedIds = Object.keys(rowSelection)
    .filter((key) => rowSelection[key])
    .map((key) => {
      const row = table.getRowModel().rows[parseInt(key)];
      return row?.original?.id;
    })
    .filter(Boolean) as string[];

  // ── Bulk actions ──
  const handleStatusChange = useCallback(
    async (ids: string[], status: "available" | "sold" | "hold" | "pending" | "wholesale") => {
      if (!currentEvent) return;
      setBulkLoading(true);
      try {
        await updateVehicleStatus(ids, status, currentEvent.id);
        toast.success(`${ids.length} vehicle(s) marked as ${status}`);
        setRowSelection({});
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setBulkLoading(false);
      }
    },
    [currentEvent],
  );

  const handleBulkDelete = useCallback(async () => {
    if (!currentEvent || selectedIds.length === 0) return;
    setBulkLoading(true);
    try {
      await deleteVehicles(selectedIds, currentEvent.id);
      toast.success(`${selectedIds.length} vehicle(s) deleted`);
      setRowSelection({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBulkLoading(false);
    }
  }, [currentEvent, selectedIds]);

  const exportCSV = useCallback(() => {
    const csvHeaders = [
      "Hat #", "Status", "Stock #", "Year", "Make", "Model", "Trim", "Color",
      "Mileage", "Cost", "Ask 120%", "Profit 20%", "Spread",
    ];
    const rows = filteredVehicles.map((v) =>
      [
        v.hat_number, v.status, v.stock_number, v.year, v.make, v.model,
        v.trim, v.color, v.mileage, v.acquisition_cost, v.asking_price_120,
        v.profit_120, v.retail_spread,
      ].join(","),
    );
    const csv = [csvHeaders.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory_${currentEvent?.name ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Inventory exported to CSV");
  }, [filteredVehicles, currentEvent]);

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">Select an event to view inventory</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} — Vehicle inventory
            with pricing tiers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/inventory/import">
              <Upload className="h-4 w-4" />
              Import
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Vehicles</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">{stats.available}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sold</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{stats.sold}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Cost</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(stats.avgCost)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search inventory..."
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
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
            <SelectItem value="hold">Hold</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="wholesale">Wholesale</SelectItem>
          </SelectContent>
        </Select>
        <Select value={makeFilter} onValueChange={setMakeFilter}>
          <SelectTrigger className="w-[150px] h-9">
            <SelectValue placeholder="Make" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Makes</SelectItem>
            {makes.map((m) => (
              <SelectItem key={m!} value={m!}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Bulk actions */}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-muted-foreground">
              {selectedIds.length} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading}>
                  {bulkLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Bulk Actions <ChevronDown className="ml-1 h-3 w-3" />
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => handleStatusChange(selectedIds, "available")}
                >
                  <Package className="mr-2 h-4 w-4" /> Mark Available
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChange(selectedIds, "hold")}
                >
                  Mark Hold
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChange(selectedIds, "wholesale")}
                >
                  Mark Wholesale
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={handleBulkDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete Selected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
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
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className={
                        row.original.status === "sold" ? "opacity-60" : ""
                      }
                    >
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
                      {vehicles.length === 0 ? (
                        <div className="flex flex-col items-center gap-2">
                          <Package className="h-8 w-8 text-muted-foreground" />
                          <p className="text-muted-foreground">
                            No vehicles yet.
                          </p>
                          <Button size="sm" asChild>
                            <Link href="/dashboard/inventory/import">
                              Import Inventory
                            </Link>
                          </Button>
                        </div>
                      ) : (
                        "No vehicles match your filters."
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {table.getRowModel().rows.length} of {filteredVehicles.length}{" "}
              vehicles
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <span className="flex items-center text-xs">
                Page {table.getState().pagination.pageIndex + 1} of{" "}
                {table.getPageCount()}
              </span>
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
