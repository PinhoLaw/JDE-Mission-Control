"use client";

import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { ArrowUpDown, Download } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Deal {
  id: string;
  deal_number: number | null;
  sale_day: number | null;
  stock_number: string | null;
  customer_name: string | null;
  customer_zip: string | null;
  new_used: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_type: string | null;
  vehicle_cost: number | null;
  salesperson: string | null;
  second_salesperson: string | null;
  front_gross: number | null;
  back_gross: number | null;
  lender: string | null;
  reserve: number | null;
  warranty: number | null;
  aftermarket_1: number | null;
  aftermarket_2: number | null;
  gap: number | null;
  fi_total: number | null;
  total_gross: number | null;
  selling_price: number | null;
  pvr: number | null;
  is_washout: boolean | null;
  washout_amount: number | null;
  finance_type: string | null;
  status: string | null;
  source: string | null;
}

interface DealLogGridProps {
  deals: Deal[];
}

export function DealLogGrid({ deals }: DealLogGridProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const totalGross = deals.reduce((s, d) => s + (d.total_gross ?? 0), 0);
  const totalFront = deals.reduce((s, d) => s + (d.front_gross ?? 0), 0);
  const totalBack = deals.reduce((s, d) => s + (d.back_gross ?? 0), 0);
  const avgPVR = deals.length > 0 ? totalGross / deals.length : 0;

  const columns: ColumnDef<Deal>[] = useMemo(
    () => [
      { accessorKey: "deal_number", header: "Deal #", size: 60 },
      { accessorKey: "stock_number", header: "Stock #" },
      { accessorKey: "customer_name", header: "Customer" },
      { accessorKey: "customer_zip", header: "Zip" },
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
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Front
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("front_gross") as number | null;
          return v != null ? (
            <span className="font-medium">{formatCurrency(v)}</span>
          ) : (
            "—"
          );
        },
      },
      {
        accessorKey: "reserve",
        header: "Reserve",
        cell: ({ row }) => {
          const v = row.getValue("reserve") as number | null;
          return v != null ? formatCurrency(v) : "—";
        },
      },
      {
        accessorKey: "warranty",
        header: "Warranty",
        cell: ({ row }) => {
          const v = row.getValue("warranty") as number | null;
          return v != null ? formatCurrency(v) : "—";
        },
      },
      {
        accessorKey: "gap",
        header: "GAP",
        cell: ({ row }) => {
          const v = row.getValue("gap") as number | null;
          return v != null ? formatCurrency(v) : "—";
        },
      },
      {
        accessorKey: "fi_total",
        header: "F&I Total",
        cell: ({ row }) => {
          const v = row.getValue("fi_total") as number | null;
          return v != null ? (
            <span className="font-medium text-blue-700">
              {formatCurrency(v)}
            </span>
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
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Total Gross
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("total_gross") as number | null;
          return v != null ? (
            <span className="font-bold text-green-700">
              {formatCurrency(v)}
            </span>
          ) : (
            "—"
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: deals,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Deals</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{deals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Gross</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {formatCurrency(totalGross)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Front Gross</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(totalFront)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Back Gross</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(totalBack)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg PVR</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(avgPVR)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search deals..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs"
        />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => {
            const csv = [
              columns.map((c) => (c as { accessorKey?: string }).accessorKey ?? (c as { id?: string }).id ?? "").join(","),
              ...deals.map((d) => Object.values(d).join(",")),
            ].join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "deal_log.csv";
            a.click();
          }}
        >
          <Download className="mr-1 h-4 w-4" />
          Export
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
                  No deals found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Totals row */}
      <div className="flex justify-end gap-6 text-sm font-medium border-t pt-3">
        <span>
          Front: <span className="text-green-700">{formatCurrency(totalFront)}</span>
        </span>
        <span>
          Back: <span className="text-blue-700">{formatCurrency(totalBack)}</span>
        </span>
        <span>
          Total: <span className="text-green-700 font-bold">{formatCurrency(totalGross)}</span>
        </span>
      </div>
    </div>
  );
}
