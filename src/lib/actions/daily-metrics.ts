"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────

const upsertMetricSchema = z.object({
  id: z.string().uuid().optional(),
  event_id: z.string().uuid(),
  sale_day: z.coerce.number().int().min(1).max(31),
  sale_date: z.string().optional().nullable(),
  total_ups: z.coerce.number().int().min(0).default(0),
  total_sold: z.coerce.number().int().min(0).default(0),
  total_gross: z.coerce.number().optional().nullable(),
  total_front: z.coerce.number().optional().nullable(),
  total_back: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type UpsertMetricInput = z.infer<typeof upsertMetricSchema>;

// ────────────────────────────────────────────────────────
// Upsert a single daily metric row (create or update)
// ────────────────────────────────────────────────────────
export async function upsertDailyMetric(input: UpsertMetricInput) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Verify membership
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", input.event_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  const parsed = upsertMetricSchema.safeParse(input);
  if (!parsed.success) {
    const errs = parsed.error.issues.map((e) => `${e.path}: ${e.message}`);
    throw new Error(errs.join("; "));
  }

  const d = parsed.data;

  if (d.id) {
    // Update existing row
    const { error } = await supabase
      .from("daily_metrics")
      .update({
        sale_day: d.sale_day,
        sale_date: d.sale_date ?? null,
        total_ups: d.total_ups,
        total_sold: d.total_sold,
        total_gross: d.total_gross ?? null,
        total_front: d.total_front ?? null,
        total_back: d.total_back ?? null,
        notes: d.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", d.id)
      .eq("event_id", d.event_id);

    if (error) throw new Error(error.message);
  } else {
    // Insert new row
    const { error } = await supabase.from("daily_metrics").insert({
      event_id: d.event_id,
      sale_day: d.sale_day,
      sale_date: d.sale_date ?? null,
      total_ups: d.total_ups,
      total_sold: d.total_sold,
      total_gross: d.total_gross ?? null,
      total_front: d.total_front ?? null,
      total_back: d.total_back ?? null,
      notes: d.notes ?? null,
    });

    if (error) throw new Error(error.message);
  }

  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/daily-metrics");
  revalidatePath("/dashboard");

  return { success: true };
}

// ────────────────────────────────────────────────────────
// Bulk upsert — save all rows at once
// ────────────────────────────────────────────────────────
const bulkUpsertSchema = z.object({
  event_id: z.string().uuid(),
  rows: z.array(upsertMetricSchema),
});

export async function bulkUpsertDailyMetrics(input: z.infer<typeof bulkUpsertSchema>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", input.event_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  const parsed = bulkUpsertSchema.safeParse(input);
  if (!parsed.success) {
    const errs = parsed.error.issues.map((e) => `${e.path}: ${e.message}`);
    throw new Error(errs.join("; "));
  }

  const { event_id, rows } = parsed.data;

  // Process each row: update existing, insert new
  for (const row of rows) {
    if (row.id) {
      const { error } = await supabase
        .from("daily_metrics")
        .update({
          sale_day: row.sale_day,
          sale_date: row.sale_date ?? null,
          total_ups: row.total_ups,
          total_sold: row.total_sold,
          total_gross: row.total_gross ?? null,
          total_front: row.total_front ?? null,
          total_back: row.total_back ?? null,
          notes: row.notes ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("event_id", event_id);

      if (error) throw new Error(`Day ${row.sale_day}: ${error.message}`);
    } else {
      const { error } = await supabase.from("daily_metrics").insert({
        event_id,
        sale_day: row.sale_day,
        sale_date: row.sale_date ?? null,
        total_ups: row.total_ups,
        total_sold: row.total_sold,
        total_gross: row.total_gross ?? null,
        total_front: row.total_front ?? null,
        total_back: row.total_back ?? null,
        notes: row.notes ?? null,
      });

      if (error) throw new Error(`Day ${row.sale_day}: ${error.message}`);
    }
  }

  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/daily-metrics");
  revalidatePath("/dashboard");

  return { success: true, count: rows.length };
}

// ────────────────────────────────────────────────────────
// Delete a daily metric row
// ────────────────────────────────────────────────────────
export async function deleteDailyMetric(metricId: string, eventId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("Only owners and managers can delete metrics");
  }

  const { error } = await supabase
    .from("daily_metrics")
    .delete()
    .eq("id", metricId)
    .eq("event_id", eventId);

  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/daily-metrics");
  revalidatePath("/dashboard");

  return { success: true };
}
