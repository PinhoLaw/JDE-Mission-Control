import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/debug/inventory?event_id=xxx
 *
 * Diagnostic endpoint for debugging vehicle_inventory.
 * Uses the authenticated user's session (cookies) to query
 * through RLS — same as what the dashboard sees.
 */
export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("event_id");

  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event_id_param: eventId ?? "NOT PROVIDED — add ?event_id=xxx",
  };

  try {
    const supabase = await createClient();

    // Check auth
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    checks.auth_user = user
      ? { email: user.email, id: user.id }
      : `NOT AUTHENTICATED: ${authErr?.message ?? "no session"}`;

    if (!user) {
      return NextResponse.json(checks, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (!eventId) {
      // List all events this user has access to
      const { data: events, error: evErr } = await supabase
        .from("events")
        .select("id, name, dealer_name, status")
        .order("created_at", { ascending: false });

      checks.accessible_events = events ?? [];
      checks.events_error = evErr?.message ?? null;

      // Also list memberships
      const { data: memberships } = await supabase
        .from("event_members")
        .select("event_id, role")
        .eq("user_id", user.id);

      checks.memberships = memberships ?? [];

      return NextResponse.json(checks, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // Check membership for this event
    const { data: membership, error: memErr } = await supabase
      .from("event_members")
      .select("role")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .single();

    checks.membership = membership
      ? { role: membership.role }
      : `NO MEMBERSHIP: ${memErr?.message ?? "not a member of this event"}`;

    // Count vehicles in this event (through RLS)
    const { count, error: countErr } = await supabase
      .from("vehicle_inventory")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);

    checks.vehicle_count = count ?? 0;
    checks.vehicle_count_error = countErr?.message ?? null;

    // Get first 5 vehicles for inspection
    const { data: sample, error: sampleErr } = await supabase
      .from("vehicle_inventory")
      .select("id, event_id, stock_number, year, make, model, status, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(5);

    checks.sample_vehicles = sample ?? [];
    checks.sample_error = sampleErr?.message ?? null;

    // Check the event itself exists
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, name, dealer_name, status")
      .eq("id", eventId)
      .single();

    checks.event = event ?? null;
    checks.event_error = eventErr?.message ?? null;
  } catch (err) {
    checks.crash = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(checks, {
    headers: { "Cache-Control": "no-store" },
  });
}
