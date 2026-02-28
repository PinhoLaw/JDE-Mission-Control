"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { Vehicle } from "@/types/database";
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
import { BulkActionsToolbar } from "@/components/ui/data-table-bulk-actions";
import { uploadVehiclePhoto } from "@/lib/actions/photos";
import { useSheetPush } from "@/hooks/useSheetPush";

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
  const { push: sheetPush } = useSheetPush();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [makeFilter, setMakeFilter] = useState("all");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [pricingMode, setPricingMode] = useState<"trade" | "retail">("trade");
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  // Ref to avoid stale closure — columns useMemo is defined before handleStatusChange
  const handleStatusChangeRef = useRef<
    (ids: string[], status: "available" | "sold" | "hold" | "pending" | "wholesale") => Promise<void>
  >(() => Promise.resolve());

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
      <span className={val >= 0 ? "text-green-700 dark:text-green-400 font-semibold" : "text-red-600 dark:text-red-400 font-semibold"}>
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
      {
        accessorKey: "stock_number",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Stock # <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 90,
      },
      // ── 2. Year ──
      {
        accessorKey: "year",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Year <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 55,
      },
      // ── 3. Make ──
      {
        accessorKey: "make",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Make <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 80,
      },
      // ── 4. Model ──
      {
        accessorKey: "model",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Model <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 100,
      },
      // ── 5. Class (body_style) ──
      {
        accessorKey: "body_style",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Class <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 70,
      },
      // ── 6. Color ──
      {
        accessorKey: "color",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Color <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 80,
      },
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
      {
        accessorKey: "vin",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            VIN # <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 160,
      },
      // ── 9. Series (trim) ──
      {
        accessorKey: "trim",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Series <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 100,
      },
      // ── 10. Age ──
      {
        accessorKey: "age_days",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Age <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        size: 50,
      },
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
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Clean Retail <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
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
      // ── 14. DIFF (dynamic: trade or retail based) ──
      {
        id: "diff",
        accessorFn: (row) => {
          const base = pricingMode === "trade" ? row.jd_trade_clean : row.jd_retail_clean;
          if (base == null || row.acquisition_cost == null) return null;
          return base - row.acquisition_cost;
        },
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
        cell: ({ row }) => {
          const v = row.original;
          const base = pricingMode === "trade" ? v.jd_trade_clean : v.jd_retail_clean;
          if (base == null || v.acquisition_cost == null) return "—";
          const diff = base - v.acquisition_cost;
          return diffCell(diff);
        },
        size: 90,
      },
      // ── 15. 115% (dynamic) ──
      {
        id: "pct_115",
        accessorFn: (row) => {
          const base = pricingMode === "trade" ? row.jd_trade_clean : row.jd_retail_clean;
          return base != null ? Math.round(base * 1.15) : null;
        },
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            115% <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const base = pricingMode === "trade" ? row.original.jd_trade_clean : row.original.jd_retail_clean;
          return currencyCell(base != null ? Math.round(base * 1.15) : null);
        },
        size: 90,
      },
      // ── 16. 120% (dynamic) ──
      {
        id: "pct_120",
        accessorFn: (row) => {
          const base = pricingMode === "trade" ? row.jd_trade_clean : row.jd_retail_clean;
          return base != null ? Math.round(base * 1.20) : null;
        },
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            120% <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const base = pricingMode === "trade" ? row.original.jd_trade_clean : row.original.jd_retail_clean;
          return currencyCell(base != null ? Math.round(base * 1.20) : null);
        },
        size: 90,
      },
      // ── 17. 125% (dynamic) ──
      {
        id: "pct_125",
        accessorFn: (row) => {
          const base = pricingMode === "trade" ? row.jd_trade_clean : row.jd_retail_clean;
          return base != null ? Math.round(base * 1.25) : null;
        },
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            125% <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const base = pricingMode === "trade" ? row.original.jd_trade_clean : row.original.jd_retail_clean;
          return currencyCell(base != null ? Math.round(base * 1.25) : null);
        },
        size: 90,
      },
      // ── 18. 130% (dynamic) ──
      {
        id: "pct_130",
        accessorFn: (row) => {
          const base = pricingMode === "trade" ? row.jd_trade_clean : row.jd_retail_clean;
          return base != null ? Math.round(base * 1.30) : null;
        },
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            130% <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const base = pricingMode === "trade" ? row.original.jd_trade_clean : row.original.jd_retail_clean;
          return currencyCell(base != null ? Math.round(base * 1.30) : null);
        },
        size: 90,
      },
      // ── Utility: status badge ──
      {
        accessorKey: "status",
        header: ({ column }) => (
          <Button variant="ghost" size="sm" className="h-8 px-1 -ml-1"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Status <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
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
                  onClick={() => handleStatusChangeRef.current([vehicle.id], "sold")}
                >
                  <Handshake className="mr-2 h-4 w-4" />
                  Mark as Sold
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChangeRef.current([vehicle.id], "hold")}
                >
                  Mark Hold
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChangeRef.current([vehicle.id], "available")}
                >
                  Mark Available
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChangeRef.current([vehicle.id], "wholesale")}
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
    [uploadingPhotoId, pricingMode],
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

  // ── Push status change to Google Sheets ──
  const pushToSheet = useCallback(
    async (vehicleList: Vehicle[], status: string) => {
      let pushed = 0;
      for (const vehicle of vehicleList) {
        if (!vehicle.stock_number) continue;
        const sheetData = {
          "Status": status.toUpperCase(),
          "Price": vehicle.acquisition_cost ? String(vehicle.acquisition_cost) : "",
          "Year": vehicle.year ? String(vehicle.year) : "",
          "Make": vehicle.make ?? "",
          "Model": vehicle.model ?? "",
          "Color": vehicle.color ?? "",
          "VIN": vehicle.vin ?? "",
          "Notes": `Status changed to ${status}`,
          "Updated": new Date().toISOString(),
        };
        // Try update first — if the row already exists in the sheet
        const updateResult = await sheetPush(
          {
            action: "update_by_field",
            sheetTitle: "Dashboard Push",
            matchColumn: "Stock #",
            matchValue: vehicle.stock_number,
            data: sheetData,
          },
          { successMessage: false, queuedMessage: false, errorMessage: false },
        );
        if (updateResult.queued) {
          pushed++;
          continue;
        }
        // If the update got a 404 (row not found), append instead
        if (!updateResult.success && updateResult.error?.includes("not found")) {
          await sheetPush(
            {
              action: "append",
              sheetTitle: "Dashboard Push",
              data: { "Stock #": vehicle.stock_number, ...sheetData },
            },
            { successMessage: false, queuedMessage: false, errorMessage: false },
          );
        }
        pushed++;
      }
      return pushed;
    },
    [sheetPush],
  );

  // ── Bulk actions with optimistic updates ──
  const handleStatusChange = useCallback(
    async (ids: string[], status: "available" | "sold" | "hold" | "pending" | "wholesale") => {
      if (!currentEvent) return;
      setBulkLoading(true);
      // Snapshot for rollback + sheets push
      const previousVehicles = vehicles;
      const targetVehicles = vehicles.filter((v) => ids.includes(v.id));
      // Optimistic update
      setVehicles((prev) =>
        prev.map((v) => (ids.includes(v.id) ? { ...v, status } : v)),
      );
      try {
        await updateVehicleStatus(ids, status, currentEvent.id);
        toast.success(`${ids.length} vehicle(s) marked as ${status}`);
        setRowSelection({});

        // Push to Google Sheets (fire-and-forget, don't await blocking)
        pushToSheet(targetVehicles, status).then((count) => {
          toast.success(`Pushed ${count} vehicle(s) to Google Sheet`);
        }).catch((err) => {
          toast.error(`Sheet push failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      } catch (err) {
        // Rollback on error
        setVehicles(previousVehicles);
        toast.error(err instanceof Error ? err.message : "Failed to update");
      } finally {
        setBulkLoading(false);
      }
    },
    [currentEvent, vehicles, pushToSheet],
  );
  // Keep ref in sync so column cell closures always call the latest handler
  handleStatusChangeRef.current = handleStatusChange;

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
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{stats.available}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sold</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.sold}</p>
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
        <div className="flex items-center rounded-md border h-9">
          <button
            type="button"
            className={`px-3 h-full text-sm font-medium rounded-l-md transition-colors ${
              pricingMode === "trade"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
            onClick={() => setPricingMode("trade")}
          >
            Trade
          </button>
          <button
            type="button"
            className={`px-3 h-full text-sm font-medium rounded-r-md transition-colors ${
              pricingMode === "retail"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            }`}
            onClick={() => setPricingMode("retail")}
          >
            Retail
          </button>
        </div>

        {/* Bulk actions */}
        {selectedIds.length > 0 && (
          <BulkActionsToolbar
            selectedCount={selectedIds.length}
            onClearSelection={() => setRowSelection({})}
            isLoading={bulkLoading}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={bulkLoading}>
                  {bulkLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Change Status <ChevronDown className="ml-1 h-3 w-3" />
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => handleStatusChange(selectedIds, "sold")}
                >
                  <Handshake className="mr-2 h-4 w-4" /> Mark as Sold
                </DropdownMenuItem>
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
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={bulkLoading}
              onClick={handleBulkDelete}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete Selected
            </Button>
          </BulkActionsToolbar>
        )}
      </div>

      {/* Virtualized Table */}
      {loading ? (
        <LoadingTableSkeleton rows={10} columns={8} />
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
            {/* Raw <table> instead of <Table> component — the Table component
                wraps in its own overflow-auto div which breaks sticky thead. */}
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((header) => (
                      <TableHead key={header.id} className="whitespace-nowrap bg-background">
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
            </table>
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
