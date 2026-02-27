"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Vehicle } from "@/types/database";
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
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  updateVehicleStatus,
  deleteVehicles,
} from "@/lib/actions/inventory";
import { uploadVehiclePhoto } from "@/lib/actions/photos";

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  sold: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  hold: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  wholesale: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

const ROW_HEIGHT = 40;

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
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);

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

  // Photo upload handler
  const handlePhotoUpload = useCallback(
    async (vehicleId: string, file: File) => {
      if (!currentEvent) return;
      setUploadingPhotoId(vehicleId);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("vehicleId", vehicleId);
        formData.append("eventId", currentEvent.id);
        const result = await uploadVehiclePhoto(formData);
        if (result.success) {
          toast.success("Photo uploaded");
          // Optimistic update
          setVehicles((prev) =>
            prev.map((v) =>
              v.id === vehicleId ? { ...v, photo_url: result.url } : v,
            ),
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Photo upload failed");
      } finally {
        setUploadingPhotoId(null);
      }
    },
    [currentEvent],
  );

  // ── Currency cell helper ──
  const currencyCell = (val: number | null | undefined) =>
    val != null ? formatCurrency(val) : "—";

  const diffCell = (val: number | null | undefined) => {
    if (val == null) return "—";
    return (
      <span className={val >= 0 ? "text-green-700 font-semibold" : "text-red-600 font-semibold"}>
        {formatCurrency(val)}
      </span>
    );
  };

  // ── Columns: EXACT 18-column spec ──
  // 1.Stock# 2.Year 3.Make 4.Model 5.Class 6.Color 7.Odometer 8.VIN#
  // 9.Series 10.Age 11.CleanTrade 12.CleanRetail 13.UnitCost 14.DIFF
  // 15.115% 16.120% 17.125% 18.130%
  const columns: ColumnDef<Vehicle>[] = useMemo(
    () => [
      // ── Utility: checkbox ──
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
      // ── 1. Stock # ──
      { accessorKey: "stock_number", header: "Stock #", size: 90 },
      // ── 2. Year ──
      { accessorKey: "year", header: "Year", size: 55 },
      // ── 3. Make ──
      { accessorKey: "make", header: "Make", size: 80 },
      // ── 4. Model ──
      { accessorKey: "model", header: "Model", size: 100 },
      // ── 5. Class (body_style) ──
      { accessorKey: "body_style", header: "Class", size: 70 },
      // ── 6. Color ──
      { accessorKey: "color", header: "Color", size: 80 },
      // ── 7. Odometer (mileage) ──
      {
        accessorKey: "mileage",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Odometer <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("mileage") as number | null;
          return v != null ? v.toLocaleString() : "—";
        },
        size: 90,
      },
      // ── 8. VIN # ──
      { accessorKey: "vin", header: "VIN #", size: 160 },
      // ── 9. Series (trim) ──
      { accessorKey: "trim", header: "Series", size: 100 },
      // ── 10. Age ──
      { accessorKey: "age_days", header: "Age", size: 50 },
      // ── 11. Clean Trade (jd_trade_clean) ──
      {
        accessorKey: "jd_trade_clean",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Clean Trade <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => currencyCell(row.getValue("jd_trade_clean") as number | null),
        size: 110,
      },
      // ── 12. Clean Retail (jd_retail_clean) ──
      {
        accessorKey: "jd_retail_clean",
        header: "Clean Retail",
        cell: ({ row }) => currencyCell(row.getValue("jd_retail_clean") as number | null),
        size: 110,
      },
      // ── 13. Unit Cost (acquisition_cost) ──
      {
        accessorKey: "acquisition_cost",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Unit Cost <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => currencyCell(row.getValue("acquisition_cost") as number | null),
        size: 100,
      },
      // ── 14. DIFF (retail_spread = jd_trade_clean - acquisition_cost) ──
      {
        accessorKey: "retail_spread",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            DIFF <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => diffCell(row.original.retail_spread),
        size: 90,
      },
      // ── 15. 115% ──
      {
        accessorKey: "asking_price_115",
        header: "115%",
        cell: ({ row }) => currencyCell(row.getValue("asking_price_115") as number | null),
        size: 90,
      },
      // ── 16. 120% ──
      {
        accessorKey: "asking_price_120",
        header: "120%",
        cell: ({ row }) => currencyCell(row.getValue("asking_price_120") as number | null),
        size: 90,
      },
      // ── 17. 125% ──
      {
        accessorKey: "asking_price_125",
        header: "125%",
        cell: ({ row }) => currencyCell(row.getValue("asking_price_125") as number | null),
        size: 90,
      },
      // ── 18. 130% ──
      {
        accessorKey: "asking_price_130",
        header: "130%",
        cell: ({ row }) => currencyCell(row.getValue("asking_price_130") as number | null),
        size: 90,
      },
      // ── Utility: status badge ──
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
        size: 90,
      },
      // ── Utility: actions menu ──
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
    [uploadingPhotoId],
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
    enableRowSelection: true,
  });

  const { rows } = table.getRowModel();

  // Virtualization for 300+ rows
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => tableContainerRef.current,
    overscan: 20,
  });

  const selectedIds = Object.keys(rowSelection)
    .filter((key) => rowSelection[key])
    .map((key) => {
      const row = rows[parseInt(key)];
      return row?.original?.id;
    })
    .filter(Boolean) as string[];

  // ── Bulk actions with optimistic updates ──
  const handleStatusChange = useCallback(
    async (ids: string[], status: "available" | "sold" | "hold" | "pending" | "wholesale") => {
      if (!currentEvent) return;
      setBulkLoading(true);
      // Optimistic update
      const previousVehicles = vehicles;
      setVehicles((prev) =>
        prev.map((v) => (ids.includes(v.id) ? { ...v, status } : v)),
      );
      try {
        await updateVehicleStatus(ids, status, currentEvent.id);
        toast.success(`${ids.length} vehicle(s) marked as ${status}`);
        setRowSelection({});
      } catch (err) {
        // Rollback on error
        setVehicles(previousVehicles);
        toast.error(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setBulkLoading(false);
      }
    },
    [currentEvent, vehicles],
  );

  const handleBulkDelete = useCallback(async () => {
    if (!currentEvent || selectedIds.length === 0) return;
    setBulkLoading(true);
    // Optimistic update
    const previousVehicles = vehicles;
    setVehicles((prev) => prev.filter((v) => !selectedIds.includes(v.id)));
    try {
      await deleteVehicles(selectedIds, currentEvent.id);
      toast.success(`${selectedIds.length} vehicle(s) deleted`);
      setRowSelection({});
    } catch (err) {
      setVehicles(previousVehicles);
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBulkLoading(false);
    }
  }, [currentEvent, selectedIds, vehicles]);

  const exportCSV = useCallback(() => {
    const csvHeaders = [
      "Stock #", "Year", "Make", "Model", "Class", "Color", "Odometer",
      "VIN #", "Series", "Age", "Clean Trade", "Clean Retail", "Unit Cost",
      "DIFF", "115%", "120%", "125%", "130%", "Status",
    ];
    const esc = (v: unknown) => {
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvRows = filteredVehicles.map((v) =>
      [
        esc(v.stock_number), v.year, esc(v.make), esc(v.model), esc(v.body_style),
        esc(v.color), v.mileage, esc(v.vin), esc(v.trim), v.age_days,
        v.jd_trade_clean, v.jd_retail_clean, v.acquisition_cost, v.retail_spread,
        v.asking_price_115, v.asking_price_120, v.asking_price_125, v.asking_price_130,
        v.status,
      ].join(","),
    );
    const csv = [csvHeaders.join(","), ...csvRows].join("\n");
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
      {/* Hidden photo input */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const vehicleId = photoInputRef.current?.getAttribute("data-vehicle-id");
          if (file && vehicleId) {
            handlePhotoUpload(vehicleId, file);
          }
          e.target.value = "";
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} — {stats.total} vehicles
            {stats.total > 100 && " (virtualized)"}
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

      {/* Virtualized Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border">
          <div className="flex flex-col items-center gap-2 py-16">
            {vehicles.length === 0 ? (
              <>
                <Package className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">No vehicles yet.</p>
                <Button size="sm" asChild>
                  <Link href="/dashboard/inventory/import">Import Inventory</Link>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">No vehicles match your filters.</p>
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
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className={row.original.status === "sold" ? "opacity-60" : ""}
                      style={{ height: ROW_HEIGHT }}
                    >
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

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {rows.length} vehicles
              {selectedIds.length > 0 && ` (${selectedIds.length} selected)`}
            </span>
            <span className="text-xs">
              Virtualized — all {rows.length} rows rendered efficiently
            </span>
          </div>
        </>
      )}
    </div>
  );
}
