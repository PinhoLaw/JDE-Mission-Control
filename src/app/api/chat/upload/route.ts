// CRUZE UPGRADE — OMNISCIENT MODE
// File upload endpoint for drag & drop chat attachments
// Accepts CSV, Excel, PDF, and images — returns parsed preview data

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

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
    const conversationId = formData.get("conversationId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max size: ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 },
      );
    }

    const fileName = file.name;
    const fileType = file.type;
    const fileSize = file.size;

    let analysis: Record<string, unknown> = {};
    let textContent = "";
    let base64Data: string | null = null;

    // Parse based on file type
    if (fileType === "text/csv" || fileName.endsWith(".csv")) {
      textContent = await file.text();
      const lines = textContent.split("\n").filter((l) => l.trim());
      const headers = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, "")) || [];
      const rowCount = lines.length - 1;
      const preview = lines.slice(0, 11).join("\n");

      analysis = {
        type: "csv",
        headers,
        rowCount,
        preview,
        columnCount: headers.length,
      };
    } else if (
      fileType.includes("spreadsheet") ||
      fileType.includes("excel") ||
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls")
    ) {
      const buffer = await file.arrayBuffer();
      base64Data = Buffer.from(buffer).toString("base64");

      analysis = {
        type: "excel",
        fileName,
        fileSize,
        note: "Excel file received. Cruze will analyze the contents.",
      };
    } else if (fileType === "application/pdf" || fileName.endsWith(".pdf")) {
      const buffer = await file.arrayBuffer();
      base64Data = Buffer.from(buffer).toString("base64");

      analysis = {
        type: "pdf",
        fileName,
        fileSize,
        note: "PDF file received. Cruze will analyze using vision.",
      };
    } else if (fileType.startsWith("image/")) {
      const buffer = await file.arrayBuffer();
      base64Data = Buffer.from(buffer).toString("base64");

      analysis = {
        type: "image",
        fileName,
        fileSize,
        mimeType: fileType,
      };
    } else {
      return NextResponse.json(
        { error: `Unsupported file type: ${fileType || fileName.split(".").pop()}` },
        { status: 400 },
      );
    }

    // Store file reference in database (cruze_file_uploads table)
    // Uses `as never` cast since the table types aren't regenerated yet
    let fileId: string | null = null;
    try {
      const { data: fileRecord } = await (supabase.from as Function)("cruze_file_uploads")
        .insert({
          user_id: user.id,
          conversation_id: conversationId,
          event_id: eventId,
          file_name: fileName,
          file_type: analysis.type as string,
          file_size: fileSize,
          metadata: analysis,
        })
        .select("id")
        .single();
      fileId = fileRecord?.id || null;
    } catch {
      // Table may not exist yet if migration hasn't run — continue without storing
      console.warn("[Cruze Upload] cruze_file_uploads table not available, skipping storage");
    }

    return NextResponse.json({
      success: true,
      fileId,
      fileName,
      fileType: analysis.type,
      fileSize,
      analysis,
      textContent: textContent || null,
      base64Data: base64Data || null,
      mimeType: fileType,
    });
  } catch (err) {
    console.error("[Cruze Upload] Error:", err);
    return NextResponse.json(
      { error: "Failed to process file" },
      { status: 500 },
    );
  }
}
