"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useEvent } from "@/providers/event-provider";
import { resilientSheetFetch } from "@/lib/services/offlineQueue";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface SheetPushResult {
  success: boolean;
  queued: boolean;
  error: string | null;
}

export interface SheetPushOptions {
  /** Toast to show on success. Pass `false` to suppress. */
  successMessage?: string | false;
  /** Toast to show when queued. Pass `false` to suppress. */
  queuedMessage?: string | false;
  /** Toast to show on error. Pass `false` to suppress. */
  errorMessage?: string | false;
  /** Callback fired on success (not queued). */
  onSuccess?: () => void;
}

// ────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────

/**
 * Centralized hook for all Google Sheets push operations.
 *
 * Handles:
 *  - `resilientSheetFetch` (offline queue + retry)
 *  - Success / queued / error toasts
 *  - Returns `{ success, queued, error }`
 *
 * The payload is passed directly to `/api/sheets` as the POST body.
 * The hook automatically injects `spreadsheetId` and `eventId` from
 * the current event context (can be overridden via the payload).
 */
export function useSheetPush() {
  const { currentEvent } = useEvent();

  const push = useCallback(
    async (
      payload: Record<string, unknown>,
      options?: SheetPushOptions,
    ): Promise<SheetPushResult> => {
      const {
        successMessage = "Pushed to Google Sheet",
        queuedMessage = "Sheet push queued — will retry automatically",
        errorMessage,
        onSuccess,
      } = options ?? {};

      // Inject event context if not already provided in payload
      const fullPayload: Record<string, unknown> = {
        spreadsheetId: currentEvent?.sheet_id,
        eventId: currentEvent?.id,
        ...payload,
      };

      try {
        const res = await resilientSheetFetch(
          fullPayload,
          (fullPayload.eventId as string) ?? null,
        );

        // Queued (offline or 5xx)
        if (!res) {
          if (queuedMessage !== false) {
            toast.info(queuedMessage, { duration: 3000 });
          }
          return { success: false, queued: true, error: null };
        }

        // Success
        if (res.ok) {
          if (successMessage !== false) {
            toast.success(successMessage, { duration: 2000 });
          }
          onSuccess?.();
          return { success: true, queued: false, error: null };
        }

        // Client error (4xx) — not queued
        const body = await res.json().catch(() => ({}));
        const msg =
          body.error || `Sheet push failed: ${res.status}`;
        if (errorMessage !== false) {
          toast.error(errorMessage || msg, { duration: 4000 });
        }
        return { success: false, queued: false, error: msg };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err);
        if (errorMessage !== false) {
          toast.error(errorMessage || `Sheet push failed: ${msg}`, {
            duration: 4000,
          });
        }
        return { success: false, queued: false, error: msg };
      }
    },
    [currentEvent],
  );

  /**
   * Fire-and-forget variant — calls push() but doesn't block.
   * Returns the promise so callers can optionally chain.
   */
  const pushAsync = useCallback(
    (
      payload: Record<string, unknown>,
      options?: SheetPushOptions,
    ): Promise<SheetPushResult> => {
      return push(payload, options);
    },
    [push],
  );

  return { push, pushAsync };
}
