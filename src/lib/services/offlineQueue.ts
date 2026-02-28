"use client";

import { openDB, type IDBPDatabase } from "idb";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface QueuedSheetAction {
  id?: number; // auto-incremented by IndexedDB
  /** The JSON body that would be sent to /api/sheets */
  payload: Record<string, unknown>;
  /** Event ID for audit trail */
  eventId: string | null;
  /** ISO timestamp of when this was queued */
  queuedAt: string;
  /** Number of retry attempts so far */
  retries: number;
  /** ISO timestamp of next retry (for backoff) */
  nextRetryAt: string | null;
  /** Last error message */
  lastError: string | null;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const DB_NAME = "jde-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "sheet-actions";

/** Exponential backoff delays in ms: 5s, 15s, 30s, 60s */
const BACKOFF_DELAYS = [5_000, 15_000, 30_000, 60_000];

/** Maximum retry attempts before giving up on a single item */
const MAX_RETRIES = 4;

// ────────────────────────────────────────────────────────────
// Database setup
// ────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      },
    });
  }
  return dbPromise;
}

// ────────────────────────────────────────────────────────────
// Queue operations
// ────────────────────────────────────────────────────────────

/**
 * Add a sheet action to the offline queue.
 * Called when a /api/sheets POST fails (network error, 5xx, etc.)
 */
export async function queueSheetAction(
  payload: Record<string, unknown>,
  eventId: string | null,
): Promise<void> {
  const db = await getDB();
  const item: Omit<QueuedSheetAction, "id"> = {
    payload,
    eventId,
    queuedAt: new Date().toISOString(),
    retries: 0,
    nextRetryAt: null,
    lastError: null,
  };
  await db.add(STORE_NAME, item);
}

/**
 * Get all queued items.
 */
export async function getQueuedActions(): Promise<QueuedSheetAction[]> {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

/**
 * Get the count of queued items.
 */
export async function getQueueCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_NAME);
}

/**
 * Remove a successfully processed item from the queue.
 */
export async function removeQueuedAction(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

/**
 * Update a queued item (e.g., increment retries, set next retry time).
 */
export async function updateQueuedAction(
  item: QueuedSheetAction,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, item);
}

/**
 * Clear all items from the queue.
 */
export async function clearQueue(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE_NAME);
}

// ────────────────────────────────────────────────────────────
// Queue processor
// ────────────────────────────────────────────────────────────

let processing = false;

/**
 * Process all eligible queued actions.
 * Tries to POST each one to /api/sheets.
 * - On success: removes from queue.
 * - On failure: increments retries, sets backoff, keeps in queue.
 * - Items exceeding MAX_RETRIES are removed (dead-lettered).
 *
 * Returns { processed, failed, deadLettered } counts.
 */
export async function processQueue(): Promise<{
  processed: number;
  failed: number;
  deadLettered: number;
}> {
  if (processing) return { processed: 0, failed: 0, deadLettered: 0 };
  processing = true;

  const result = { processed: 0, failed: 0, deadLettered: 0 };

  try {
    // Only process when online
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return result;
    }

    const items = await getQueuedActions();
    const now = Date.now();

    for (const item of items) {
      // Skip items that aren't ready for retry yet
      if (item.nextRetryAt && new Date(item.nextRetryAt).getTime() > now) {
        continue;
      }

      try {
        const res = await fetch("/api/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
        });

        if (res.ok) {
          // Success — remove from queue
          await removeQueuedAction(item.id!);
          result.processed++;
        } else if (res.status === 401) {
          // Auth error — don't retry, user needs to log in
          await removeQueuedAction(item.id!);
          result.deadLettered++;
        } else {
          // Server error — retry with backoff
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        const newRetries = item.retries + 1;

        if (newRetries >= MAX_RETRIES) {
          // Exceeded max retries — dead letter
          await removeQueuedAction(item.id!);
          result.deadLettered++;
          console.warn(
            `[offlineQueue] Dead-lettered action after ${MAX_RETRIES} retries:`,
            item.payload,
          );
        } else {
          // Schedule next retry with exponential backoff
          const delay =
            BACKOFF_DELAYS[Math.min(newRetries - 1, BACKOFF_DELAYS.length - 1)];
          const nextRetryAt = new Date(Date.now() + delay).toISOString();

          await updateQueuedAction({
            ...item,
            retries: newRetries,
            nextRetryAt,
            lastError:
              err instanceof Error ? err.message : String(err),
          });
          result.failed++;
        }
      }
    }
  } finally {
    processing = false;
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// Resilient fetch wrapper
// ────────────────────────────────────────────────────────────

/**
 * A resilient wrapper around fetch("/api/sheets", ...).
 *
 * - If online and the request succeeds → returns the response.
 * - If offline or the request fails with a network/server error →
 *   queues the action for later retry and returns null.
 * - 4xx errors (except network) are NOT queued (they're client errors).
 *
 * Use this in place of raw `fetch("/api/sheets", ...)` at all callsites.
 */
export async function resilientSheetFetch(
  payload: Record<string, unknown>,
  eventId: string | null,
): Promise<Response | null> {
  // If offline, queue immediately
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await queueSheetAction(payload, eventId);
    return null;
  }

  try {
    const res = await fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Success or client error (4xx) — return as-is (don't queue client errors)
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      return res;
    }

    // Server error (5xx) — queue for retry
    await queueSheetAction(payload, eventId);
    return null;
  } catch {
    // Network error (fetch threw) — queue for retry
    await queueSheetAction(payload, eventId);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// Listeners setup (called once from a provider/layout)
// ────────────────────────────────────────────────────────────

let listenersAttached = false;

/**
 * Attach global listeners that auto-process the queue when:
 * - Browser comes back online (navigator.onLine)
 * - Tab becomes visible again (visibilitychange)
 *
 * Also runs an initial processQueue() on attach.
 *
 * Returns a cleanup function to remove the listeners.
 */
export function attachQueueListeners(
  onQueueChange?: (count: number) => void,
): () => void {
  if (typeof window === "undefined" || listenersAttached) {
    return () => {};
  }
  listenersAttached = true;

  const handleProcess = async () => {
    const result = await processQueue();
    if (onQueueChange && (result.processed > 0 || result.deadLettered > 0)) {
      const count = await getQueueCount();
      onQueueChange(count);
    }
  };

  const handleOnline = () => {
    // Small delay to let the network stabilize
    setTimeout(handleProcess, 1_000);
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      handleProcess();
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  // Initial processing attempt
  handleProcess();

  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
    listenersAttached = false;
  };
}
