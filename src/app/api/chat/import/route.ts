// CRUZE SAFE IMPORT ENDPOINT — MARCH 2026
// ⚠️  SAFETY: This endpoint ALWAYS creates a new event for imports.
// It will NEVER write into an existing event unless explicitly requested
// with mode "into_existing" + a valid event UUID.
// Called by the importStandardizedSalesSheet tool after user confirmation.

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { executeXLSXImport } from "@/lib/cruze/xlsx-import";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mode = (formData.get("mode") as string) || "new_event";
    const eventName = formData.get("eventName") as string | null;
    const dealerName = formData.get("dealerName") as string | null;
    const status = (formData.get("status") as string) || "completed";
    const existingEventId = formData.get("existingEventId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!eventName) {
      return NextResponse.json({ error: "Event name is required" }, { status: 400 });
    }

    // ── SAFETY: Validate mode ──
    if (mode !== "new_event" && mode !== "into_existing") {
      return NextResponse.json(
        { error: `Invalid mode: ${mode}. Must be "new_event" or "into_existing".` },
        { status: 400 },
      );
    }

    // ── SAFETY: into_existing requires explicit event ID + membership check ──
    if (mode === "into_existing") {
      if (!existingEventId) {
        return NextResponse.json(
          { error: "into_existing mode requires existingEventId" },
          { status: 400 },
        );
      }

      const { data: membership } = await supabase
        .from("event_members")
        .select("role")
        .eq("event_id", existingEventId)
        .eq("user_id", user.id)
        .single();

      if (!membership || !["owner", "manager"].includes(membership.role)) {
        return NextResponse.json(
          { error: "You need owner or manager access to import into this event" },
          { status: 403 },
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();

    const importOpts = mode === "new_event"
      ? {
          mode: "new_event" as const,
          eventName,
          dealerName: dealerName || undefined,
          status: status as "draft" | "active" | "completed" | "cancelled",
        }
      : {
          mode: "into_existing" as const,
          eventId: existingEventId!,
          eventName,
        };

    const result = await executeXLSXImport(arrayBuffer, file.name, importOpts);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Cruze Import] Error:", err);
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 500 },
    );
  }
}
