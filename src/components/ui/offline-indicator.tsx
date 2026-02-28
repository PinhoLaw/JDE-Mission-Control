"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  attachQueueListeners,
  getQueueCount,
  processQueue,
} from "@/lib/services/offlineQueue";

// ────────────────────────────────────────────────────────────
// OfflineIndicator — banner that appears at the bottom of the
// screen when the user is offline or has queued sheet actions.
// ────────────────────────────────────────────────────────────

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [lastResult, setLastResult] = useState<{
    processed: number;
    deadLettered: number;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Track online/offline status
  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Attach queue listeners + poll queue count
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Initial count
    getQueueCount().then(setQueueCount).catch(() => {});

    // Attach global listeners that auto-process queue on reconnect
    cleanupRef.current = attachQueueListeners((count) => {
      setQueueCount(count);
    });

    // Poll queue count every 10s (lightweight)
    const interval = setInterval(() => {
      getQueueCount().then(setQueueCount).catch(() => {});
    }, 10_000);

    return () => {
      clearInterval(interval);
      cleanupRef.current?.();
    };
  }, []);

  // Manual retry handler
  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setLastResult(null);
    try {
      const result = await processQueue();
      const count = await getQueueCount();
      setQueueCount(count);
      setLastResult({
        processed: result.processed,
        deadLettered: result.deadLettered,
      });

      // Clear the result message after 5s
      setTimeout(() => setLastResult(null), 5_000);
    } finally {
      setRetrying(false);
    }
  }, []);

  // Don't show anything if online and no queued items and no result
  if (isOnline && queueCount === 0 && !lastResult) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none">
      <div className="mx-auto max-w-xl p-3">
        <div className="pointer-events-auto rounded-lg border bg-card shadow-lg">
          {/* Offline banner */}
          {!isOnline && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <WifiOff className="h-4 w-4 text-yellow-500 shrink-0" />
              <p className="text-sm text-yellow-500 font-medium">
                You&apos;re offline — sheet pushes will be queued and retried
                when you reconnect.
              </p>
            </div>
          )}

          {/* Queue status */}
          {queueCount > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {queueCount}
                  </span>{" "}
                  sheet push{queueCount !== 1 ? "es" : ""} queued for retry
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0"
                onClick={handleRetry}
                disabled={retrying || !isOnline}
              >
                <RefreshCw
                  className={`h-3 w-3 mr-1 ${retrying ? "animate-spin" : ""}`}
                />
                {retrying ? "Retrying…" : "Retry now"}
              </Button>
            </div>
          )}

          {/* Success/dead-letter result */}
          {lastResult && (
            <div className="flex items-center gap-2 px-4 py-2 border-t border-border">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              <p className="text-xs text-muted-foreground">
                {lastResult.processed > 0 && (
                  <span className="text-green-500">
                    {lastResult.processed} pushed successfully.{" "}
                  </span>
                )}
                {lastResult.deadLettered > 0 && (
                  <span className="text-red-400">
                    {lastResult.deadLettered} failed permanently (removed from
                    queue).
                  </span>
                )}
                {lastResult.processed === 0 && lastResult.deadLettered === 0 && (
                  <span>Queue is empty — nothing to retry.</span>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
