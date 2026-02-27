import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/debug/inventory?event_id=xxx
 *
 * Comprehensive diagnostic endpoint for debugging data visibility.
 * Mirrors the exact query flow of DashboardPage + KpiCards + InventoryPage.
 * Uses the authenticated user's session (cookies) to query through RLS.
 *
 * Visit this in your browser while logged in:
 *   /api/debug/inventory          → shows auth + events
 *   /api/debug/inventory?event_id=xxx → full pipeline test
 */
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("event_id");

  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event_id_param: eventId ?? "NOT PROVIDED — add ?event_id=xxx",
  };

  try {
    // ── Step 0: Cookie inspection ──
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    const supabaseCookies = allCookies.filter(
      (c) =>
        c.name.startsWith("sb-") || c.name.includes("supabase"),
    );
    checks.cookie_debug = {
      total_cookies: allCookies.length,
      supabase_cookies: supabaseCookies.map((c) => ({
        name: c.name,
        value_length: c.value.length,
        value_preview: c.value.substring(0, 40) + "...",
      })),
      all_cookie_names: allCookies.map((c) => c.name),
    };

    // ── Step 1: Create Supabase client ──
    const supabase = await createClient();

    // ── Step 2: Check auth ──
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    checks.auth_user = user
      ? { email: user.email, id: user.id, aud: user.aud, role: user.role }
      : `NOT AUTHENTICATED: ${authErr?.message ?? "no session"}`;

    if (!user) {
      checks.diagnosis =
        "No user session found. The Supabase auth cookies may be missing or expired. " +
        "Check the cookie_debug section above — there should be sb-* cookies present.";
      return NextResponse.json(checks, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }

    // ── Step 3: Event resolution (mirrors DashboardPage logic) ──
    let resolvedEventId = eventId;

    if (!resolvedEventId) {
      // Mirror the exact DashboardPage event resolution flow
      const { data: memberships, error: memListErr } = await supabase
        .from("event_members")
        .select("event_id")
        .eq("user_id", user.id);

      checks.step3_memberships = {
        count: memberships?.length ?? 0,
        data: memberships ?? [],
        error: memListErr?.message ?? null,
      };

      if (memberships && memberships.length > 0) {
        const ids = memberships.map((m) => m.event_id);
        const { data: events, error: evErr } = await supabase
          .from("events")
          .select("id, name, status, dealer_name")
          .in("id", ids)
          .order("created_at", { ascending: false });

        checks.step3_events = {
          count: events?.length ?? 0,
          data: events ?? [],
          error: evErr?.message ?? null,
        };

        if (events && events.length > 0) {
          const active = events.find((e) => e.status === "active");
          resolvedEventId = active?.id ?? events[0].id;
        }
      } else {
        // Fallback for users without memberships
        const { data: allEvents, error: allEvErr } = await supabase
          .from("events")
          .select("id, name, status")
          .order("created_at", { ascending: false })
          .limit(5);

        checks.step3_fallback_events = {
          count: allEvents?.length ?? 0,
          data: allEvents ?? [],
          error: allEvErr?.message ?? null,
        };
      }

      checks.resolved_event_id = resolvedEventId ?? "NONE — would show NoEventState";
    }

    if (!resolvedEventId) {
      checks.diagnosis =
        "No event resolved! User is authenticated but has no event_members entries visible through RLS, " +
        "and no events are accessible. This means the dashboard would show the NoEventState component.";
      return NextResponse.json(checks, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // ── Step 4: KpiCards pipeline (v_event_kpis view) ──
    const { data: kpiData, error: kpiErr } = await supabase
      .from("v_event_kpis")
      .select("*")
      .eq("event_id", resolvedEventId)
      .single();

    checks.step4_kpi_view = {
      data: kpiData,
      error: kpiErr?.message ?? null,
      error_code: kpiErr?.code ?? null,
      error_details: kpiErr?.details ?? null,
    };

    // ── Step 5: event_config (targets) ──
    const { data: configData, error: configErr } = await supabase
      .from("event_config")
      .select("target_units, target_gross, target_pvr")
      .eq("event_id", resolvedEventId)
      .single();

    checks.step5_event_config = {
      data: configData,
      error: configErr?.message ?? null,
    };

    // ── Step 6: vehicle_inventory direct query (mirrors InventoryPage) ──
    const { count: vehicleCount, error: countErr } = await supabase
      .from("vehicle_inventory")
      .select("id", { count: "exact", head: true })
      .eq("event_id", resolvedEventId);

    const { data: sampleVehicles, error: sampleErr } = await supabase
      .from("vehicle_inventory")
      .select("id, stock_number, year, make, model, status")
      .eq("event_id", resolvedEventId)
      .order("hat_number", { ascending: true })
      .limit(5);

    checks.step6_inventory = {
      total_count: vehicleCount ?? 0,
      count_error: countErr?.message ?? null,
      sample: sampleVehicles ?? [],
      sample_error: sampleErr?.message ?? null,
    };

    // ── Step 7: sales_deals (mirrors DashboardPage deals query) ──
    const { data: deals, error: dealsErr } = await supabase
      .from("sales_deals")
      .select("id, deal_number, customer_name, status")
      .eq("event_id", resolvedEventId)
      .order("created_at", { ascending: false })
      .limit(5);

    checks.step7_deals = {
      count: deals?.length ?? 0,
      sample: deals ?? [],
      error: dealsErr?.message ?? null,
    };

    // ── Step 8: Event details ──
    const { data: eventData, error: eventErr } = await supabase
      .from("events")
      .select("id, name, dealer_name, status")
      .eq("id", resolvedEventId)
      .single();

    checks.step8_event = {
      data: eventData,
      error: eventErr?.message ?? null,
    };

    // ── Step 9: Membership check ──
    const { data: membership, error: memErr } = await supabase
      .from("event_members")
      .select("role")
      .eq("event_id", resolvedEventId)
      .eq("user_id", user.id)
      .single();

    checks.step9_membership = {
      data: membership,
      error: memErr?.message ?? null,
    };

    // ── Diagnosis ──
    const issues: string[] = [];
    if (!kpiData) issues.push("v_event_kpis returned no data — KpiCards would show all zeros");
    if (kpiErr) issues.push(`v_event_kpis error: ${kpiErr.message}`);
    if ((vehicleCount ?? 0) === 0) issues.push("vehicle_inventory count is 0 — inventory page would be empty");
    if (countErr) issues.push(`vehicle_inventory count error: ${countErr.message}`);
    if (!membership) issues.push("No membership found — RLS might block data access");
    if (!eventData) issues.push("Event not found through RLS");

    checks.diagnosis = issues.length > 0
      ? { status: "ISSUES FOUND", issues }
      : { status: "ALL OK — data should be visible in dashboard" };

  } catch (err) {
    checks.crash = err instanceof Error ? err.message : String(err);
    checks.diagnosis = `CRASH: ${checks.crash}`;
  }

  return NextResponse.json(checks, {
    headers: { "Cache-Control": "no-store" },
  });
}
