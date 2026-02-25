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
  const location = (formData.get("location") as string) || null;
  const startDate = (formData.get("start_date") as string) || null;
  const endDate = (formData.get("end_date") as string) || null;
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
      status: status as "draft" | "active",
      location,
      start_date: startDate || null,
      end_date: endDate || null,
      budget: budget ? parseFloat(budget) : null,
      notes,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Add creator as event owner
  await supabase.from("event_members").insert({
    event_id: event.id,
    user_id: user.id,
    role: "owner",
  });

  redirect(`/dashboard/events/${event.id}`);
}
