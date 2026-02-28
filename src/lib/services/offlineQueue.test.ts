/**
 * offlineQueue.test.ts
 * ====================
 * Unit tests for the offline queue service — the backbone of resilient
 * sheet pushes in JDE Mission Control.
 *
 * Tests cover:
 *  1. queueSheetAction — adds items to IndexedDB
 *  2. getQueuedActions / getQueueCount — retrieval
 *  3. removeQueuedAction — cleanup after success
 *  4. processQueue — retry loop with backoff
 *  5. Dead-lettering after MAX_RETRIES
 *  6. 401 auth errors are dead-lettered immediately
 *  7. resilientSheetFetch — offline/online branching
 *  8. Skips items not yet ready for retry (backoff window)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  queueSheetAction,
  getQueuedActions,
  getQueueCount,
  removeQueuedAction,
  clearQueue,
  processQueue,
  resilientSheetFetch,
} from "./offlineQueue";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Reset the module-level `processing` flag and DB between tests */
beforeEach(async () => {
  await clearQueue();
  vi.restoreAllMocks();

  // Default: browser is online
  Object.defineProperty(navigator, "onLine", {
    value: true,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────
// 1. Queue operations
// ────────────────────────────────────────────────────────────

describe("queueSheetAction", () => {
  it("adds an item to the queue with correct defaults", async () => {
    const payload = { action: "appendRow", sheetTitle: "Inventory", data: { vin: "123" } };
    await queueSheetAction(payload, "event-1");

    const items = await getQueuedActions();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      payload,
      eventId: "event-1",
      retries: 0,
      nextRetryAt: null,
      lastError: null,
    });
    expect(items[0].queuedAt).toBeTruthy();
    expect(items[0].id).toBeGreaterThan(0);
  });

  it("handles null eventId", async () => {
    await queueSheetAction({ action: "test" }, null);

    const items = await getQueuedActions();
    expect(items).toHaveLength(1);
    expect(items[0].eventId).toBeNull();
  });

  it("queues multiple actions with unique IDs", async () => {
    await queueSheetAction({ action: "a" }, "e1");
    await queueSheetAction({ action: "b" }, "e1");
    await queueSheetAction({ action: "c" }, "e2");

    const items = await getQueuedActions();
    expect(items).toHaveLength(3);

    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(3); // all unique
  });
});

describe("getQueueCount", () => {
  it("returns 0 for empty queue", async () => {
    expect(await getQueueCount()).toBe(0);
  });

  it("returns correct count after queueing", async () => {
    await queueSheetAction({ a: 1 }, null);
    await queueSheetAction({ b: 2 }, null);
    expect(await getQueueCount()).toBe(2);
  });
});

describe("removeQueuedAction", () => {
  it("removes a specific item by ID", async () => {
    await queueSheetAction({ action: "keep" }, null);
    await queueSheetAction({ action: "remove" }, null);

    const items = await getQueuedActions();
    const removeId = items.find((i) => (i.payload as Record<string, unknown>).action === "remove")!.id!;

    await removeQueuedAction(removeId);

    const remaining = await getQueuedActions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload).toEqual({ action: "keep" });
  });
});

describe("clearQueue", () => {
  it("removes all items", async () => {
    await queueSheetAction({ a: 1 }, null);
    await queueSheetAction({ b: 2 }, null);
    await queueSheetAction({ c: 3 }, null);

    await clearQueue();
    expect(await getQueueCount()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// 2. processQueue — success path
// ────────────────────────────────────────────────────────────

describe("processQueue", () => {
  it("processes items and removes them on success (200)", async () => {
    await queueSheetAction({ action: "appendRow" }, "e1");
    await queueSheetAction({ action: "updateRow" }, "e1");

    // Mock fetch to return success
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const result = await processQueue();

    expect(result).toEqual({ processed: 2, failed: 0, deadLettered: 0 });
    expect(await getQueueCount()).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns zeros when offline", async () => {
    await queueSheetAction({ action: "test" }, null);

    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    const result = await processQueue();
    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 0 });
    // Item should still be in queue
    expect(await getQueueCount()).toBe(1);
  });

  // ──────────────────────────────────────────────────────────
  // 3. processQueue — 401 auth error → dead-letter immediately
  // ──────────────────────────────────────────────────────────

  it("dead-letters 401 auth errors immediately (no retry)", async () => {
    await queueSheetAction({ action: "appendRow" }, "e1");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const result = await processQueue();

    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 1 });
    expect(await getQueueCount()).toBe(0);
  });

  // ──────────────────────────────────────────────────────────
  // 4. processQueue — 5xx server error → retry with backoff
  // ──────────────────────────────────────────────────────────

  it("increments retries and sets backoff on server error", async () => {
    await queueSheetAction({ action: "appendRow" }, "e1");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const result = await processQueue();

    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 0 });

    const items = await getQueuedActions();
    expect(items).toHaveLength(1);
    expect(items[0].retries).toBe(1);
    expect(items[0].lastError).toBe("HTTP 500");
    expect(items[0].nextRetryAt).toBeTruthy();

    // Verify backoff: first retry delay is 5 seconds
    const retryTime = new Date(items[0].nextRetryAt!).getTime();
    const now = Date.now();
    // Should be roughly 5 seconds in the future (allow 2s tolerance)
    expect(retryTime).toBeGreaterThan(now + 3_000);
    expect(retryTime).toBeLessThan(now + 10_000);
  });

  // ──────────────────────────────────────────────────────────
  // 5. processQueue — dead-letter after MAX_RETRIES (4)
  // ──────────────────────────────────────────────────────────

  it("dead-letters items after 4 failed retries", async () => {
    await queueSheetAction({ action: "appendRow" }, "e1");

    // Simulate 3 previous retries by manually updating the item
    const items = await getQueuedActions();
    const item = items[0];
    item.retries = 3;
    item.nextRetryAt = null; // make it eligible for processing

    const { updateQueuedAction } = await import("./offlineQueue");
    await updateQueuedAction(item);

    // 4th attempt also fails → should dead-letter
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Server Error", { status: 500 }),
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await processQueue();

    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 1 });
    expect(await getQueueCount()).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dead-lettered"),
      expect.anything(),
    );
  });

  // ──────────────────────────────────────────────────────────
  // 6. processQueue — skips items in backoff window
  // ──────────────────────────────────────────────────────────

  it("skips items whose nextRetryAt is in the future", async () => {
    await queueSheetAction({ action: "appendRow" }, "e1");

    // Set nextRetryAt to 10 minutes in the future
    const items = await getQueuedActions();
    const item = items[0];
    item.retries = 1;
    item.nextRetryAt = new Date(Date.now() + 600_000).toISOString();

    const { updateQueuedAction } = await import("./offlineQueue");
    await updateQueuedAction(item);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const result = await processQueue();

    // Should skip the item entirely — no fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 0 });
    expect(await getQueueCount()).toBe(1); // still in queue
  });

  it("processes items whose nextRetryAt is in the past", async () => {
    await queueSheetAction({ action: "appendRow" }, "e1");

    // Set nextRetryAt to 1 second in the past
    const items = await getQueuedActions();
    const item = items[0];
    item.retries = 1;
    item.nextRetryAt = new Date(Date.now() - 1_000).toISOString();

    const { updateQueuedAction } = await import("./offlineQueue");
    await updateQueuedAction(item);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const result = await processQueue();

    expect(result).toEqual({ processed: 1, failed: 0, deadLettered: 0 });
    expect(await getQueueCount()).toBe(0);
  });

  // ──────────────────────────────────────────────────────────
  // 7. processQueue — network error (fetch throws)
  // ──────────────────────────────────────────────────────────

  it("handles network errors (fetch throws) with retry", async () => {
    await queueSheetAction({ action: "appendRow" }, "e1");

    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    const result = await processQueue();

    expect(result).toEqual({ processed: 0, failed: 1, deadLettered: 0 });

    const items = await getQueuedActions();
    expect(items[0].retries).toBe(1);
    expect(items[0].lastError).toBe("Failed to fetch");
  });
});

// ────────────────────────────────────────────────────────────
// 3. resilientSheetFetch
// ────────────────────────────────────────────────────────────

describe("resilientSheetFetch", () => {
  it("returns Response on success (2xx)", async () => {
    const mockResponse = new Response(JSON.stringify({ success: true }), {
      status: 200,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await resilientSheetFetch({ action: "test" }, "e1");

    expect(result).toBe(mockResponse);
    expect(await getQueueCount()).toBe(0); // not queued
  });

  it("returns Response on 4xx client error (NOT queued)", async () => {
    const mockResponse = new Response("Bad Request", { status: 400 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await resilientSheetFetch({ action: "test" }, "e1");

    expect(result).toBe(mockResponse);
    expect(result!.status).toBe(400);
    expect(await getQueueCount()).toBe(0); // client errors NOT queued
  });

  it("queues and returns null on 5xx server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Server Error", { status: 500 }),
    );

    const result = await resilientSheetFetch(
      { action: "appendRow", data: { test: true } },
      "e1",
    );

    expect(result).toBeNull();
    expect(await getQueueCount()).toBe(1);

    const items = await getQueuedActions();
    expect(items[0].payload).toEqual({ action: "appendRow", data: { test: true } });
    expect(items[0].eventId).toBe("e1");
  });

  it("queues and returns null when offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await resilientSheetFetch({ action: "test" }, "e1");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // should not even try
    expect(await getQueueCount()).toBe(1);
  });

  it("queues and returns null when fetch throws (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Network request failed"),
    );

    const result = await resilientSheetFetch({ action: "test" }, "e1");

    expect(result).toBeNull();
    expect(await getQueueCount()).toBe(1);
  });
});
