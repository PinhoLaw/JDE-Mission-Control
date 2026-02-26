"use client";

import { useState, useMemo, useCallback } from "react";
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
import { ArrowUpDown, Download, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useEventRealtime } from "@/hooks/use-realtime-subscription";
import { toast } from "sonner";

interface DealRow {
  id: string;
  deal_number: number | null;
  sale_day: number | null;
  stock_number: string | null;
  customer_name: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  salesperson: string | null;
  lender: string | null;
  front_gross: number | null;
  back_gross: number | null;
  total_gross: number | null;
  new_used: string | null;
  status: string | null;
  created_at: string;
}

interface RecentDealsTableProps {
  deals: DealRow[];
  eventId: string;
}

export function RecentDealsTable({ deals: initialDeals, eventId }: RecentDealsTableProps) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Realtime: refresh when deals change
  const handleRealtimeChange = useCallback(() => {
    router.refresh();
    toast.success("Dashboard updated with latest data");
  }, [router]);

  useEventRealtime(eventId, handleRealtimeChange, {
    showToasts: false,
    enabled: true,
  });

  const columns: ColumnDef<DealRow>[] = useMemo(
    () => [
      {
        accessorKey: "deal_number",
        header: "#",
        size: 50,
      },
      {
        id: "vehicle",
        header: "Vehicle",
        cell: ({ row }) => {
          const d = row.original;
          return (
            <span className="font-medium">
              {d.vehicle_year} {d.vehicle_make} {d.vehicle_model}
            </span>
          );
        },
      },
      { accessorKey: "customer_name", header: "Customer" },
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
        accessorKey: "back_gross",
        header: "Back",
        cell: ({ row }) => {
          const v = row.getValue("back_gross") as number | null;
          return v != null ? formatCurrency(v) : "—";
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
            Total
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const v = row.getValue("total_gross") as number | null;
          return v != null ? (
            <span className="font-bold text-green-700 dark:text-green-400">
              {formatCurrency(v)}
            </span>
          ) : (
            "—"
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.getValue("status") as string;
          const colors: Record<string, string> = {
            funded: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
            pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
            unwound: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
            cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
          };
          return (
            <Badge variant="secondary" className={colors[s] ?? ""}>
              {s}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: initialDeals,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  const totalGross = initialDeals.reduce(
    (s, d) => s + (d.total_gross ?? 0),
    0,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Recent Deals</CardTitle>
          <CardDescription>
            {initialDeals.length} deals · {formatCurrency(totalGross)} total gross
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search deals..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-[200px] h-8"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => router.refresh()}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
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
                    className="h-24 text-center text-muted-foreground"
                  >
                    No deals found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {initialDeals.length > 10 && (
          <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
            <span>
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
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
        )}
      </CardContent>
    </Card>
  );
}
