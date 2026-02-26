"use client";

import { useState, useMemo } from "react";
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
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, Download } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface VehicleItem {
  id: string;
  hat_number: number | null;
  label: string | null;
  status: string | null;
  stock_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  body_style: string | null;
  color: string | null;
  mileage: number | null;
  vin: string | null;
  age_days: number | null;
  drivetrain: string | null;
  trim: string | null;
  acquisition_cost: number | null;
  jd_trade_clean: number | null;
  jd_retail_clean: number | null;
  asking_price_115: number | null;
  profit_115: number | null;
  asking_price_120: number | null;
  profit_120: number | null;
  asking_price_125: number | null;
  profit_125: number | null;
  asking_price_130: number | null;
  profit_130: number | null;
  retail_spread: number | null;
}

interface InventoryGridProps {
  items: VehicleItem[];
}

export function InventoryGrid({ items }: InventoryGridProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bodyStyleFilter, setBodyStyleFilter] = useState("all");

  const filteredItems = useMemo(() => {
    let filtered = items;
    if (statusFilter !== "all")
      filtered = filtered.filter((i) => i.status === statusFilter);
    if (bodyStyleFilter !== "all")
      filtered = filtered.filter((i) => i.body_style === bodyStyleFilter);
    return filtered;
  }, [items, statusFilter, bodyStyleFilter]);

  const bodyStyles = useMemo(
    () => [...new Set(items.map((i) => i.body_style).filter(Boolean))],
    [items],
  );

  // Stats
  const totalCost = filteredItems.reduce((s, i) => s + (i.acquisition_cost ?? 0), 0);
  const avgCost = filteredItems.length > 0 ? totalCost / filteredItems.length : 0;
  const avgAge =
    filteredItems.length > 0
      ? filteredItems.reduce((s, i) => s + (i.age_days ?? 0), 0) /
        filteredItems.length
      : 0;

  const columns: ColumnDef<VehicleItem>[] = useMemo(
    () => [
      {
        accessorKey: "hat_number",
        header: "#",
        size: 50,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const st = row.getValue("status") as string;
          return (
            <Badge
              variant="secondary"
              className={
                st === "sold"
                  ? "bg-red-100 text-red-800"
                  : "bg-green-100 text-green-800"
              }
            >
              {st}
            </Badge>
          );
        },
      },
      { accessorKey: "stock_number", header: "Stock #" },
      { accessorKey: "year", header: "Year" },
      { accessorKey: "make", header: "Make" },
      { accessorKey: "model", header: "Model" },
      { accessorKey: "body_style", header: "Body Style" },
      { accessorKey: "color", header: "Color" },
      {
        accessorKey: "mileage",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Miles
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("mileage") as number | null;
          return v != null ? v.toLocaleString() : "—";
        },
      },
      {
        accessorKey: "age_days",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Age
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
      },
      {
        accessorKey: "acquisition_cost",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Cost
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("acquisition_cost") as number | null;
          return v != null ? formatCurrency(v) : "—";
        },
      },
      {
        accessorKey: "jd_trade_clean",
        header: "JD Trade",
        cell: ({ row }) => {
          const v = row.getValue("jd_trade_clean") as number | null;
          return v != null ? formatCurrency(v) : "—";
        },
      },
      {
        accessorKey: "profit_115",
        header: "Profit 15%",
        cell: ({ row }) => {
          const v = row.original.profit_115;
          if (v == null) return "—";
          return (
            <span className={v >= 0 ? "text-green-700 font-medium" : "text-red-600"}>
              {formatCurrency(v)}
            </span>
          );
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
        accessorKey: "profit_125",
        header: "Profit 25%",
        cell: ({ row }) => {
          const v = row.original.profit_125;
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
        header: "Retail Spread",
        cell: ({ row }) => {
          const v = row.original.retail_spread;
          if (v == null) return "—";
          return (
            <span className={v >= 0 ? "text-green-700 font-bold" : "text-red-600"}>
              {formatCurrency(v)}
            </span>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredItems,
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

  function exportCSV() {
    const headers = columns.map((c) => (c as { accessorKey?: string }).accessorKey ?? "").join(",");
    const rows = filteredItems
      .map((item) =>
        columns
          .map((c) => {
            const key = (c as { accessorKey?: string }).accessorKey;
            return key ? (item as unknown as Record<string, unknown>)[key] ?? "" : "";
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([headers + "\n" + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory.csv";
    a.click();
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Vehicles</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{filteredItems.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {filteredItems.filter((i) => i.status === "available").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Cost</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(avgCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Age (days)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{Math.round(avgAge)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search inventory..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="sold">Sold</SelectItem>
          </SelectContent>
        </Select>
        <Select value={bodyStyleFilter} onValueChange={setBodyStyleFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Body Style" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Body Styles</SelectItem>
            {bodyStyles.map((c) => (
              <SelectItem key={c!} value={c!}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportCSV} className="ml-auto">
          <Download className="mr-1 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
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
                  No vehicles found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filteredItems.length} vehicles</span>
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
    </div>
  );
}
