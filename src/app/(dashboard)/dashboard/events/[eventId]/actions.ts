"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function addVehicle(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const eventId = formData.get("event_id") as string;
  const stockNumber = (formData.get("stock_number") as string) || null;
  const vin = (formData.get("vin") as string) || null;
  const year = formData.get("year") as string;
  const make = (formData.get("make") as string) || null;
  const model = (formData.get("model") as string) || null;
  const trim = (formData.get("trim") as string) || null;
  const bodyStyle = (formData.get("body_style") as string) || null;
  const color = (formData.get("color") as string) || null;
  const mileage = formData.get("mileage") as string;
  const acquisitionCost = formData.get("acquisition_cost") as string;
  const notes = (formData.get("notes") as string) || null;

  if (!eventId) throw new Error("Event ID is required");

  const { error } = await supabase.from("vehicle_inventory").insert({
    event_id: eventId,
    stock_number: stockNumber,
    vin,
    year: year ? parseInt(year) : null,
    make,
    model,
    trim,
    body_style: bodyStyle,
    color,
    mileage: mileage ? parseInt(mileage) : null,
    acquisition_cost: acquisitionCost ? parseFloat(acquisitionCost) : null,
    notes,
    status: "available" as const,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}

export async function updateVehicleStatus(
  vehicleId: string,
  status: "available" | "sold" | "hold" | "pending" | "wholesale",
  eventId: string,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_inventory")
    .update({ status })
    .eq("id", vehicleId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}

export async function addDeal(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const eventId = formData.get("event_id") as string;
  const customerName = (formData.get("customer_name") as string) || null;
  const customerZip = (formData.get("customer_zip") as string) || null;
  const stockNumber = (formData.get("stock_number") as string) || null;
  const vehicleYear = formData.get("vehicle_year") as string;
  const vehicleMake = (formData.get("vehicle_make") as string) || null;
  const vehicleModel = (formData.get("vehicle_model") as string) || null;
  const salesperson = (formData.get("salesperson") as string) || null;
  const sellingPrice = formData.get("selling_price") as string;
  const frontGross = formData.get("front_gross") as string;
  const lender = (formData.get("lender") as string) || null;
  const notes = (formData.get("notes") as string) || null;

  if (!eventId) throw new Error("Event ID is required");

  const { error } = await supabase.from("sales_deals").insert({
    event_id: eventId,
    customer_name: customerName,
    customer_zip: customerZip,
    stock_number: stockNumber,
    vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
    vehicle_make: vehicleMake,
    vehicle_model: vehicleModel,
    salesperson,
    selling_price: sellingPrice ? parseFloat(sellingPrice) : null,
    front_gross: frontGross ? parseFloat(frontGross) : null,
    lender,
    notes,
    status: "pending" as const,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/events/${eventId}`);
}
