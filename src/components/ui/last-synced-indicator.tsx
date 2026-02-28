"use client";

import { useState, useEffect } from "react";
import { Cloud } from "lucide-react";

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

interface LastSyncedIndicatorProps {
  syncedAt: Date | null;
}

export function LastSyncedIndicator({ syncedAt }: LastSyncedIndicatorProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!syncedAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [syncedAt]);

  if (!syncedAt) return null;

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Cloud className="h-3.5 w-3.5 text-green-600" />
      Synced {formatRelativeTime(syncedAt)}
    </span>
  );
}
