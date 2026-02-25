"use client";

import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, Plus, DollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { MarkSoldModal } from "./mark-sold-modal";
import { AddInventoryModal } from "./add-inventory-modal";
import type { Database } from "@/types/database";

type InventoryItem = Database["public"]["Tables"]["inventory"]["Row"];

interface InventoryTableProps {
  items: InventoryItem[];
  eventId: string;
}

const statusColors: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  in_use: "bg-blue-100 text-blue-800",
  reserved: "bg-yellow-100 text-yellow-800",
  damaged: "bg-orange-100 text-orange-800",
  retired: "bg-gray-100 text-gray-800",
};

const categoryColors: Record<string, string> = {
  vehicle: "bg-blue-100 text-blue-800",
  equipment: "bg-purple-100 text-purple-800",
  swag: "bg-pink-100 text-pink-800",
  signage: "bg-teal-100 text-teal-800",
  other: "bg-gray-100 text-gray-800",
};

export function InventoryTable({ items, eventId }: InventoryTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sellItem, setSellItem] = useState<InventoryItem | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const filteredItems = useMemo(() => {
    let filtered = items;
    if (categoryFilter !== "all") {
      filtered = filtered.filter((item) => item.category === categoryFilter);
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((item) => item.status === statusFilter);
    }
    return filtered;
  }, [items, categoryFilter, statusFilter]);

  const columns: ColumnDef<InventoryItem>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Name
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.getValue("name")}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => {
          const cat = row.getValue("category") as string;
          return (
            <Badge variant="secondary" className={categoryColors[cat]}>
              {cat}
            </Badge>
          );
        },
      },
      {
        accessorKey: "quantity",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Qty
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
      },
      {
        accessorKey: "unit_cost",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Unit Cost
            <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
          </Button>
        ),
        cell: ({ row }) => {
          const cost = row.getValue("unit_cost") as number | null;
          return cost != null ? formatCurrency(cost) : "—";
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.getValue("status") as string;
          return (
            <Badge variant="secondary" className={statusColors[status]}>
              {status.replace("_", " ")}
            </Badge>
          );
        },
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="max-w-[200px] truncate text-muted-foreground">
            {(row.getValue("description") as string) || "—"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const item = row.original;
          if (item.status === "retired") return null;
          if (item.category !== "vehicle") return null;
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSellItem(item)}
              className="text-green-700 border-green-300 hover:bg-green-50"
            >
              <DollarSign className="mr-1 h-3.5 w-3.5" />
              Sell
            </Button>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search inventory..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs"
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="vehicle">Vehicle</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
            <SelectItem value="swag">Swag</SelectItem>
            <SelectItem value="signage">Signage</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="in_use">In Use</SelectItem>
            <SelectItem value="reserved">Reserved</SelectItem>
            <SelectItem value="damaged">Damaged</SelectItem>
            <SelectItem value="retired">Retired/Sold</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
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
                    <TableCell key={cell.id}>
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
                  No inventory items found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground">
        {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""} total
      </div>

      {/* Mark as Sold Modal */}
      {sellItem && (
        <MarkSoldModal
          item={sellItem}
          eventId={eventId}
          open={!!sellItem}
          onClose={() => setSellItem(null)}
        />
      )}

      {/* Add Inventory Modal */}
      <AddInventoryModal
        eventId={eventId}
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
      />
    </div>
  );
}
