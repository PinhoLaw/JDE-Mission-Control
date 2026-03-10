// CRUZE SAFE IMPORT ENDPOINT — MARCH 2026
// ⚠️  Cruze Import v1: ALWAYS creates a new event. No merge/overwrite.
// Called by the importStandardizedSalesSheet tool after user confirmation.

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { executeXLSXImport, validateEventName } from "@/lib/cruze/xlsx-import";

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
    const eventName = formData.get("eventName") as string | null;
    const dealerName = formData.get("dealerName") as string | null;
    const status = (formData.get("status") as string) || "completed";

    // CI-034: Reject any attempt to use into_existing mode
    const mode = formData.get("mode") as string | null;
    if (mode && mode !== "new_event") {
      return NextResponse.json(
        { error: "Cruze Import v1 only supports new event creation. Merging into existing events is not available." },
        { status: 400 },
      );
    }

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!eventName) {
      return NextResponse.json({ error: "Event name is required" }, { status: 400 });
    }

    // CI-009: Validate event name
    const nameCheck = await validateEventName(eventName);
    if (!nameCheck.valid) {
      return NextResponse.json(
        { error: `Invalid event name: ${nameCheck.error}` },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    const importOpts = {
      mode: "new_event" as const,
      eventName: eventName.trim(),
      dealerName: dealerName || undefined,
      status: status as "draft" | "active" | "completed" | "cancelled",
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
