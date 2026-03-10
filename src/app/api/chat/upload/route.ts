// CRUZE FILE ATTACHMENT — FINAL BULLETPROOF VERSION WITH SUPABASE STORAGE FALLBACK
// File upload endpoint for drag & drop chat attachments.
// When an XLSX is detected, auto-scans for JDE standardized sheets
// and returns a structured preview with import-ready metadata.
//
// RELIABILITY:
// 1. Validates file buffer is non-empty before processing.
// 2. Returns base64Data for ALL binary files so the chat tool can re-read them.
// 3. Uploads EVERY file to Supabase Storage (cruze-temp-files bucket) as a
//    durable fallback. The storageUrl is a tiny string (~120 chars) that can
//    never be "lost" like an 80KB base64 blob across React state resets.

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { scanXLSXForCruze } from "@/lib/cruze/xlsx-import";

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
      console.error("[Cruze Upload] No file in formData");
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // CRUZE FILE RELIABILITY — MARCH 2026
    // Validate file is actually readable and non-empty
    if (file.size === 0) {
      console.error("[Cruze Upload] File has zero bytes:", file.name);
      return NextResponse.json(
        { error: "File is empty (0 bytes). Please try again." },
        { status: 400 },
      );
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

    console.log(`[Cruze Upload] Processing "${fileName}" (${fileSize} bytes, type: ${fileType})`);

    let analysis: Record<string, unknown> = {};
    let textContent = "";
    let base64Data: string | null = null;

    // CRUZE FILE RELIABILITY — MARCH 2026
    // Read the ArrayBuffer ONCE, early, and validate it's non-empty.
    // This catches edge cases where the File reference is stale.
    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch (bufErr) {
      console.error("[Cruze Upload] Failed to read file buffer:", bufErr);
      return NextResponse.json(
        { error: "Failed to read file. The file may have been removed. Please try again." },
        { status: 400 },
      );
    }

    if (arrayBuffer.byteLength === 0) {
      console.error("[Cruze Upload] ArrayBuffer is empty for:", fileName);
      return NextResponse.json(
        { error: "File buffer is empty. Please try dropping the file again." },
        { status: 400 },
      );
    }

    console.log(`[Cruze Upload] Buffer OK: ${arrayBuffer.byteLength} bytes`);

    // Detect file type
    const isExcel =
      fileType.includes("spreadsheet") ||
      fileType.includes("excel") ||
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls");

    if (isExcel) {
      base64Data = Buffer.from(arrayBuffer).toString("base64");

      // Scan for standardized JDE sheets
      try {
        const scanResult = await scanXLSXForCruze(arrayBuffer, fileName);

        analysis = {
          type: "excel",
          fileName,
          fileSize,
          // ⚠️  SAFE IMPORT — scan results are READ-ONLY preview data.
          // Actual import requires explicit user confirmation ("YES, IMPORT NOW")
          // and ALWAYS creates a new event by default.
          isStandardizedSheet: scanResult.isStandardized,
          importReady: scanResult.sheets.length > 0,
          importSafety: "ALWAYS_NEW_EVENT",
          sheets: scanResult.sheets.map((s) => ({
            name: s.name,
            index: s.index,
            detectedType: s.detectedType,
            rowCount: s.rowCount,
            confidenceScore: s.confidenceScore,
            autoReady: s.autoReady,
          })),
          totalRows: scanResult.totalRows,
          summary: scanResult.summary,
        };

        console.log(`[Cruze Upload] XLSX scan: ${scanResult.sheets.length} sheets, ${scanResult.totalRows} rows, standardized: ${scanResult.isStandardized}`);
      } catch (scanErr) {
        console.warn("[Cruze Upload] XLSX scan failed, treating as generic:", scanErr);
        analysis = {
          type: "excel",
          fileName,
          fileSize,
          isStandardizedSheet: false,
          importReady: false,
          note: "Excel file received. Cruze will analyze the contents.",
        };
      }
    } else if (fileType === "text/csv" || fileName.endsWith(".csv")) {
      textContent = new TextDecoder().decode(arrayBuffer);
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
    } else if (fileType === "application/pdf" || fileName.endsWith(".pdf")) {
      base64Data = Buffer.from(arrayBuffer).toString("base64");

      analysis = {
        type: "pdf",
        fileName,
        fileSize,
        note: "PDF file received. Cruze will analyze using vision.",
      };
    } else if (fileType.startsWith("image/")) {
      base64Data = Buffer.from(arrayBuffer).toString("base64");

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

    // CRUZE FILE RELIABILITY — MARCH 2026
    // Validate that base64Data was actually produced for binary files
    if (isExcel && !base64Data) {
      console.error("[Cruze Upload] CRITICAL: base64Data is null for Excel file after processing!");
      // Emergency fallback: re-encode
      base64Data = Buffer.from(arrayBuffer).toString("base64");
    }

    // Store file reference in cruze_file_uploads
    let fileId: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: fileRecord } = await (supabase.from as any)("cruze_file_uploads")
        .insert({
          user_id: user.id,
          conversation_id: conversationId,
          event_id: eventId,
          file_name: fileName,
          file_type: (analysis.type as string) || "unknown",
          file_size: fileSize,
          metadata: analysis,
        })
        .select("id")
        .single();
      fileId = fileRecord?.id || null;
    } catch {
      console.warn("[Cruze Upload] cruze_file_uploads table not available, skipping storage");
    }

    // CRUZE FILE ATTACHMENT — FINAL BULLETPROOF VERSION WITH SUPABASE STORAGE FALLBACK
    // Upload file to Supabase Storage as a durable backup.
    // base64Data can be lost across React state resets; storageUrl is permanent.
    let storageUrl: string | null = null;
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (serviceKey && fileId) {
        const admin = createServiceClient(supabaseUrl, serviceKey);
        const storagePath = `${user.id}/${fileId}/${fileName}`;

        const { error: uploadErr } = await admin.storage
          .from("cruze-temp-files")
          .upload(storagePath, arrayBuffer, {
            contentType: fileType || "application/octet-stream",
            upsert: true,
          });

        if (uploadErr) {
          console.warn("[Cruze Upload] Storage upload failed (non-blocking):", uploadErr.message);
        } else {
          const { data: { publicUrl } } = admin.storage
            .from("cruze-temp-files")
            .getPublicUrl(storagePath);

          storageUrl = publicUrl;

          // Update cruze_file_uploads with storage_path
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from as any)("cruze_file_uploads")
            .update({ storage_path: storagePath })
            .eq("id", fileId);

          console.log(`[Cruze Upload] Storage backup OK: ${storagePath}`);
        }
      } else {
        console.warn("[Cruze Upload] No service key or fileId — skipping storage backup");
      }
    } catch (storageErr) {
      // Non-blocking: storage is a fallback, not a requirement
      console.warn("[Cruze Upload] Storage backup failed (non-blocking):", storageErr);
    }

    const responsePayload = {
      success: true,
      fileId,
      fileName,
      fileType: analysis.type,
      fileSize,
      analysis,
      textContent: textContent || null,
      base64Data: base64Data || null,
      storageUrl: storageUrl || null,
      mimeType: fileType,
    };

    console.log(`[Cruze Upload] Response: success=true, base64Data=${base64Data ? `${Math.round(base64Data.length / 1024)}KB` : "null"}, storageUrl=${storageUrl ? "present" : "null"}, analysis.type=${analysis.type}`);

    return NextResponse.json(responsePayload);
  } catch (err) {
    console.error("[Cruze Upload] Unhandled error:", err);
    return NextResponse.json(
      { error: "Failed to process file. Please try again." },
      { status: 500 },
    );
  }
}
