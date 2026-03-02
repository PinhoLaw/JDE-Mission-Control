"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { BadgeDef } from "@/types/database";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface EarnedBadge {
  badge: BadgeDef;
  earnedAt: string;
}

interface EvaluationResult {
  newBadges: EarnedBadge[];
}

// ────────────────────────────────────────────────────────
// evaluateBadges — called after deal create/update
// Checks all badge conditions for a roster member and
// awards any newly earned badges.
// ────────────────────────────────────────────────────────
export async function evaluateBadges(
  eventId: string,
  rosterId: string,
): Promise<EvaluationResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Verify membership
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();
  if (!membership) throw new Error("Not a member of this event");

  // Fetch in parallel: all badges, existing achievements, deals for this person, streak
  const [badgesRes, achievementsRes, dealsRes, streakRes] = await Promise.all([
    supabase.from("badges").select("*"),
    supabase
      .from("user_achievements")
      .select("badge_id")
      .eq("roster_id", rosterId)
      .eq("event_id", eventId),
    supabase
      .from("sales_deals")
      .select("*")
      .eq("event_id", eventId)
      .eq("salesperson_id", rosterId)
      .not("status", "eq", "cancelled"),
    supabase
      .from("streaks")
      .select("*")
      .eq("roster_id", rosterId)
      .eq("event_id", eventId)
      .maybeSingle(),
  ]);

  const allBadges = (badgesRes.data ?? []) as BadgeDef[];
  const earnedIds = new Set(
    (achievementsRes.data ?? []).map((a) => a.badge_id),
  );
  const deals = dealsRes.data ?? [];
  const streak = streakRes.data;

  // ── Pre-compute aggregates ──────────────────────────
  const totalUnits = deals.length;
  const totalGross = deals.reduce((s, d) => s + (d.total_gross ?? 0), 0);
  const totalUps = deals.reduce((s, d) => s + (d.ups_count ?? 1), 0);
  const closingRatio = totalUps > 0 ? (totalUnits / totalUps) * 100 : 0;
  const washoutCount = deals.filter((d) => d.is_washout).length;

  // Group deals by sale_date for per-day calculations
  const byDate: Record<string, { units: number; gross: number }> = {};
  for (const d of deals) {
    const date = d.sale_date ?? d.created_at?.slice(0, 10) ?? "unknown";
    if (!byDate[date]) byDate[date] = { units: 0, gross: 0 };
    byDate[date].units += 1;
    byDate[date].gross += d.total_gross ?? 0;
  }

  const dayValues = Object.values(byDate);
  const maxUnitsInDay = Math.max(0, ...dayValues.map((d) => d.units));
  const maxGrossInDay = Math.max(0, ...dayValues.map((d) => d.gross));

  // Comeback check: best gross day comes after worst gross day
  const dayEntries = Object.entries(byDate).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  let isComeback = false;
  if (dayEntries.length >= 2) {
    let worstIdx = 0;
    let bestIdx = 0;
    for (let i = 0; i < dayEntries.length; i++) {
      if (dayEntries[i][1].gross < dayEntries[worstIdx][1].gross) worstIdx = i;
      if (dayEntries[i][1].gross > dayEntries[bestIdx][1].gross) bestIdx = i;
    }
    isComeback =
      bestIdx > worstIdx &&
      dayEntries[worstIdx][1].gross < dayEntries[bestIdx][1].gross;
  }

  // ── Evaluate each unearned badge ────────────────────
  const newBadges: EarnedBadge[] = [];

  for (const badge of allBadges) {
    if (earnedIds.has(badge.id)) continue;

    let earned = false;
    const val = badge.condition_value;

    switch (badge.condition_type) {
      case "units_total":
        earned = totalUnits >= val;
        break;
      case "units_day":
        earned = maxUnitsInDay >= val;
        break;
      case "gross_total":
        earned = totalGross >= val;
        break;
      case "gross_day":
        earned = maxGrossInDay >= val;
        break;
      case "closing_ratio":
        // Require minimum 5 ups to avoid trivial ratios
        earned = totalUps >= 5 && closingRatio >= val;
        break;
      case "pvr_min":
        earned = totalUnits >= 1 && totalGross / totalUnits >= val;
        break;
      case "streak_days":
        earned = (streak?.longest_streak ?? 0) >= val;
        break;
      case "no_washouts":
        earned = washoutCount === 0 && totalUnits >= val;
        break;
      case "rank_first":
        // Deferred — requires comparing all roster members.
        // Evaluated separately at event completion.
        break;
      case "comeback":
        earned = isComeback;
        break;
    }

    if (earned) {
      const now = new Date().toISOString();
      // UNIQUE constraint prevents duplicates even under race conditions
      const { error } = await supabase.from("user_achievements").insert({
        roster_id: rosterId,
        badge_id: badge.id,
        event_id: eventId,
        earned_at: now,
      });

      if (!error) {
        newBadges.push({ badge, earnedAt: now });
      }
    }
  }

  if (newBadges.length > 0) {
    revalidatePath("/dashboard/achievements");
    revalidatePath("/dashboard/performance");
  }

  return { newBadges };
}

// ────────────────────────────────────────────────────────
// updateStreak — called after deal creation
// Tracks consecutive days with at least one sale.
// ────────────────────────────────────────────────────────
export async function updateStreak(
  eventId: string,
  rosterId: string,
  saleDate: string, // YYYY-MM-DD
): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Fetch or create streak record
  const { data: existing } = await supabase
    .from("streaks")
    .select("*")
    .eq("roster_id", rosterId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (!existing) {
    // First sale — create streak record
    await supabase.from("streaks").insert({
      roster_id: rosterId,
      event_id: eventId,
      current_streak: 1,
      longest_streak: 1,
      last_activity_date: saleDate,
    });
    return;
  }

  // Already recorded for this date — no change
  if (existing.last_activity_date === saleDate) return;

  const lastDate = existing.last_activity_date
    ? new Date(existing.last_activity_date + "T12:00:00")
    : null;
  const currentDate = new Date(saleDate + "T12:00:00");

  const daysDiff = lastDate
    ? Math.round(
        (currentDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      )
    : 999;

  let newStreak: number;
  if (daysDiff === 1) {
    // Consecutive day — extend streak
    newStreak = existing.current_streak + 1;
  } else if (daysDiff <= 0) {
    // Same day or earlier — no change
    return;
  } else {
    // Gap in days — reset streak
    newStreak = 1;
  }

  const newLongest = Math.max(existing.longest_streak, newStreak);

  await supabase
    .from("streaks")
    .update({
      current_streak: newStreak,
      longest_streak: newLongest,
      last_activity_date: saleDate,
    })
    .eq("id", existing.id);
}
