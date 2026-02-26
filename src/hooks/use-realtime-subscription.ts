"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";

type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE";

interface RealtimePayload<T = Record<string, unknown>> {
  eventType: RealtimeEvent;
  new: T;
  old: T;
}

interface UseRealtimeOptions {
  /** The table to subscribe to */
  table: string;
  /** The event_id to filter on (REQUIRED for security) */
  eventId: string | null;
  /** Tables typically: vehicle_inventory, sales_deals, roster, mail_tracking */
  /** Callback when a change happens */
  onInsert?: (record: Record<string, unknown>) => void;
  onUpdate?: (record: Record<string, unknown>) => void;
  onDelete?: (record: Record<string, unknown>) => void;
  /** Show toast notifications for changes */
  showToasts?: boolean;
  /** Enable/disable subscription */
  enabled?: boolean;
}

export function useRealtimeSubscription({
  table,
  eventId,
  onInsert,
  onUpdate,
  onDelete,
  showToasts = false,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  const handleChange = useCallback(
    (payload: RealtimePayload) => {
      const { eventType } = payload;

      switch (eventType) {
        case "INSERT":
          onInsert?.(payload.new);
          if (showToasts) {
            toast.info(`New ${table.replace("_", " ")} added`);
          }
          break;
        case "UPDATE":
          onUpdate?.(payload.new);
          if (showToasts) {
            toast.info(`${table.replace("_", " ")} updated`);
          }
          break;
        case "DELETE":
          onDelete?.(payload.old);
          if (showToasts) {
            toast.info(`${table.replace("_", " ")} removed`);
          }
          break;
      }
    },
    [onInsert, onUpdate, onDelete, showToasts, table],
  );

  useEffect(() => {
    // Don't subscribe without an eventId (security) or if disabled
    if (!eventId || !enabled) return;

    const supabase = createClient();

    // Create a uniquely named channel
    const channelName = `${table}-${eventId}-${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          handleChange(payload as unknown as RealtimePayload);
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error(`Realtime subscription error on ${table}`);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [table, eventId, enabled, handleChange]);
}

/**
 * Convenience hook to subscribe to multiple tables at once
 */
export function useEventRealtime(
  eventId: string | null,
  onAnyChange: () => void,
  options?: { showToasts?: boolean; enabled?: boolean },
) {
  const tables = [
    "vehicle_inventory",
    "sales_deals",
    "roster",
    "mail_tracking",
    "daily_metrics",
  ];

  // We need individual hooks for each table since hooks can't be in loops conditionally
  useRealtimeSubscription({
    table: tables[0],
    eventId,
    onInsert: onAnyChange,
    onUpdate: onAnyChange,
    onDelete: onAnyChange,
    showToasts: options?.showToasts,
    enabled: options?.enabled,
  });

  useRealtimeSubscription({
    table: tables[1],
    eventId,
    onInsert: onAnyChange,
    onUpdate: onAnyChange,
    onDelete: onAnyChange,
    showToasts: options?.showToasts,
    enabled: options?.enabled,
  });

  useRealtimeSubscription({
    table: tables[2],
    eventId,
    onInsert: onAnyChange,
    onUpdate: onAnyChange,
    onDelete: onAnyChange,
    enabled: options?.enabled,
  });

  useRealtimeSubscription({
    table: tables[3],
    eventId,
    onInsert: onAnyChange,
    onUpdate: onAnyChange,
    onDelete: onAnyChange,
    enabled: options?.enabled,
  });

  useRealtimeSubscription({
    table: tables[4],
    eventId,
    onInsert: onAnyChange,
    onUpdate: onAnyChange,
    onDelete: onAnyChange,
    enabled: options?.enabled,
  });
}
