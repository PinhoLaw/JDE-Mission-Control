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
import { LoadingTableSkeleton } from "@/components/ui/loading-table-skeleton";

// Recharts
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
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
  AlertTriangle,
  XCircle,
  X,
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

const PIE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6"];

const SHEET_ACTIONS = [
  "sheet_read",
  "sheet_append",
  "sheet_update",
  "sheet_delete",
  "sheet_write",
] as const;

const AUTO_RETRY_KEY = "jde-monitoring-auto-retry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertItem {
  key: string;
  severity: "amber" | "red";
  icon: React.ReactNode;
  title: string;
  description: string;
}

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

/** Format seconds remaining into a human-readable countdown string */
function formatCountdown(diffMs: number): string {
  if (diffMs <= 0) return "Ready";
  const secs = Math.ceil(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
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

  // Alerts
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(
    new Set(),
  );

  // Auto-retry
  const [autoRetry, setAutoRetry] = useState(false);

  // Countdown timer tick
  const [countdownNow, setCountdownNow] = useState(Date.now());

  // ── Initialize auto-retry from localStorage ──────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(AUTO_RETRY_KEY);
    if (stored === "true") setAutoRetry(true);
  }, []);

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

  // ── Auto-retry interval ─────────────────────────────────────
  useEffect(() => {
    if (!autoRetry) return;
    const interval = setInterval(async () => {
      const count = await getQueueCount();
      if (count > 0 && navigator.onLine) {
        try {
          const result = await processQueue();
          if (result.processed > 0) {
            toast.success(`Auto-retry: ${result.processed} synced`);
          }
          await loadQueue();
        } catch {
          // Silently fail on auto-retry
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [autoRetry, loadQueue]);

  const toggleAutoRetry = useCallback(() => {
    setAutoRetry((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem(AUTO_RETRY_KEY, String(next));
      }
      toast.success(next ? "Auto-retry enabled" : "Auto-retry disabled");
      return next;
    });
  }, []);

  // ── Countdown timer tick (1s interval when queue has items) ──
  useEffect(() => {
    if (queuedActions.length === 0) return;
    const interval = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [queuedActions.length]);

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
      successRateNum: totalSheetOps > 0
        ? ((totalSheetOps - errorLogs.length) / totalSheetOps) * 100
        : 100,
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

  // Cumulative operations over 24h
  const cumulativeOps = useMemo(() => {
    let running = 0;
    return sheetPushesPerHour.map((h) => {
      running += h.count;
      return { hour: h.hour, total: running };
    });
  }, [sheetPushesPerHour]);

  // Operations by type (pie chart)
  const opsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of sheetLogs) {
      const action = l.action;
      counts[action] = (counts[action] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name: name.replace("sheet_", ""), value }))
      .sort((a, b) => b.value - a.value);
  }, [sheetLogs]);

  // Top 5 active users
  const topUsers = useMemo(() => {
    const userMap: Record<string, { count: number; lastActive: string }> = {};
    for (const l of logs) {
      const uid = l.user_id;
      if (!uid) continue;
      if (!userMap[uid]) {
        userMap[uid] = { count: 0, lastActive: l.created_at };
      }
      userMap[uid].count += 1;
      if (l.created_at > userMap[uid].lastActive) {
        userMap[uid].lastActive = l.created_at;
      }
    }
    return Object.entries(userMap)
      .map(([userId, data]) => ({ userId, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [logs]);

  // ── Proactive alerts ────────────────────────────────────────

  const activeAlerts = useMemo(() => {
    const alerts: AlertItem[] = [];

    if (!isOnline) {
      alerts.push({
        key: "offline",
        severity: "red",
        icon: <WifiOff className="h-4 w-4" />,
        title: "You are offline",
        description:
          "Sheet operations will be queued locally until connectivity is restored.",
      });
    }

    if (kpis.recentErrors > 0) {
      alerts.push({
        key: "errors",
        severity: "red",
        icon: <XCircle className="h-4 w-4" />,
        title: `${kpis.recentErrors} error${kpis.recentErrors !== 1 ? "s" : ""} in the last hour`,
        description:
          "Check the Sync Errors tab for details on failed operations.",
      });
    }

    if (kpis.successRateNum < 90 && kpis.totalSheetOps > 0) {
      alerts.push({
        key: "sync",
        severity: "red",
        icon: <AlertCircle className="h-4 w-4" />,
        title: `Sync success rate is ${kpis.successRate}`,
        description:
          "Success rate has dropped below 90%. Review recent errors.",
      });
    }

    if (queueCount > 5) {
      alerts.push({
        key: "queue",
        severity: "amber",
        icon: <AlertTriangle className="h-4 w-4" />,
        title: `${queueCount} actions queued`,
        description:
          "More than 5 actions are waiting to sync. Consider processing the queue manually.",
      });
    }

    // Filter out dismissed alerts (only if condition still active)
    return alerts.filter((a) => !dismissedAlerts.has(a.key));
  }, [isOnline, kpis, queueCount, dismissedAlerts]);

  // Auto-clear dismissed alerts when their condition resolves
  useEffect(() => {
    setDismissedAlerts((prev) => {
      const activeKeys = new Set<string>();
      if (!isOnline) activeKeys.add("offline");
      if (kpis.recentErrors > 0) activeKeys.add("errors");
      if (kpis.successRateNum < 90 && kpis.totalSheetOps > 0)
        activeKeys.add("sync");
      if (queueCount > 5) activeKeys.add("queue");

      // Remove dismissed keys that are no longer active conditions
      const next = new Set<string>();
      for (const key of prev) {
        if (activeKeys.has(key)) next.add(key);
      }
      // Only update if changed
      if (next.size !== prev.size) return next;
      return prev;
    });
  }, [isOnline, kpis, queueCount]);

  const dismissAlert = useCallback((key: string) => {
    setDismissedAlerts((prev) => new Set(prev).add(key));
  }, []);

  // ── Loading / no-event states ───────────────────────────────

  if (isLoading || eventLoading) {
    return <LoadingTableSkeleton rows={6} columns={4} />;
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

      {/* ── Proactive Alerts ──────────────────────────────────── */}
      {activeAlerts.length > 0 && (
        <div className="flex flex-col gap-3">
          {activeAlerts.map((alert) => (
            <Card
              key={alert.key}
              className={
                alert.severity === "red"
                  ? "border-l-4 border-l-red-500 bg-red-500/10"
                  : "border-l-4 border-l-amber-500 bg-amber-500/10"
              }
            >
              <CardContent className="flex items-center justify-between py-3 px-4">
                <div className="flex items-center gap-3">
                  <span
                    className={
                      alert.severity === "red"
                        ? "text-red-500"
                        : "text-amber-500"
                    }
                  >
                    {alert.icon}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{alert.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {alert.description}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => dismissAlert(alert.key)}
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="sr-only">Dismiss</span>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
                    variant={autoRetry ? "default" : "outline"}
                    size="sm"
                    onClick={toggleAutoRetry}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${autoRetry ? "animate-spin" : ""}`}
                    />
                    Auto-Retry: {autoRetry ? "On" : "Off"}
                  </Button>
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
                      {queuedActions.map((item) => {
                        const retryAt = item.nextRetryAt
                          ? new Date(item.nextRetryAt).getTime()
                          : null;
                        const diffMs = retryAt
                          ? retryAt - countdownNow
                          : 0;

                        return (
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
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {retryAt ? (
                                <span className="flex items-center gap-1.5">
                                  <Clock className="h-3 w-3" />
                                  {formatCountdown(diffMs)}
                                </span>
                              ) : (
                                "Ready"
                              )}
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
                        );
                      })}
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
          <div className="grid gap-6 lg:grid-cols-2">
            {/* 4a. Bar Chart — Operations per Hour */}
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
                        <Tooltip content={<ChartTooltipContent />} />
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

            {/* 4b. Line Chart — Cumulative Operations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Cumulative Operations (Last 24h)
                </CardTitle>
                <CardDescription>
                  Running total of sheet operations over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                {cumulativeOps.every((h) => h.total === 0) ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <Activity className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">
                      No data to display.
                    </p>
                  </div>
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={cumulativeOps}>
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
                        <Tooltip content={<ChartTooltipContent />} />
                        <Line
                          type="monotone"
                          dataKey="total"
                          name="Total Ops"
                          stroke={CHART_COLORS.secondary}
                          strokeWidth={2}
                          dot={{ r: 3, fill: CHART_COLORS.secondary }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 4c. Pie Chart — Operations by Type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Operations by Type
                </CardTitle>
                <CardDescription>
                  Breakdown of sheet actions by category
                </CardDescription>
              </CardHeader>
              <CardContent>
                {opsByType.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <Activity className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">
                      No operations to display.
                    </p>
                  </div>
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={opsByType}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={4}
                          dataKey="value"
                          label={({
                            name,
                            percent,
                          }: {
                            name: string;
                            percent: number;
                          }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {opsByType.map((_, idx) => (
                            <Cell
                              key={idx}
                              fill={PIE_COLORS[idx % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 4d. Top Active Users */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Active Users</CardTitle>
                <CardDescription>
                  Most active users by operation count
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topUsers.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <Activity className="h-10 w-10 text-muted-foreground mb-3" />
                    <p className="text-muted-foreground">No user activity.</p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>User ID</TableHead>
                          <TableHead className="text-center">
                            Operations
                          </TableHead>
                          <TableHead>Last Active</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topUsers.map((user, idx) => (
                          <TableRow key={user.userId}>
                            <TableCell className="font-bold text-muted-foreground">
                              {idx + 1}
                            </TableCell>
                            <TableCell>
                              <code className="text-xs font-mono">
                                {user.userId.slice(0, 8)}…
                              </code>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary">
                                {user.count}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDistanceToNow(
                                new Date(user.lastActive),
                                { addSuffix: true },
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
