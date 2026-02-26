"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// ────────────────────────────────────────────────────────
// Upload a photo for a vehicle
// ────────────────────────────────────────────────────────
export async function uploadVehiclePhoto(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const file = formData.get("file") as File | null;
  const vehicleId = formData.get("vehicleId") as string | null;
  const eventId = formData.get("eventId") as string | null;

  if (!file || !vehicleId || !eventId) {
    throw new Error("Missing required fields: file, vehicleId, eventId");
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("Not a member of this event");

  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Invalid file type. Only JPEG, PNG, and WebP are allowed.");
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File too large. Maximum size is 5 MB.");
  }

  // Build storage path
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const timestamp = Date.now();
  const storagePath = `${eventId}/${vehicleId}/${timestamp}.${ext}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("vehicle-photos")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // Get the public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from("vehicle-photos").getPublicUrl(storagePath);

  // Update vehicle record
  const { error: updateError } = await supabase
    .from("vehicle_inventory")
    .update({ photo_url: publicUrl })
    .eq("id", vehicleId)
    .eq("event_id", eventId);

  if (updateError) throw new Error(`Failed to update vehicle: ${updateError.message}`);

  revalidatePath("/dashboard/inventory");
  return { success: true, url: publicUrl };
}

// ────────────────────────────────────────────────────────
// Delete a vehicle photo (owner/manager only)
// ────────────────────────────────────────────────────────
export async function deleteVehiclePhoto(vehicleId: string, eventId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Only owner/manager can delete photos
  const { data: membership } = await supabase
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .single();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    throw new Error("Only owners and managers can delete photos");
  }

  // Get current photo URL
  const { data: vehicle, error: fetchError } = await supabase
    .from("vehicle_inventory")
    .select("photo_url")
    .eq("id", vehicleId)
    .eq("event_id", eventId)
    .single();

  if (fetchError || !vehicle) throw new Error("Vehicle not found");
  if (!vehicle.photo_url) throw new Error("Vehicle has no photo to delete");

  // Extract storage path from the public URL
  // URL format: {SUPABASE_URL}/storage/v1/object/public/vehicle-photos/{path}
  const marker = "/storage/v1/object/public/vehicle-photos/";
  const markerIndex = vehicle.photo_url.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("Could not parse storage path from photo URL");
  }
  const storagePath = vehicle.photo_url.substring(markerIndex + marker.length);

  // Delete from storage
  const { error: deleteError } = await supabase.storage
    .from("vehicle-photos")
    .remove([storagePath]);

  if (deleteError) throw new Error(`Failed to delete photo: ${deleteError.message}`);

  // Clear photo_url on the vehicle record
  const { error: updateError } = await supabase
    .from("vehicle_inventory")
    .update({ photo_url: null })
    .eq("id", vehicleId)
    .eq("event_id", eventId);

  if (updateError) throw new Error(`Failed to update vehicle: ${updateError.message}`);

  revalidatePath("/dashboard/inventory");
  return { success: true };
}
