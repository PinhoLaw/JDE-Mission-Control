/**
 * useSheetPush.test.tsx
 * =====================
 * Tests for the centralized sheet push hook that wraps resilientSheetFetch
 * with event context injection, toast notifications, and result typing.
 *
 * Tests cover:
 *  1. Successful push (online) — returns { success: true, queued: false }
 *  2. Queued push (offline/5xx) — returns { success: false, queued: true }
 *  3. Client error (4xx) — returns { success: false, queued: false, error }
 *  4. Event context injection (spreadsheetId, eventId)
 *  5. Toast messages (success, queued, error) with suppression
 *  6. onSuccess callback fires only on success
 *  7. Payload override of injected context
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// ────────────────────────────────────────────────────────────
// Mocks — use vi.hoisted() so variables are available in
// vi.mock factories (which are hoisted above all imports)
// ────────────────────────────────────────────────────────────

const { mockToast, mockResilientFetch, mockCurrentEvent } = vi.hoisted(() => {
  const mockToast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };

  const mockResilientFetch = vi.fn();

  const mockCurrentEvent = {
    id: "event-123",
    sheet_id: "sheet-abc",
    name: "Test Event",
    slug: "test-event",
    status: "active" as const,
    dealer_name: "Test Dealer",
    address: null,
    city: null,
    state: null,
    zip: null,
    franchise: null,
    start_date: null,
    end_date: null,
    sale_days: null,
    budget: null,
    notes: null,
    sheet_url: null,
    created_at: new Date().toISOString(),
    created_by: "user-1",
  };

  return { mockToast, mockResilientFetch, mockCurrentEvent };
});

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/providers/event-provider", () => ({
  useEvent: () => ({
    currentEvent: mockCurrentEvent,
    availableEvents: [mockCurrentEvent],
    isLoading: false,
    setCurrentEvent: vi.fn(),
  }),
}));

vi.mock("@/lib/services/offlineQueue", () => ({
  resilientSheetFetch: (...args: unknown[]) => mockResilientFetch(...args),
}));

// NOW import the hook (after mocks are set up)
import { useSheetPush } from "./useSheetPush";

// ────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockResilientFetch.mockReset();
});

// Simple wrapper — no providers needed since useEvent is fully mocked
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("useSheetPush", () => {
  // ──────────────────────────────────────────────────────────
  // 1. Successful push
  // ──────────────────────────────────────────────────────────

  it("returns success and shows toast on 200 response", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    let pushResult: Awaited<ReturnType<typeof result.current.push>>;
    await act(async () => {
      pushResult = await result.current.push({ action: "appendRow" });
    });

    expect(pushResult!).toEqual({ success: true, queued: false, error: null });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Pushed to Google Sheet",
      { duration: 2000 },
    );
  });

  // ──────────────────────────────────────────────────────────
  // 2. Queued push (offline / 5xx)
  // ──────────────────────────────────────────────────────────

  it("returns queued and shows info toast when resilientSheetFetch returns null", async () => {
    mockResilientFetch.mockResolvedValue(null);

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    let pushResult: Awaited<ReturnType<typeof result.current.push>>;
    await act(async () => {
      pushResult = await result.current.push({ action: "appendRow" });
    });

    expect(pushResult!).toEqual({ success: false, queued: true, error: null });
    expect(mockToast.info).toHaveBeenCalledWith(
      "Sheet push queued — will retry automatically",
      { duration: 3000 },
    );
  });

  // ──────────────────────────────────────────────────────────
  // 3. Client error (4xx)
  // ──────────────────────────────────────────────────────────

  it("returns error on 4xx response", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing sheetTitle" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    let pushResult: Awaited<ReturnType<typeof result.current.push>>;
    await act(async () => {
      pushResult = await result.current.push({ action: "badAction" });
    });

    expect(pushResult!).toEqual({
      success: false,
      queued: false,
      error: "Missing sheetTitle",
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      "Missing sheetTitle",
      { duration: 4000 },
    );
  });

  // ──────────────────────────────────────────────────────────
  // 4. Event context injection
  // ──────────────────────────────────────────────────────────

  it("injects spreadsheetId and eventId from current event", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push({
        action: "appendRow",
        sheetTitle: "Inventory",
      });
    });

    // Check the first argument to resilientSheetFetch
    expect(mockResilientFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "sheet-abc",
        eventId: "event-123",
        action: "appendRow",
        sheetTitle: "Inventory",
      }),
      "event-123",
    );
  });

  it("allows payload to override injected context", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push({
        action: "appendRow",
        spreadsheetId: "custom-sheet-id",
        eventId: "custom-event-id",
      });
    });

    expect(mockResilientFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "custom-sheet-id",
        eventId: "custom-event-id",
      }),
      "custom-event-id",
    );
  });

  // ──────────────────────────────────────────────────────────
  // 5. Toast suppression
  // ──────────────────────────────────────────────────────────

  it("suppresses success toast when successMessage is false", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push(
        { action: "appendRow" },
        { successMessage: false },
      );
    });

    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("suppresses queued toast when queuedMessage is false", async () => {
    mockResilientFetch.mockResolvedValue(null);

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push(
        { action: "appendRow" },
        { queuedMessage: false },
      );
    });

    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it("uses custom toast messages", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push(
        { action: "appendRow" },
        { successMessage: "Vehicle added to sheet!" },
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      "Vehicle added to sheet!",
      { duration: 2000 },
    );
  });

  // ──────────────────────────────────────────────────────────
  // 6. onSuccess callback
  // ──────────────────────────────────────────────────────────

  it("fires onSuccess callback only on success", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push({ action: "appendRow" }, { onSuccess });
    });

    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("does NOT fire onSuccess when queued", async () => {
    mockResilientFetch.mockResolvedValue(null);

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push({ action: "appendRow" }, { onSuccess });
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does NOT fire onSuccess on 4xx error", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Bad" }), { status: 400 }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSheetPush(), { wrapper });

    await act(async () => {
      await result.current.push({ action: "appendRow" }, { onSuccess });
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────
  // 7. pushAsync is identical to push
  // ──────────────────────────────────────────────────────────

  it("pushAsync returns the same result as push", async () => {
    mockResilientFetch.mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    let pushResult: Awaited<ReturnType<typeof result.current.pushAsync>>;
    await act(async () => {
      pushResult = await result.current.pushAsync({ action: "test" });
    });

    expect(pushResult!).toEqual({ success: true, queued: false, error: null });
  });

  // ──────────────────────────────────────────────────────────
  // 8. Exception handling in push
  // ──────────────────────────────────────────────────────────

  it("returns error when resilientSheetFetch throws", async () => {
    mockResilientFetch.mockRejectedValue(new Error("Unexpected failure"));

    const { result } = renderHook(() => useSheetPush(), { wrapper });

    let pushResult: Awaited<ReturnType<typeof result.current.push>>;
    await act(async () => {
      pushResult = await result.current.push({ action: "test" });
    });

    expect(pushResult!).toEqual({
      success: false,
      queued: false,
      error: "Unexpected failure",
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      "Sheet push failed: Unexpected failure",
      { duration: 4000 },
    );
  });
});
