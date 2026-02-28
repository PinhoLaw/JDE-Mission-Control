"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { AuditLog } from "@/types/database";
import {
  getQueueCount,
  getQueuedActions,
  processQueue,
  removeQueuedAction,
  clearQueue,
  type QueuedSheetAction,
} from "@/lib/services/offlineQueue";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

// Recharts
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// shadcn/ui
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Icons
import {
  Activity,
  Wifi,
  WifiOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Trash2,
  Play,
  RefreshCw,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_COLORS = {
  primary: "#2563eb",
  secondary: "#16a34a",
  accent: "#f59e0b",
  error: "#ef4444",
} as const;

const SHEET_ACTIONS = [
  "sheet_read",
  "sheet_append",
  "sheet_update",
  "sheet_delete",
  "sheet_write",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-popover-foreground">
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function actionBadgeClasses(action: string): string {
  const lower = action.toLowerCase();
  if (lower === "create" || lower === "sheet_append") {
    return "bg-green-500/15 text-green-400 border-green-500/25 hover:bg-green-500/25";
  }
  if (
    lower === "update" ||
    lower === "sheet_update" ||
    lower === "sheet_write"
  ) {
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MonitoringPage() {
  const { currentEvent, isLoading: eventLoading } = useEvent();

  // State
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedActions, setQueuedActions] = useState<QueuedSheetAction[]>([]);
  const [processingQueue, setProcessingQueue] = useState(false);

  // ── Online / Offline detection ──────────────────────────────
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // ── Fetch audit logs ────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    if (!currentEvent) return;
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("event_id", currentEvent.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setLogs((data ?? []) as AuditLog[]);
    } catch (err) {
      console.error("Failed to load audit logs:", err);
      toast.error("Failed to load monitoring data");
    } finally {
      setIsLoading(false);
    }
  }, [currentEvent]);

  useEffect(() => {
    if (!eventLoading && currentEvent) fetchLogs();
    if (!eventLoading && !currentEvent) setIsLoading(false);
  }, [eventLoading, currentEvent, fetchLogs]);

  // ── Realtime subscription on audit_logs ─────────────────────
  useEffect(() => {
    if (!currentEvent) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`monitoring-audit-${currentEvent.id}`)
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
          setLogs((prev) => [newLog, ...prev].slice(0, 500));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent]);

  // ── Load offline queue ──────────────────────────────────────
  const loadQueue = useCallback(async () => {
    try {
      const count = await getQueueCount();
      const actions = await getQueuedActions();
      setQueueCount(count);
      setQueuedActions(actions);
    } catch {
      // IndexedDB may not be available in some environments
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // ── Queue action handlers ───────────────────────────────────
  const handleProcessQueue = useCallback(async () => {
    setProcessingQueue(true);
    try {
      const result = await processQueue();
      toast.success(
        `Processed: ${result.processed}, Failed: ${result.failed}, Dead-lettered: ${result.deadLettered}`,
      );
      await loadQueue();
    } catch {
      toast.error("Failed to process queue");
    } finally {
      setProcessingQueue(false);
    }
  }, [loadQueue]);

  const handleRemoveAction = useCallback(
    async (id: number) => {
      await removeQueuedAction(id);
      await loadQueue();
      toast.success("Removed queued action");
    },
    [loadQueue],
  );

  const handleClearQueue = useCallback(async () => {
    await clearQueue();
    await loadQueue();
    toast.success("Queue cleared");
  }, [loadQueue]);

  // ── Derived data ────────────────────────────────────────────

  const sheetLogs = useMemo(
    () =>
      logs.filter((l) =>
        SHEET_ACTIONS.includes(l.action as (typeof SHEET_ACTIONS)[number]),
      ),
    [logs],
  );

  const errorLogs = useMemo(
    () =>
      sheetLogs.filter((l) => {
        const nv = l.new_values as Record<string, unknown> | null;
        return nv && (nv.error || nv.lastError);
      }),
    [sheetLogs],
  );

  const recentActivity = useMemo(() => logs.slice(0, 50), [logs]);

  // KPI computations
  const kpis = useMemo(() => {
    const totalSheetOps = sheetLogs.length;

    const recentCutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
    const recentErrors = errorLogs.filter(
      (l) => new Date(l.created_at) > recentCutoff,
    ).length;

    const successRate =
      totalSheetOps > 0
        ? (
            ((totalSheetOps - errorLogs.length) / totalSheetOps) *
            100
          ).toFixed(1)
        : "100.0";

    return {
      successRate: `${successRate}%`,
      recentErrors,
      totalSheetOps,
    };
  }, [sheetLogs, errorLogs]);

  // Chart: sheet pushes per hour (last 24h)
  const sheetPushesPerHour = useMemo(() => {
    const now = Date.now();
    const hours: { hour: string; count: number }[] = [];

    for (let i = 23; i >= 0; i--) {
      const hourStart = now - (i + 1) * 60 * 60 * 1000;
      const hourEnd = now - i * 60 * 60 * 1000;
      const count = logs.filter((l) => {
        if (
          !SHEET_ACTIONS.includes(l.action as (typeof SHEET_ACTIONS)[number])
        )
          return false;
        const ts = new Date(l.created_at).getTime();
        return ts >= hourStart && ts < hourEnd;
      }).length;
      const label = new Date(hourEnd).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      hours.push({ hour: label, count });
    }

    return hours;
  }, [logs]);

  // ── Loading / no-event states ───────────────────────────────

  if (isLoading || eventLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Loading monitoring data…
        </p>
      </div>
    );
  }

  if (!currentEvent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Activity className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Event Selected</h2>
        <p className="text-muted-foreground max-w-md">
          Select an event from the event switcher to view monitoring data.
        </p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Monitoring</h1>
            <p className="text-sm text-muted-foreground">
              System health, sync status, and activity feed
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            fetchLogs();
            loadQueue();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Online Status"
          value={isOnline ? "Online" : "Offline"}
          description={
            isOnline ? "Connected to network" : "Actions will be queued"
          }
          icon={
            isOnline ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-500" />
            )
          }
        />
        <StatCard
          title="Queued Actions"
          value={String(queueCount)}
          description="Pending sheet operations"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Sheet Sync Success"
          value={kpis.successRate}
          description={`${kpis.totalSheetOps} total operations`}
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
        />
        <StatCard
          title="Recent Errors"
          value={String(kpis.recentErrors)}
          description="In the last hour"
          icon={<AlertCircle className="h-4 w-4 text-red-500" />}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Live Activity</TabsTrigger>
          <TabsTrigger value="queue">
            Offline Queue
            {queueCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {queueCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="errors">Sync Errors</TabsTrigger>
          <TabsTrigger value="usage">Usage Stats</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Live Activity ─────────────────────────────── */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>
                Latest actions across the current event (real-time)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <Activity className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    No activity recorded yet.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>Entity ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentActivity.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                            {formatDistanceToNow(new Date(log.created_at), {
                              addSuffix: true,
                            })}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={actionBadgeClasses(log.action)}
                            >
                              {log.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="bg-muted text-muted-foreground border-border"
                            >
                              {log.entity_type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs font-mono text-muted-foreground">
                              {log.entity_id
                                ? `${log.entity_id.slice(0, 8)}…`
                                : "—"}
                            </code>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Offline Queue ─────────────────────────────── */}
        <TabsContent value="queue">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="text-base">Offline Queue</CardTitle>
                  <CardDescription>
                    {queueCount} pending action
                    {queueCount !== 1 ? "s" : ""} waiting to sync
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleProcessQueue}
                    disabled={processingQueue || queueCount === 0}
                  >
                    {processingQueue ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    Process Queue
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearQueue}
                    disabled={queueCount === 0}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {queuedActions.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mb-3" />
                  <p className="text-muted-foreground">
                    Queue is empty. All actions are synced.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Queued At</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Retries</TableHead>
                        <TableHead>Next Retry</TableHead>
                        <TableHead>Last Error</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queuedActions.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatDistanceToNow(new Date(item.queuedAt), {
                              addSuffix: true,
                            })}
                          </TableCell>
                          <TableCell className="text-sm">
                            {(item.payload?.action as string) ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                item.retries > 2 ? "destructive" : "secondary"
                              }
                            >
                              {item.retries}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.nextRetryAt
                              ? formatDistanceToNow(
                                  new Date(item.nextRetryAt),
                                  { addSuffix: true },
                                )
                              : "Ready"}
                          </TableCell>
                          <TableCell className="text-sm text-red-500 max-w-[200px] truncate">
                            {item.lastError ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveAction(item.id!)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Sync Errors ───────────────────────────────── */}
        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sync Errors</CardTitle>
              <CardDescription>
                Sheet operations that encountered errors ({errorLogs.length}{" "}
                total)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {errorLogs.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mb-3" />
                  <p className="text-muted-foreground">
                    No sync errors recorded.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Sheet</TableHead>
                        <TableHead>Error Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {errorLogs.map((log) => {
                        const nv = log.new_values as Record<
                          string,
                          unknown
                        > | null;
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDistanceToNow(new Date(log.created_at), {
                                addSuffix: true,
                              })}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={actionBadgeClasses(log.action)}
                              >
                                {log.action}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {(nv?.sheetTitle as string) ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm text-red-500 max-w-[300px] truncate">
                              {String(nv?.error ?? nv?.lastError ?? "—")}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Usage Stats ───────────────────────────────── */}
        <TabsContent value="usage">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Sheet Operations (Last 24h)
              </CardTitle>
              <CardDescription>
                Google Sheet push operations by hour
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sheetPushesPerHour.every((h) => h.count === 0) ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <Activity className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    No sheet operations in the last 24 hours.
                  </p>
                </div>
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sheetPushesPerHour}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                      />
                      <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        className="fill-muted-foreground"
                        allowDecimals={false}
                      />
                      <Tooltip
                        content={<ChartTooltipContent />}
                      />
                      <Bar
                        dataKey="count"
                        name="Operations"
                        fill={CHART_COLORS.primary}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
