"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  type ColumnDef,
  flexRender,
} from "@tanstack/react-table";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { AuditLog } from "@/types/database";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, History, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const ENTITY_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "deal", label: "Deal" },
  { value: "vehicle", label: "Vehicle" },
  { value: "roster", label: "Roster" },
  { value: "config", label: "Config" },
  { value: "lender", label: "Lender" },
  { value: "sheet", label: "Google Sheet" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateUuid(uuid: string | null): string {
  if (!uuid) return "\u2014";
  return uuid.length > 8 ? `${uuid.slice(0, 8)}\u2026` : uuid;
}

function actionBadgeClasses(action: string): string {
  const lower = action.toLowerCase();
  if (lower === "create" || lower === "sheet_append") {
    return "bg-green-500/15 text-green-400 border-green-500/25 hover:bg-green-500/25";
  }
  if (lower === "update" || lower === "sheet_update" || lower === "sheet_write") {
    return "bg-blue-500/15 text-blue-400 border-blue-500/25 hover:bg-blue-500/25";
  }
  if (lower === "delete" || lower === "sheet_delete") {
    return "bg-red-500/15 text-red-400 border-red-500/25 hover:bg-red-500/25";
  }
  if (lower === "sheet_read") {
    return "bg-gray-500/15 text-gray-400 border-gray-500/25 hover:bg-gray-500/25";
  }
  return "bg-secondary text-secondary-foreground";
}

function entityTypeBadgeClasses(_type: string): string {
  return "bg-muted text-muted-foreground border-border hover:bg-muted/80";
}

// ---------------------------------------------------------------------------
// Expandable JSON cell
// ---------------------------------------------------------------------------

function ChangesCell({
  oldValues,
  newValues,
}: {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const hasChanges =
    (oldValues && Object.keys(oldValues).length > 0) ||
    (newValues && Object.keys(newValues).length > 0);

  if (!hasChanges) {
    return <span className="text-muted-foreground">\u2014</span>;
  }

  return (
    <div className="max-w-md">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Hide" : "View"} changes
      </Button>
      {expanded && (
        <div className="mt-2 space-y-2 text-xs">
          {oldValues && Object.keys(oldValues).length > 0 && (
            <div>
              <span className="font-medium text-red-400">Old:</span>
              <pre className="mt-1 rounded-md bg-muted p-2 overflow-x-auto max-h-40 overflow-y-auto">
                {JSON.stringify(oldValues, null, 2)}
              </pre>
            </div>
          )}
          {newValues && Object.keys(newValues).length > 0 && (
            <div>
              <span className="font-medium text-green-400">New:</span>
              <pre className="mt-1 rounded-md bg-muted p-2 overflow-x-auto max-h-40 overflow-y-auto">
                {JSON.stringify(newValues, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AuditLogPage() {
  const { currentEvent, isLoading: eventLoading } = useEvent();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState("all");

  // -----------------------------------------------------------------------
  // Fetch audit logs for the current event
  // -----------------------------------------------------------------------

  const fetchLogs = useCallback(async () => {
    if (!currentEvent) return;

    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from("audit_logs")
      .select("*")
      .eq("event_id", currentEvent.id)
      .order("created_at", { ascending: false });

    if (entityFilter !== "all") {
      query = query.eq("entity_type", entityFilter);
    }

    const { data, error } = await query;

    if (!error && data) {
      setLogs(data);
    }
    setLoading(false);
  }, [currentEvent, entityFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // -----------------------------------------------------------------------
  // Realtime subscription
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!currentEvent) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`audit_logs:event:${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_logs",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        (payload) => {
          const newLog = payload.new as AuditLog;

          // Respect the active entity filter
          if (entityFilter !== "all" && newLog.entity_type !== entityFilter) {
            return;
          }

          setLogs((prev) => [newLog, ...prev]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent, entityFilter]);

  // -----------------------------------------------------------------------
  // Column definitions
  // -----------------------------------------------------------------------

  const columns: ColumnDef<AuditLog>[] = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: "Time",
        size: 140,
        cell: ({ row }) => {
          const ts = row.original.created_at;
          if (!ts) return "\u2014";
          return (
            <span
              className="text-muted-foreground whitespace-nowrap"
              title={new Date(ts).toLocaleString()}
            >
              {formatDistanceToNow(new Date(ts), { addSuffix: true })}
            </span>
          );
        },
      },
      {
        accessorKey: "action",
        header: "Action",
        size: 100,
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={actionBadgeClasses(row.original.action)}
          >
            {row.original.action}
          </Badge>
        ),
      },
      {
        accessorKey: "entity_type",
        header: "Entity Type",
        size: 110,
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={entityTypeBadgeClasses(row.original.entity_type)}
          >
            {row.original.entity_type}
          </Badge>
        ),
      },
      {
        accessorKey: "entity_id",
        header: "Entity ID",
        size: 110,
        cell: ({ row }) => (
          <code
            className="text-xs font-mono text-muted-foreground"
            title={row.original.entity_id ?? undefined}
          >
            {truncateUuid(row.original.entity_id)}
          </code>
        ),
      },
      {
        accessorKey: "user_id",
        header: "User ID",
        size: 110,
        cell: ({ row }) => (
          <code
            className="text-xs font-mono text-muted-foreground"
            title={row.original.user_id ?? undefined}
          >
            {truncateUuid(row.original.user_id)}
          </code>
        ),
      },
      {
        id: "changes",
        header: "Changes",
        cell: ({ row }) => (
          <ChangesCell
            oldValues={row.original.old_values}
            newValues={row.original.new_values}
          />
        ),
      },
    ],
    [],
  );

  // -----------------------------------------------------------------------
  // TanStack table instance
  // -----------------------------------------------------------------------

  const table = useReactTable({
    data: logs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: PAGE_SIZE },
    },
  });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // Show spinner while the event context is still loading
  if (eventLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No event selected
  if (!currentEvent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Shield className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Event Selected</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Select an event from the header to view its audit log.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <History className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
            <p className="text-sm text-muted-foreground">
              Track all changes to deals, vehicles, roster, and settings
            </p>
          </div>
        </div>
      </div>

      {/* Filter + Count */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="text-lg">Activity History</CardTitle>
              <CardDescription>
                {logs.length} log{logs.length !== 1 ? "s" : ""} recorded
                {entityFilter !== "all" ? ` for ${entityFilter}` : ""}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* Loading state */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Shield className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No Audit Logs</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {entityFilter !== "all"
                  ? `No logs found for entity type "${entityFilter}". Try selecting a different filter.`
                  : "No changes have been recorded for this event yet. Actions like creating deals, updating vehicles, or modifying the roster will appear here."}
              </p>
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            className="whitespace-nowrap"
                          >
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
                    {table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className="whitespace-nowrap"
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  Page {table.getState().pagination.pageIndex + 1} of{" "}
                  {table.getPageCount()}
                </p>
                <div className="flex items-center gap-2">
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
        </CardContent>
      </Card>
    </div>
  );
}
