# Cruze Import v1 Manual QA Checklist

**Version:** 1.1
**Date:** 2026-03-10
**Scope:** Cruze Import v1 — standardized XLSX/CSV import via chat tool and REST endpoint
**Confirmation phrase:** `CONFIRM IMPORT` (exact, case-sensitive)
**Mode:** New event only (no merge/overwrite)

---

## How to use this checklist

1. Run tests in the suggested category order (see Go/No-Go section at bottom).
2. Mark each test `[x]` for pass or note the failure.
3. All **Critical** and **High** severity tests must pass for internal release.
4. Use a real Supabase-connected environment (local or staging) — not mocked.

---

## Happy Path

- [ ] **IMP-001** — Valid standardized XLSX upload
  - **Severity:** Critical
  - **Setup:** Prepare a valid JDE standardized `.xlsx` file containing all 5 required sheets: Deals, Inventory, Roster, Campaigns, Lenders. Each sheet must have correct headers and at least 1 data row.
  - **Action:** Open the chat panel. Drag and drop the file into the chat window.
  - **Expected:** Upload succeeds. Response includes `importReady: true`, `validationPassed: true`, `missingSections: []`, `fileHash` (64-char hex string). All 5 sheets appear in `analysis.sheets` with `autoReady: true` and `confidenceScore >= 80`.
  - **Notes:**

- [ ] **IMP-002** — Valid standardized CSV upload
  - **Severity:** Medium
  - **Setup:** Prepare a `.csv` file with headers matching one of the 5 section types (e.g., deals with `customer_name`, `stock_number` columns).
  - **Action:** Drag and drop the CSV into the chat window.
  - **Expected:** Upload succeeds with `analysis.type: "csv"`. Headers and row count are returned. File is stored in `cruze_file_uploads`. Note: CSV does not trigger the standardized XLSX scan pipeline — `importReady` and `validationPassed` will NOT be set. CSV import via the chat tool is not supported in v1 (XLSX only).
  - **Notes:**

- [ ] **IMP-003** — Event name collection
  - **Severity:** Critical
  - **Setup:** Upload a valid standardized XLSX file. Chat with Cruze about importing it.
  - **Action:** When Cruze asks for an event name, provide a valid name like "Lilliston CDJR March 2026".
  - **Expected:** Cruze accepts the name, includes it in the preview, and proceeds to ask for `CONFIRM IMPORT`. The name should appear in the preview as the target event name.
  - **Notes:**

- [ ] **IMP-004** — Preview generation
  - **Severity:** Critical
  - **Setup:** Upload a valid standardized XLSX. Begin import flow.
  - **Action:** Observe the preview Cruze generates before asking for confirmation.
  - **Expected:** Preview includes: (1) a table or list showing each section name, detected type, row count, and confidence score; (2) the proposed event name; (3) total row count; (4) the exact prompt to type `CONFIRM IMPORT`. The tool's structured `preview` object should contain `sections[]` with `name`, `type`, `rows`, `confidence`, `ready` for each sheet.
  - **Notes:**

- [ ] **IMP-005** — Hard confirmation works
  - **Severity:** Critical
  - **Setup:** Complete preview step with a valid file and valid event name.
  - **Action:** Type exactly `CONFIRM IMPORT` in the chat.
  - **Expected:** Import executes. A new event is created in Supabase. Data is imported into all 5 section tables. Cruze reports the new event name, event ID, and section counts. The `verified` object shows `allMatch: true`. The `cruze_file_uploads` record is updated with `importedAt`, `importedEventId`, `importedEventName` in metadata. Dashboard paths are revalidated.
  - **Notes:**

---

## Invalid File Handling

- [ ] **IMP-006** — Random XLSX rejected
  - **Severity:** High
  - **Setup:** Prepare a `.xlsx` file that is NOT a JDE standardized sheet (e.g., a generic budget spreadsheet with unrelated columns).
  - **Action:** Upload the file via chat drag-and-drop. Ask Cruze to import it.
  - **Expected:** Upload succeeds but `importReady` may be `true` if at least one sheet is detected. However, `validationPassed` should be `false` because not all 5 required section types are present. If the user attempts to confirm import, the tool should reject with the missing sections error: "This file is missing required sections: [list]."
  - **Notes:**

- [ ] **IMP-007** — Random CSV rejected
  - **Severity:** Medium
  - **Setup:** Prepare a generic `.csv` (e.g., expense report) with no JDE-relevant headers.
  - **Action:** Upload via chat. Ask Cruze to import it.
  - **Expected:** Upload succeeds with `type: "csv"`. The chat tool's import function requires `importReady` from the XLSX scan — since CSV doesn't go through `scanXLSXForCruze()`, `importReady` is not set. The tool should reject at the "doesn't appear to be a standardized JDE sales sheet" gate.
  - **Notes:**

- [ ] **IMP-008** — Missing required sheet
  - **Severity:** Critical
  - **Setup:** Prepare a `.xlsx` with only 3 of the 5 required sheets (e.g., Deals, Inventory, Roster — missing Campaigns and Lenders).
  - **Action:** Upload and attempt import.
  - **Expected:** `validationPassed: false`. `missingSections` contains `["campaigns", "lenders"]`. Import tool blocks with: "This file is missing required sections: campaigns, lenders. A standardized JDE sheet must contain all 5 sections."
  - **Notes:**

- [ ] **IMP-009** — Header mismatch
  - **Severity:** High
  - **Setup:** Prepare a `.xlsx` with all 5 sheets present by name, but one sheet (e.g., Deals) has scrambled/incorrect column headers that don't map to expected fields.
  - **Action:** Upload and attempt import.
  - **Expected:** The mismatched sheet gets `autoReady: false` and `confidenceScore < 80`. `headerIssues` contains an entry for that section. `validationPassed: false`. Import is blocked.
  - **Notes:**

- [ ] **IMP-010** — Corrupted workbook
  - **Severity:** Medium
  - **Setup:** Take a valid `.xlsx` and corrupt it (e.g., truncate the file, rename a `.txt` to `.xlsx`).
  - **Action:** Upload via chat.
  - **Expected:** The `scanXLSXForCruze()` call fails. Upload response falls back to `isStandardizedSheet: false`, `importReady: false`. The file is stored but cannot be imported. Cruze should inform the user that the file couldn't be analyzed.
  - **Notes:**

---

## Event Name Validation

- [ ] **IMP-011** — Blank event name
  - **Severity:** High
  - **Setup:** Upload a valid standardized XLSX. Proceed to confirmation.
  - **Action:** Call the import tool with `eventName: ""`.
  - **Expected:** `validateEventName("")` returns `{ valid: false, error: "Event name cannot be empty." }`. Tool returns error: "Invalid event name: Event name cannot be empty."
  - **Notes:**

- [ ] **IMP-012** — Whitespace-only event name
  - **Severity:** High
  - **Setup:** Same as IMP-011.
  - **Action:** Call the import tool with `eventName: "   "` (spaces only).
  - **Expected:** `validateEventName("   ")` trims to `""`, returns same error as blank. Tool returns: "Invalid event name: Event name cannot be empty."
  - **Notes:**

- [ ] **IMP-013** — Too-long event name
  - **Severity:** Medium
  - **Setup:** Same as IMP-011.
  - **Action:** Call the import tool with `eventName` set to a 150-character string.
  - **Expected:** `validateEventName()` returns `{ valid: false, error: "Event name too long (max 100 chars)." }`. Tool rejects.
  - **Notes:**

- [ ] **IMP-014** — Invalid characters in event name
  - **Severity:** Medium
  - **Setup:** Same as IMP-011.
  - **Action:** Call the import tool with `eventName: "Test <Event> 2026"`.
  - **Expected:** Regex `[<>{}|\\^`]` matches `<` and `>`. Returns: "Invalid event name: Event name contains invalid characters." Also test with `{`, `}`, `|`, `\`, `^`, `` ` ``.
  - **Notes:**

- [ ] **IMP-015** — Valid historical event name
  - **Severity:** Low
  - **Setup:** Same as IMP-011.
  - **Action:** Call import tool with `eventName: "Lilliston CDJR March 2026"`.
  - **Expected:** Name passes validation. The trimmed name is stored as the event name in Supabase. Event is created successfully with this exact name.
  - **Notes:**

---

## Confirmation Enforcement

- [ ] **IMP-016** — Loose confirmation rejected (`yes`)
  - **Severity:** Critical
  - **Setup:** Complete preview with valid file and event name.
  - **Action:** Type `yes` in chat (or call tool with `confirmed: "yes"`).
  - **Expected:** Tool returns `needsConfirmation: true` with structured preview. Import does NOT execute. No event created. Message says user must type exactly `CONFIRM IMPORT`.
  - **Notes:**

- [ ] **IMP-017** — Partial confirmation rejected (`confirm`)
  - **Severity:** Critical
  - **Setup:** Same as IMP-016.
  - **Action:** Type `confirm` or call tool with `confirmed: "confirm"`.
  - **Expected:** Same as IMP-016 — rejected with `needsConfirmation: true`.
  - **Notes:**

- [ ] **IMP-018** — Wrong-case confirmation rejected (`confirm import`)
  - **Severity:** Critical
  - **Setup:** Same as IMP-016.
  - **Action:** Type `confirm import` (lowercase) in chat.
  - **Expected:** Comparison is `!== "CONFIRM IMPORT"` (case-sensitive). Lowercase version is rejected. Returns `needsConfirmation: true`.
  - **Notes:**

- [ ] **IMP-019** — Exact confirmation accepted (`CONFIRM IMPORT`)
  - **Severity:** Critical
  - **Setup:** Same as IMP-016.
  - **Action:** Type exactly `CONFIRM IMPORT` in chat.
  - **Expected:** Tool proceeds past Gate 1. Import executes (assuming all other gates pass). New event created.
  - **Notes:**

- [ ] **IMP-020** — Confirmation without active file attachment
  - **Severity:** High
  - **Setup:** Open a fresh chat session with NO file uploaded.
  - **Action:** Type `CONFIRM IMPORT` directly (or Cruze attempts to call the tool without a file).
  - **Expected:** Tool hits Gate 3: "No file attachment found. Ask the user to drop the XLSX file again." No event created.
  - **Notes:**

---

## Duplicate / Replay Protection

- [ ] **IMP-021** — Same-upload double confirmation
  - **Severity:** Critical
  - **Setup:** Complete a full successful import using IMP-005. Keep the same chat session open with the same file attachment.
  - **Action:** Type `CONFIRM IMPORT` again in the same session.
  - **Expected:** The tool queries `cruze_file_uploads` by `fileId`, finds `metadata.importedAt` is set from the first import. Returns error: "This file was already imported as '[event name]' (event [id]). To re-import, please drop the file into the chat again to create a fresh upload." No second event created.
  - **Notes:**

- [ ] **IMP-022** — Same file re-uploaded then confirmed
  - **Severity:** High
  - **Setup:** After IMP-021, drag and drop the exact same `.xlsx` file into chat again. This creates a new upload with a new `fileId` but the same `fileHash`.
  - **Action:** Proceed through the import flow and type `CONFIRM IMPORT`.
  - **Expected:** The hash-based dedup check finds a different `cruze_file_uploads` record with matching `metadata->>fileHash` that has `importedAt` set. Returns error: "This exact file was already imported as '[name]' (event [id])." with `duplicateOf` object. No second event created.
  - **Notes:**

- [ ] **IMP-023** — Similar but not identical file
  - **Severity:** Medium
  - **Setup:** After a successful import, modify the original `.xlsx` slightly (e.g., change one cell value, add a row) and save as a new file.
  - **Action:** Upload the modified file and proceed through import.
  - **Expected:** The SHA-256 hash will differ from the original because the content changed. Both same-upload and hash-based dedup checks pass (no match found). Import proceeds normally, creating a new event.
  - **Notes:**

- [ ] **IMP-024** — Dedup storage unavailable
  - **Severity:** Low
  - **Setup:** Simulate `cruze_file_uploads` table being unreachable (e.g., RLS blocking access, or table doesn't exist in the schema).
  - **Action:** Upload a file and attempt import.
  - **Expected:** Both dedup checks are wrapped in `try/catch` with empty catch blocks (non-blocking). If the table is unreachable, dedup is silently skipped. Import proceeds normally. This is graceful degradation — not a blocker.
  - **Notes:**

---

## Execution / Data Integrity

- [ ] **IMP-025** — New event only (no existing-event path)
  - **Severity:** Critical
  - **Setup:** Review the import tool schema in route.ts and the `/api/chat/import` endpoint.
  - **Action:** (1) Verify the tool schema has no `mode` or `existingEventId` parameter. (2) POST to `/api/chat/import` with `mode=into_existing&existingEventId=[uuid]`.
  - **Expected:** (1) Tool schema only has: `confirmed`, `eventName`, `dealerName`, `status`, `city`, `state`. (2) REST endpoint returns 400: "Cruze Import v1 only supports new event creation. Merging into existing events is not available." (3) `executeXLSXImport()` only accepts `mode: "new_event"` in its type signature.
  - **Notes:**

- [ ] **IMP-026** — Required sections imported
  - **Severity:** Critical
  - **Setup:** Complete a successful import with a valid standardized XLSX.
  - **Action:** Query Supabase tables for the new event ID: `sales_deals`, `vehicle_inventory`, `roster`, `mail_tracking`, `lenders`.
  - **Expected:** Each table has rows matching the counts reported in the import result. Counts match the `verified` object. `allMatch: true`.
  - **Notes:**

- [ ] **IMP-027** — Defaults initialized correctly
  - **Severity:** High
  - **Setup:** Complete a successful import (new event).
  - **Action:** Query `event_config` for the new event ID.
  - **Expected:** A row exists with defaults: `doc_fee: 0`, `pack_new: 0`, `pack_used: 0`, `tax_rate: 0`, `include_doc_fee_in_commission: false`, `rep_commission_pct: 0.25`, `jde_commission_pct: 0.25`.
  - **Notes:**

- [ ] **IMP-028** — Zero-row section behavior
  - **Severity:** Medium
  - **Setup:** Prepare a standardized XLSX where one section (e.g., Lenders) has correct headers but zero data rows.
  - **Action:** Upload and import.
  - **Expected:** Sheet is detected and passes confidence check (if headers are correct, `autoReady` may still be `true`). Import processes the sheet but inserts 0 rows. The verified count for that section is 0. `allMatch` should still be `true` (0 === 0). Import succeeds overall.
  - **Notes:**

- [ ] **IMP-029** — Import failure mid-run (cleanup)
  - **Severity:** High
  - **Setup:** Simulate a fatal error during import (e.g., Supabase service key missing, network failure during `executeImport()`).
  - **Action:** Trigger the fatal error path.
  - **Expected:** The `catch` block deletes the newly created event via cascade delete (`admin.from("events").delete().eq("id", eventId)`). No orphaned event remains. The tool returns: "Import failed: [error message]".
  - **Notes:**

- [ ] **IMP-030** — Verification mismatch
  - **Severity:** Medium
  - **Setup:** This is difficult to reproduce directly. May require: (1) inserting extra rows into a table during import via a DB trigger, or (2) mocking the verification query to return mismatched counts.
  - **Action:** Complete an import where verified counts don't match expected counts.
  - **Expected:** `verified.allMatch: false`. The error array includes: "Verification: expected counts differ from DB — imported X deals but found Y". The success message includes: "Verification mismatch detected — check counts." The `success` field is `false` if any errors exist.
  - **Notes:**

---

## Authentication / Permissions

- [ ] **IMP-031** — Unauthenticated upload blocked
  - **Severity:** Critical
  - **Setup:** Make a request to `/api/chat/upload` without valid auth cookies/session.
  - **Action:** POST a file to the upload endpoint without authentication.
  - **Expected:** Response: 401 `{ error: "Not authenticated" }`. No file stored.
  - **Notes:**

- [ ] **IMP-032** — Unauthenticated import confirm blocked
  - **Severity:** Critical
  - **Setup:** Make a request to `/api/chat/import` without valid auth cookies/session.
  - **Action:** POST import form data without authentication.
  - **Expected:** Response: 401 `{ error: "Not authenticated" }`. No event created.
  - **Notes:**

- [ ] **IMP-033** — Authenticated user import allowed
  - **Severity:** Critical
  - **Setup:** Log in as a valid user via Supabase Auth (magic link or test credentials).
  - **Action:** Complete the full upload → preview → confirm → import flow.
  - **Expected:** All endpoints accept the authenticated session. Import creates a new event. The user is added as `owner` of the new event via `event_members` insert.
  - **Notes:**

---

## UX / Messaging

- [ ] **IMP-034** — Invalid file guidance is actionable
  - **Severity:** Medium
  - **Setup:** Upload a non-standardized XLSX (missing sheets).
  - **Action:** Attempt import and observe the error message.
  - **Expected:** Error message lists the specific missing sections by name (e.g., "campaigns, lenders"). Message explains: "A standardized JDE sheet must contain all 5 sections: deals, inventory, roster, campaigns, and lenders. Please re-export the file with all sections included." User knows exactly what to fix.
  - **Notes:**

- [ ] **IMP-035** — Preview is readable
  - **Severity:** Medium
  - **Setup:** Upload a valid standardized XLSX and begin import flow.
  - **Action:** Review the preview Cruze generates.
  - **Expected:** Preview shows: (1) each section with name, type, row count, confidence; (2) total rows; (3) proposed event name; (4) clear instruction to type `CONFIRM IMPORT`. The structured `preview` object in the tool response includes all fields. The AI renders it as a readable table or list.
  - **Notes:**

- [ ] **IMP-036** — Success response is actionable
  - **Severity:** Medium
  - **Setup:** Complete a successful import.
  - **Action:** Review the success message Cruze displays.
  - **Expected:** Message includes: new event name, section counts (e.g., "47 deals, 120 vehicles, 8 roster members, 50 campaign rows, 5 lenders"), total gross if available, and guidance to navigate to the new event. If verification passed, no warning. If verification had issues, includes mismatch warning.
  - **Notes:**

- [ ] **IMP-037** — Duplicate block is understandable
  - **Severity:** Medium
  - **Setup:** Complete a successful import, then attempt to import the same file again.
  - **Action:** Observe the duplicate-block error message.
  - **Expected:** Message names the event the file was already imported into (event name and ID). Tells the user: "To re-import, please drop the file into the chat again to create a fresh upload." Clear, not cryptic. User knows the block is intentional and how to proceed if they really need to re-import.
  - **Notes:**

---

## Operational Checks

- [ ] **IMP-038** — Build/type safety
  - **Severity:** Critical
  - **Setup:** Clean working directory.
  - **Action:** Run `npx tsc --noEmit` and `npx next build`.
  - **Expected:** Both pass with 0 errors. No type regressions from import changes.
  - **Notes:**

- [ ] **IMP-039** — Large valid workbook
  - **Severity:** Medium
  - **Setup:** Prepare a valid standardized XLSX with 500+ rows per section (2500+ total rows).
  - **Action:** Upload and complete the full import flow.
  - **Expected:** Upload completes within reasonable time (< 30s for upload, < 60s for import). File size under 20MB limit. All rows imported. Verified counts match. No timeout errors.
  - **Notes:**

- [ ] **IMP-040** — Service dependency failure
  - **Severity:** Medium
  - **Setup:** Remove or invalidate `SUPABASE_SERVICE_ROLE_KEY` from environment.
  - **Action:** Attempt a full import.
  - **Expected:** `createEventForImport()` throws: "Missing service role key". Import fails cleanly with an error message. No partial data written. No orphaned state.
  - **Notes:**

---

## Test Summary

| Category | Tests | Critical | High | Medium | Low |
|----------|-------|----------|------|--------|-----|
| Happy Path | 5 | 4 | 0 | 1 | 0 |
| Invalid File | 5 | 1 | 2 | 2 | 0 |
| Event Name | 5 | 0 | 2 | 2 | 1 |
| Confirmation | 5 | 4 | 1 | 0 | 0 |
| Duplicate/Replay | 4 | 1 | 1 | 1 | 1 |
| Execution/Data | 6 | 2 | 2 | 2 | 0 |
| Auth/Permissions | 3 | 3 | 0 | 0 | 0 |
| UX/Messaging | 4 | 0 | 0 | 4 | 0 |
| Operational | 3 | 1 | 0 | 2 | 0 |
| **Total** | **40** | **16** | **8** | **14** | **2** |
