// CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026
// Executes the actual import after user confirmation via Cruze chat.
// Called by the importStandardizedSalesSheet tool.

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
    const eventId = formData.get("eventId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!eventId) {
      return NextResponse.json({ error: "No event selected" }, { status: 400 });
    }

    // Verify user has access to this event
    const { data: membership } = await supabase
      .from("event_members")
      .select("role")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .single();

    if (!membership || !["owner", "manager"].includes(membership.role)) {
      return NextResponse.json(
        { error: "You need owner or manager access to import data" },
        { status: 403 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await executeXLSXImport(arrayBuffer, file.name, eventId);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[Cruze Import] Error:", err);
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 500 },
    );
  }
}
