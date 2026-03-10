// CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026
// Historical knowledge backfill: scans all existing events and extracts
// key insights into cruze_memories for cross-session recall.
//
// Called automatically on first chat after upgrade (checks a flag),
// or manually via the backfillCruzeMemories() function.

import { SupabaseClient } from "@supabase/supabase-js";
import { saveMemory } from "./memory";

// ─── Backfill Check ─────────────────────────────────────────────────────────

/**
 * Check if backfill has already run for this user.
 * Uses a special memory entry as a flag.
 */
export async function hasBackfillRun(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from as any)("cruze_memories")
    .select("id")
    .eq("user_id", userId)
    .eq("content", "__BACKFILL_COMPLETE_V1__")
    .limit(1);

  return data && data.length > 0;
}

/**
 * Mark backfill as complete for this user.
 */
async function markBackfillComplete(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from as any)("cruze_memories").insert({
    user_id: userId,
    content: "__BACKFILL_COMPLETE_V1__",
    category: "general",
    importance: 1,
  });
}

// ─── Main Backfill Function ─────────────────────────────────────────────────

/**
 * Scan all events the user has access to and extract key insights
 * into cruze_memories. Runs once per user.
 */
export async function backfillCruzeMemories(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ memoriesCreated: number; eventsScanned: number }> {
  let memoriesCreated = 0;
  let eventsScanned = 0;

  try {
    // Get all events the user is a member of
    const { data: memberships } = await supabase
      .from("event_members")
      .select("event_id")
      .eq("user_id", userId);

    if (!memberships || memberships.length === 0) {
      await markBackfillComplete(supabase, userId);
      return { memoriesCreated: 0, eventsScanned: 0 };
    }

    const eventIds = memberships.map((m) => m.event_id);

    // Fetch all events with their data
    for (const eventId of eventIds) {
      try {
        const [eventRes, dealsRes, inventoryRes, rosterRes, configRes, metricsRes] = await Promise.all([
          supabase.from("events").select("name, dealer_name, city, state, sale_days, status, start_date, end_date").eq("id", eventId).single(),
          supabase.from("sales_deals").select("salesperson, front_gross, back_gross, total_gross, status, new_used, warranty, gap, fi_total, sale_day").eq("event_id", eventId),
          supabase.from("vehicle_inventory").select("status, acquisition_cost").eq("event_id", eventId),
          supabase.from("roster").select("name, role, active").eq("event_id", eventId),
          supabase.from("event_config").select("doc_fee, pack_new, pack_used, pack, target_units, target_gross").eq("event_id", eventId).maybeSingle(),
          supabase.from("daily_metrics").select("sale_day, total_ups, total_sold, total_gross").eq("event_id", eventId).order("sale_day", { ascending: true }),
        ]);

        const event = eventRes.data;
        const deals = dealsRes.data || [];
        const vehicles = inventoryRes.data || [];
        const roster = rosterRes.data || [];
        const config = configRes.data;
        const metrics = metricsRes.data || [];

        if (!event || deals.length === 0) continue;
        eventsScanned++;

        // ── Extract insights ──────────────────────────────────

        const totalGross = deals.reduce((s, d) => s + (d.total_gross || 0), 0);
        const totalDeals = deals.filter((d) => d.status !== "cancelled" && d.status !== "unwound").length;
        const avgPvr = totalDeals > 0 ? Math.round(totalGross / totalDeals) : 0;

        // 1. Event overview
        await saveMemory(supabase, userId, eventId,
          `${event.name} at ${event.dealer_name} (${event.city}, ${event.state}): ${totalDeals} deals, $${totalGross.toLocaleString()} total gross, $${avgPvr.toLocaleString()} avg PVR`,
          "fact", 8,
        );
        memoriesCreated++;

        // 2. Inventory stats
        if (vehicles.length > 0) {
          const available = vehicles.filter((v) => v.status === "available").length;
          const sold = vehicles.filter((v) => v.status === "sold").length;
          await saveMemory(supabase, userId, eventId,
            `${event.name} inventory: ${vehicles.length} total vehicles, ${sold} sold, ${available} remaining`,
            "fact", 6,
          );
          memoriesCreated++;
        }

        // 3. Top salesperson
        const spMap: Record<string, { deals: number; gross: number }> = {};
        deals.forEach((d) => {
          const sp = d.salesperson || "Unknown";
          if (!spMap[sp]) spMap[sp] = { deals: 0, gross: 0 };
          spMap[sp].deals++;
          spMap[sp].gross += d.total_gross || 0;
        });
        const topSP = Object.entries(spMap).sort((a, b) => b[1].gross - a[1].gross)[0];
        if (topSP) {
          await saveMemory(supabase, userId, eventId,
            `Top performer at ${event.name}: ${topSP[0]} with ${topSP[1].deals} deals and $${topSP[1].gross.toLocaleString()} gross`,
            "insight", 7,
          );
          memoriesCreated++;
        }

        // 4. FI penetration
        const warrantyCount = deals.filter((d) => (d.warranty || 0) > 0).length;
        const gapCount = deals.filter((d) => (d.gap || 0) > 0).length;
        if (totalDeals > 5) {
          await saveMemory(supabase, userId, eventId,
            `${event.name} FI: warranty ${Math.round((warrantyCount / totalDeals) * 100)}%, GAP ${Math.round((gapCount / totalDeals) * 100)}% penetration`,
            "insight", 6,
          );
          memoriesCreated++;
        }

        // 5. New vs Used mix
        const newCount = deals.filter((d) => d.new_used === "New").length;
        const usedCount = deals.filter((d) => d.new_used === "Used").length;
        if (totalDeals > 0) {
          await saveMemory(supabase, userId, eventId,
            `${event.name} mix: ${newCount} new (${Math.round((newCount / totalDeals) * 100)}%), ${usedCount} used (${Math.round((usedCount / totalDeals) * 100)}%)`,
            "fact", 5,
          );
          memoriesCreated++;
        }

        // 6. Daily metrics trend (if available)
        if (metrics.length >= 3) {
          const totalUps = metrics.reduce((s, m) => s + (m.total_ups || 0), 0);
          const totalSold = metrics.reduce((s, m) => s + (m.total_sold || 0), 0);
          const closeRate = totalUps > 0 ? ((totalSold / totalUps) * 100).toFixed(1) : "0";
          await saveMemory(supabase, userId, eventId,
            `${event.name} traffic: ${totalUps} total ups across ${metrics.length} days, ${closeRate}% close rate`,
            "insight", 6,
          );
          memoriesCreated++;
        }

        // 7. Target performance (if targets set)
        if (config?.target_units || config?.target_gross) {
          const unitPct = config.target_units ? Math.round((totalDeals / config.target_units) * 100) : null;
          const grossPct = config.target_gross ? Math.round((totalGross / Number(config.target_gross)) * 100) : null;
          const parts: string[] = [];
          if (unitPct !== null) parts.push(`${unitPct}% of unit target (${totalDeals}/${config.target_units})`);
          if (grossPct !== null) parts.push(`${grossPct}% of gross target ($${totalGross.toLocaleString()}/$${Number(config.target_gross).toLocaleString()})`);
          if (parts.length > 0) {
            await saveMemory(supabase, userId, eventId,
              `${event.name} vs targets: ${parts.join(", ")}`,
              "insight", 7,
            );
            memoriesCreated++;
          }
        }

        // 8. Team size
        if (roster.length > 0) {
          const active = roster.filter((r) => r.active).length;
          await saveMemory(supabase, userId, eventId,
            `${event.name} team: ${active} active members out of ${roster.length} total`,
            "fact", 4,
          );
          memoriesCreated++;
        }

      } catch (eventErr) {
        console.warn(`[Cruze Backfill] Error processing event ${eventId}:`, eventErr);
        continue;
      }
    }

    // Mark backfill as complete
    await markBackfillComplete(supabase, userId);

  } catch (err) {
    console.error("[Cruze Backfill] Fatal error:", err);
  }

  console.log(`[Cruze Backfill] Complete: ${memoriesCreated} memories from ${eventsScanned} events`);
  return { memoriesCreated, eventsScanned };
}
