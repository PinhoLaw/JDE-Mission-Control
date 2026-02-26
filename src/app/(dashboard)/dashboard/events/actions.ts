"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { slugify } from "@/lib/utils";

export async function createEvent(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const name = formData.get("name") as string;
  const dealerName = (formData.get("dealer_name") as string) || null;
  const address = (formData.get("address") as string) || null;
  const city = (formData.get("city") as string) || null;
  const state = (formData.get("state") as string) || null;
  const zip = (formData.get("zip") as string) || null;
  const franchise = (formData.get("franchise") as string) || null;
  const startDate = (formData.get("start_date") as string) || null;
  const endDate = (formData.get("end_date") as string) || null;
  const saleDays = formData.get("sale_days") as string;
  const budget = formData.get("budget") as string;
  const notes = (formData.get("notes") as string) || null;
  const status = (formData.get("status") as string) || "draft";

  if (!name) {
    throw new Error("Event name is required");
  }

  // Generate a unique slug
  const baseSlug = slugify(name);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  const { data: event, error } = await supabase
    .from("events")
    .insert({
      name,
      slug,
      status: status as "draft" | "active" | "completed" | "cancelled",
      dealer_name: dealerName,
      address,
      city,
      state,
      zip,
      franchise,
      start_date: startDate || null,
      end_date: endDate || null,
      sale_days: saleDays ? parseInt(saleDays) : null,
      budget: budget ? parseFloat(budget) : null,
      notes,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Add creator as event owner (also handled by trigger, but explicit for safety)
  await supabase.from("event_members").insert({
    event_id: event.id,
    user_id: user.id,
    role: "owner" as const,
  });

  redirect(`/dashboard/events/${event.id}`);
}
