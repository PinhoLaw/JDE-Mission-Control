# Cruze Import v1 — Go/No-Go Summary

**Version:** 1.1
**Date:** 2026-03-10

---

## A. Blocking Tests for Internal Release

These **24 tests** must pass before Cruze Import v1 can be considered dependable for internal use. Failure on any of these means the import workflow has a safety, correctness, or access-control gap.

### Safety gates (can't ship without these)
| ID | Title | Why it blocks |
|----|-------|---------------|
| IMP-001 | Valid standardized XLSX upload | Core upload path must work |
| IMP-003 | Event name collection | Name must flow through correctly |
| IMP-004 | Preview generation | User must see what they're importing |
| IMP-005 | Hard confirmation works | The import itself must execute |
| IMP-008 | Missing required sheet | Invalid files must not slip through |
| IMP-016 | Loose confirmation rejected ("yes") | Confirmation must be exact |
| IMP-017 | Partial confirmation rejected ("confirm") | Confirmation must be exact |
| IMP-018 | Wrong-case rejected ("confirm import") | Case sensitivity enforced |
| IMP-019 | Exact confirmation accepted | Correct phrase must work |
| IMP-021 | Same-upload double confirm blocked | Duplicate protection active |
| IMP-025 | New event only | No merge/overwrite path exists |
| IMP-026 | Required sections imported | Data lands in correct tables |
| IMP-031 | Unauthenticated upload blocked | No anonymous access |
| IMP-032 | Unauthenticated import blocked | No anonymous access |
| IMP-033 | Authenticated user allowed | Legit users can import |
| IMP-038 | Build/type safety | Code compiles and deploys |

### Important integrity checks
| ID | Title | Why it blocks |
|----|-------|---------------|
| IMP-006 | Random XLSX rejected | Non-standard files must not import |
| IMP-009 | Header mismatch rejected | Bad headers must be caught |
| IMP-011 | Blank event name rejected | Name validation enforced |
| IMP-012 | Whitespace-only name rejected | Name validation enforced |
| IMP-020 | Confirmation without file blocked | No phantom imports |
| IMP-022 | Same file re-uploaded dedup | Hash-level protection works |
| IMP-027 | Defaults initialized | New event has correct config |
| IMP-029 | Failure cleanup | No orphaned events on crash |

---

## B. Non-Blocking but Recommended

These **16 tests** can be deferred briefly if the core blocking tests all pass. They cover edge cases, UX polish, and operational resilience that improve confidence but don't represent safety gaps.

### Edge cases (defer 1-2 days max)
| ID | Title | Risk if deferred |
|----|-------|-----------------|
| IMP-002 | CSV upload behavior | Low — CSV import not supported in v1 anyway |
| IMP-007 | Random CSV rejected | Low — importReady gate covers this |
| IMP-010 | Corrupted workbook | Low — scan failure fallback exists |
| IMP-013 | Too-long event name | Low — unlikely in practice |
| IMP-014 | Invalid characters | Low — unlikely in practice |
| IMP-015 | Valid historical name | Low — happy path covers basics |
| IMP-023 | Similar but different file | Low — only affects dedup edge case |
| IMP-024 | Dedup storage unavailable | Low — graceful degradation by design |
| IMP-028 | Zero-row section | Low — edge case, no data loss risk |
| IMP-030 | Verification mismatch | Low — hard to trigger, flagging works |

### UX and operational (defer up to 1 week)
| ID | Title | Risk if deferred |
|----|-------|-----------------|
| IMP-034 | Invalid file guidance | UX only — error is still returned |
| IMP-035 | Preview readability | UX only — data is structured |
| IMP-036 | Success response quality | UX only — import still works |
| IMP-037 | Duplicate block messaging | UX only — block still works |
| IMP-039 | Large workbook performance | Operational — rare in practice |
| IMP-040 | Service dependency failure | Operational — env config issue |

---

## C. Suggested Execution Order

Run categories in this order for highest-value-first testing:

| Priority | Category | Tests | Rationale |
|----------|----------|-------|-----------|
| 1 | **Operational** | IMP-038 | Run build first — if it doesn't compile, nothing else matters |
| 2 | **Auth / Permissions** | IMP-031, IMP-032, IMP-033 | If auth is broken, all other tests are invalid |
| 3 | **Happy Path** | IMP-001 through IMP-005 | Confirm the core flow works end-to-end |
| 4 | **Confirmation Enforcement** | IMP-016 through IMP-020 | Confirm the primary safety gate holds |
| 5 | **Invalid File Handling** | IMP-006 through IMP-010 | Confirm bad files are caught |
| 6 | **Event Name Validation** | IMP-011 through IMP-015 | Confirm name validation is enforced |
| 7 | **Duplicate / Replay** | IMP-021 through IMP-024 | Confirm dedup protection works |
| 8 | **Execution / Data Integrity** | IMP-025 through IMP-030 | Confirm data lands correctly |
| 9 | **UX / Messaging** | IMP-034 through IMP-037 | Confirm messages are clear |
| 10 | **Operational (extended)** | IMP-039, IMP-040 | Performance and failure resilience |

### Minimum viable test run (15 minutes)

If time is extremely limited, run these 10 tests in order:

1. IMP-038 — Build passes
2. IMP-033 — Authenticated user can import
3. IMP-001 — Valid XLSX uploads correctly
4. IMP-005 — CONFIRM IMPORT works
5. IMP-016 — "yes" is rejected
6. IMP-008 — Missing sheet is caught
7. IMP-011 — Blank name rejected
8. IMP-021 — Double confirm blocked
9. IMP-025 — No existing-event path
10. IMP-026 — Data lands in correct tables

This covers every critical safety surface in under 15 minutes.
