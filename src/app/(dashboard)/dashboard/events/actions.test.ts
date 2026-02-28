/**
 * actions.test.ts
 * ===============
 * Tests for the event creation server actions — createEvent and
 * createEventFromTemplate — the multi-step orchestration that copies
 * sheets, roster, lenders, and config from a template event.
 *
 * Tests cover:
 *  1. createEvent — basic event creation + membership + redirect
 *  2. createEvent — requires name
 *  3. createEvent — requires auth
 *  4. createEventFromTemplate — full template copy (sheet, config, roster, lenders)
 *  5. createEventFromTemplate — skips optional copies when flags are false
 *  6. createEventFromTemplate — continues without sheet on copy failure
 *  7. createEventFromTemplate — requires membership in template event
 *  8. createEventFromTemplate — requires auth
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ────────────────────────────────────────────────────────────
// Mock setup — order matters: mocks before imports
// ────────────────────────────────────────────────────────────

// Track all Supabase calls
const mockSupabaseChain = {
  // Auth
  auth: {
    getUser: vi.fn(),
  },
  // Query builder chain
  from: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  upsert: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
  single: vi.fn(),
  order: vi.fn(),
};

// Build a chainable mock that returns itself
function createChainMock(finalValue?: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["from", "select", "insert", "upsert", "eq", "in", "single", "order"];

  for (const m of methods) {
    chain[m] = vi.fn().mockReturnThis();
  }

  // Terminal method — returns the final value
  chain.single = vi.fn().mockResolvedValue(finalValue ?? { data: null, error: null });

  return chain;
}

// The mock Supabase client
let supabaseCallLog: Array<{ method: string; args: unknown[] }> = [];
let mockFromHandlers: Record<string, Record<string, unknown>> = {};

function buildMockSupabase() {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "test@test.com" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      supabaseCallLog.push({ method: "from", args: [table] });

      // Return a chainable builder
      const builder = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      // Allow test-specific overrides per table
      if (mockFromHandlers[table]) {
        Object.assign(builder, mockFromHandlers[table]);
      }

      return builder;
    }),
  };

  return client;
}

let mockSupabase = buildMockSupabase();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

// Mock redirect (Next.js server action)
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mockRedirect(url);
    // redirect() throws in Next.js to halt execution
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

// Mock copySpreadsheet
const mockCopySpreadsheet = vi.fn();
vi.mock("@/lib/services/googleSheets", () => ({
  copySpreadsheet: (...args: unknown[]) => mockCopySpreadsheet(...args),
}));

// NOW import the actions
import { createEvent, createEventFromTemplate } from "./actions";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

// ────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  supabaseCallLog = [];
  mockFromHandlers = {};
  mockSupabase = buildMockSupabase();
  mockCopySpreadsheet.mockReset();
  mockRedirect.mockReset();
});

// ────────────────────────────────────────────────────────────
// 1. createEvent
// ────────────────────────────────────────────────────────────

describe("createEvent", () => {
  it("creates event, adds membership, and redirects", async () => {
    const fakeEvent = { id: "new-event-1", name: "Summer Sale" };

    // events.insert().select().single() returns the new event
    mockFromHandlers["events"] = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: fakeEvent, error: null }),
        }),
      }),
    };

    // event_members.insert() succeeds
    mockFromHandlers["event_members"] = {
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const formData = makeFormData({
      name: "Summer Sale",
      dealer_name: "Test Dealer",
      city: "Chicago",
      state: "IL",
      status: "active",
    });

    // Should throw due to redirect
    await expect(createEvent(formData)).rejects.toThrow("NEXT_REDIRECT");

    // Verify redirect was called with correct path
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard/events/new-event-1");

    // Verify events table was called
    const eventsCalls = supabaseCallLog.filter((c) => c.args[0] === "events");
    expect(eventsCalls.length).toBeGreaterThan(0);

    // Verify event_members was inserted
    const membersCalls = supabaseCallLog.filter(
      (c) => c.args[0] === "event_members",
    );
    expect(membersCalls.length).toBeGreaterThan(0);
  });

  it("throws when name is missing", async () => {
    const formData = makeFormData({
      dealer_name: "Test",
    });
    // name is empty string
    await expect(createEvent(formData)).rejects.toThrow(
      "Event name is required",
    );
  });

  it("redirects to login when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Not authenticated" },
    });

    const formData = makeFormData({ name: "Test Event" });

    await expect(createEvent(formData)).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });
});

// ────────────────────────────────────────────────────────────
// 2. createEventFromTemplate
// ────────────────────────────────────────────────────────────

describe("createEventFromTemplate", () => {
  const templateEvent = {
    id: "template-1",
    name: "Template Event",
    slug: "template-event",
    status: "completed",
    dealer_name: "Template Dealer",
    address: "123 Main St",
    city: "Detroit",
    state: "MI",
    zip: "48201",
    franchise: "Ford",
    start_date: null,
    end_date: null,
    sale_days: 5,
    budget: 10000,
    notes: null,
    sheet_id: "template-sheet-id",
    created_by: "user-1",
    created_at: new Date().toISOString(),
  };

  const templateConfig = {
    event_id: "template-1",
    doc_fee: 499,
    tax_rate: 6.25,
    pack: 500,
    jde_commission_pct: 25,
    rep_commission_pct: 25,
    mail_campaign_name: "Summer Mailer",
    mail_pieces_sent: 10000,
    target_units: 100,
    target_gross: 500000,
    target_pvr: 5000,
    washout_threshold: 0,
  };

  const templateRoster = [
    { name: "John Smith", phone: "555-0001", email: "john@test.com", role: "sales", team: "A", commission_pct: 25, notes: null },
    { name: "Jane Doe", phone: "555-0002", email: "jane@test.com", role: "fi_manager", team: null, commission_pct: null, notes: "Senior" },
  ];

  const templateLenders = [
    { name: "Chase Auto", buy_rate_pct: 3.5, max_advance: 50000, notes: null, active: true },
    { name: "Capital One", buy_rate_pct: 4.0, max_advance: 45000, notes: "Tier 1 only", active: true },
  ];

  function setupFullTemplateMocks() {
    const newEvent = { id: "new-event-1", name: "New Event" };

    // event_members.select().eq().eq().single() — membership check
    let eventMembersCallCount = 0;
    mockFromHandlers["event_members"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { role: "owner" },
              error: null,
            }),
          }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    // events — first call is select (template), second is insert (new event)
    let eventsCallCount = 0;
    mockFromHandlers["events"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: templateEvent,
            error: null,
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: newEvent,
            error: null,
          }),
        }),
      }),
    };

    // event_config
    mockFromHandlers["event_config"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: templateConfig,
            error: null,
          }),
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    // roster
    mockFromHandlers["roster"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: templateRoster,
          error: null,
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    // lenders
    mockFromHandlers["lenders"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: templateLenders,
          error: null,
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    // copySpreadsheet succeeds
    mockCopySpreadsheet.mockResolvedValue({
      spreadsheetId: "new-sheet-id",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-sheet-id",
    });

    return newEvent;
  }

  it("copies sheet, event, config, roster, lenders and redirects", async () => {
    const newEvent = setupFullTemplateMocks();

    const formData = makeFormData({
      name: "Fall Sale 2025",
      dealer_name: "New Dealer",
      copy_roster: "true",
      copy_lenders: "true",
      copy_settings: "true",
      create_sheet: "true",
    });

    await expect(
      createEventFromTemplate("template-1", formData),
    ).rejects.toThrow("NEXT_REDIRECT");

    // Verify redirect
    expect(mockRedirect).toHaveBeenCalledWith(
      `/dashboard/events/${newEvent.id}`,
    );

    // Verify Google Sheet was copied
    expect(mockCopySpreadsheet).toHaveBeenCalledWith(
      "template-sheet-id",
      "JDE — Fall Sale 2025",
    );

    // Verify all tables were accessed
    const tables = supabaseCallLog.map((c) => c.args[0]);
    expect(tables).toContain("event_members");
    expect(tables).toContain("events");
    expect(tables).toContain("event_config");
    expect(tables).toContain("roster");
    expect(tables).toContain("lenders");
  });

  it("skips optional copies when flags are false", async () => {
    setupFullTemplateMocks();

    const formData = makeFormData({
      name: "Minimal Event",
      copy_roster: "false",
      copy_lenders: "false",
      copy_settings: "false",
      create_sheet: "false",
    });

    await expect(
      createEventFromTemplate("template-1", formData),
    ).rejects.toThrow("NEXT_REDIRECT");

    // Sheet should NOT be copied
    expect(mockCopySpreadsheet).not.toHaveBeenCalled();

    // Only event_members and events should be accessed (not config, roster, lenders)
    const tables = supabaseCallLog.map((c) => c.args[0]);
    expect(tables).not.toContain("event_config");
    expect(tables).not.toContain("roster");
    expect(tables).not.toContain("lenders");
  });

  it("continues without sheet when copySpreadsheet fails", async () => {
    setupFullTemplateMocks();
    mockCopySpreadsheet.mockRejectedValue(
      new Error("Google API rate limit exceeded"),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const formData = makeFormData({
      name: "Event Without Sheet",
      copy_roster: "false",
      copy_lenders: "false",
      copy_settings: "false",
      create_sheet: "true",
    });

    // Should NOT throw — should continue and redirect
    await expect(
      createEventFromTemplate("template-1", formData),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockRedirect).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Sheet copy failed"),
      expect.any(Error),
    );
  });

  it("throws when not a member of template event", async () => {
    // Membership check returns null
    mockFromHandlers["event_members"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      }),
    };

    const formData = makeFormData({
      name: "Unauthorized Event",
      copy_roster: "false",
      copy_lenders: "false",
      copy_settings: "false",
      create_sheet: "false",
    });

    await expect(
      createEventFromTemplate("template-1", formData),
    ).rejects.toThrow("Not a member of the template event");
  });

  it("redirects to login when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Not authenticated" },
    });

    const formData = makeFormData({
      name: "Unauth Event",
      copy_roster: "false",
      copy_lenders: "false",
      copy_settings: "false",
      create_sheet: "false",
    });

    await expect(
      createEventFromTemplate("template-1", formData),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("throws when event name is missing", async () => {
    // Need membership check to pass first
    mockFromHandlers["event_members"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { role: "owner" },
              error: null,
            }),
          }),
        }),
      }),
    };

    mockFromHandlers["events"] = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: templateEvent,
            error: null,
          }),
        }),
      }),
    };

    const formData = makeFormData({
      copy_roster: "false",
      copy_lenders: "false",
      copy_settings: "false",
      create_sheet: "false",
    });

    await expect(
      createEventFromTemplate("template-1", formData),
    ).rejects.toThrow("Event name is required");
  });
});
