"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { slugify } from "@/lib/utils";
import { copySpreadsheet } from "@/lib/services/googleSheets";

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

// ────────────────────────────────────────────────────────────
// Create event from template — copies config, roster, lenders,
// and creates a new Google Sheet via Drive API
// ────────────────────────────────────────────────────────────

export async function createEventFromTemplate(
  templateEventId: string,
  formData: FormData,
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Verify user has access to the template event
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", templateEventId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    throw new Error("Not a member of the template event");
  }

  // Fetch template event
  const { data: templateEvent, error: templateErr } = await supabase
    .from("events")
    .select("*")
    .eq("id", templateEventId)
    .single();

  if (templateErr || !templateEvent) {
    throw new Error("Template event not found");
  }

  // Parse form fields
  const name = formData.get("name") as string;
  const dealerName = (formData.get("dealer_name") as string) || templateEvent.dealer_name;
  const address = (formData.get("address") as string) || templateEvent.address;
  const city = (formData.get("city") as string) || templateEvent.city;
  const state = (formData.get("state") as string) || templateEvent.state;
  const zip = (formData.get("zip") as string) || templateEvent.zip;
  const franchise = (formData.get("franchise") as string) || templateEvent.franchise;
  const startDate = (formData.get("start_date") as string) || null;
  const endDate = (formData.get("end_date") as string) || null;
  const saleDays = formData.get("sale_days") as string;
  const budget = formData.get("budget") as string;
  const notes = (formData.get("notes") as string) || null;

  const copyRoster = formData.get("copy_roster") === "true";
  const copyLenders = formData.get("copy_lenders") === "true";
  const copySettings = formData.get("copy_settings") === "true";
  const createSheet = formData.get("create_sheet") === "true";

  if (!name) {
    throw new Error("Event name is required");
  }

  // 1. Copy Google Sheet if requested and template has one
  let newSheetId: string | null = null;
  if (createSheet && templateEvent.sheet_id) {
    try {
      const { spreadsheetId } = await copySpreadsheet(
        templateEvent.sheet_id,
        `JDE — ${name}`,
      );
      newSheetId = spreadsheetId;
    } catch (err) {
      console.error("[createEventFromTemplate] Sheet copy failed:", err);
      // Continue without sheet — user can manually set it up later
    }
  }

  // 2. Insert new event
  const baseSlug = slugify(name);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  const { data: newEvent, error: insertErr } = await supabase
    .from("events")
    .insert({
      name,
      slug,
      status: "draft" as const,
      dealer_name: dealerName,
      address,
      city,
      state,
      zip,
      franchise,
      start_date: startDate || null,
      end_date: endDate || null,
      sale_days: saleDays ? parseInt(saleDays) : templateEvent.sale_days,
      budget: budget ? parseFloat(budget) : null,
      notes,
      sheet_id: newSheetId,
      created_by: user.id,
    })
    .select()
    .single();

  if (insertErr || !newEvent) {
    throw new Error(insertErr?.message || "Failed to create event");
  }

  // 3. Add creator as owner
  await supabase.from("event_members").insert({
    event_id: newEvent.id,
    user_id: user.id,
    role: "owner" as const,
  });

  // 4. Copy event_config if requested
  if (copySettings) {
    const { data: templateConfig } = await supabase
      .from("event_config")
      .select("*")
      .eq("event_id", templateEventId)
      .single();

    if (templateConfig) {
      await supabase.from("event_config").upsert({
        event_id: newEvent.id,
        doc_fee: templateConfig.doc_fee,
        tax_rate: templateConfig.tax_rate,
        pack: templateConfig.pack,
        jde_commission_pct: templateConfig.jde_commission_pct,
        rep_commission_pct: templateConfig.rep_commission_pct,
        mail_campaign_name: null,
        mail_pieces_sent: null,
        target_units: templateConfig.target_units,
        target_gross: templateConfig.target_gross,
        target_pvr: templateConfig.target_pvr,
        washout_threshold: templateConfig.washout_threshold,
      });
    }
  }

  // 5. Copy roster if requested
  if (copyRoster) {
    const { data: templateRoster } = await supabase
      .from("roster")
      .select("name, phone, email, role, team, commission_pct, notes")
      .eq("event_id", templateEventId);

    if (templateRoster && templateRoster.length > 0) {
      const rosterRows = templateRoster.map((m) => ({
        event_id: newEvent.id,
        name: m.name,
        phone: m.phone,
        email: m.email,
        role: m.role,
        team: m.team,
        commission_pct: m.commission_pct,
        notes: m.notes,
        confirmed: false,
        active: true,
      }));
      await supabase.from("roster").insert(rosterRows);
    }
  }

  // 6. Copy lenders if requested
  if (copyLenders) {
    const { data: templateLenders } = await supabase
      .from("lenders")
      .select("name, buy_rate_pct, max_advance, notes, active")
      .eq("event_id", templateEventId);

    if (templateLenders && templateLenders.length > 0) {
      const lenderRows = templateLenders.map((l) => ({
        event_id: newEvent.id,
        name: l.name,
        buy_rate_pct: l.buy_rate_pct,
        max_advance: l.max_advance,
        notes: l.notes,
        active: l.active,
      }));
      await supabase.from("lenders").insert(lenderRows);
    }
  }

  redirect(`/dashboard/events/${newEvent.id}`);
}

// ────────────────────────────────────────────────────────────
// Fetch events for template selection
// ────────────────────────────────────────────────────────────

export async function fetchEventsForTemplateSelection() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  // Get events user has access to
  const { data: memberships } = await supabase
    .from("event_members")
    .select("event_id")
    .eq("user_id", user.id);

  if (!memberships || memberships.length === 0) return [];

  const eventIds = memberships.map((m) => m.event_id);
  const { data: events } = await supabase
    .from("events")
    .select("id, name, dealer_name, status, sheet_id")
    .in("id", eventIds)
    .order("created_at", { ascending: false });

  return events ?? [];
}
