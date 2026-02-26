"use server";

import { createClient } from "@/lib/supabase/server";

function toCsvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return "";
      const str = String(v);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(",");
}

export async function exportInventoryCSV(eventId: string): Promise<string> {
  const supabase = await createClient();

  const { data: vehicles, error } = await supabase
    .from("vehicle_inventory")
    .select("*")
    .eq("event_id", eventId)
    .order("hat_number", { ascending: true });

  if (error) throw new Error(error.message);
  if (!vehicles || vehicles.length === 0) return "";

  const headers = [
    "Hat#", "Stock#", "VIN", "Year", "Make", "Model", "Trim", "Body Style",
    "Color", "Mileage", "Age Days", "Drivetrain", "Acquisition Cost",
    "JD Trade Clean", "JD Retail Clean", "Ask 115%", "Ask 120%", "Ask 125%",
    "Ask 130%", "Profit 115%", "Profit 120%", "Profit 125%", "Profit 130%",
    "Retail Spread", "Sold Price", "Sold Date", "Status", "Notes",
  ];

  const rows = vehicles.map((v) =>
    toCsvRow([
      v.hat_number, v.stock_number, v.vin, v.year, v.make, v.model, v.trim,
      v.body_style, v.color, v.mileage, v.age_days, v.drivetrain,
      v.acquisition_cost, v.jd_trade_clean, v.jd_retail_clean,
      v.asking_price_115, v.asking_price_120, v.asking_price_125,
      v.asking_price_130, v.profit_115, v.profit_120, v.profit_125,
      v.profit_130, v.retail_spread, v.sold_price, v.sold_date,
      v.status, v.notes,
    ]),
  );

  return [toCsvRow(headers), ...rows].join("\n");
}

export async function exportDealsCSV(eventId: string): Promise<string> {
  const supabase = await createClient();

  const { data: deals, error } = await supabase
    .from("sales_deals")
    .select("*")
    .eq("event_id", eventId)
    .order("deal_number", { ascending: true });

  if (error) throw new Error(error.message);
  if (!deals || deals.length === 0) return "";

  const headers = [
    "Deal#", "Day", "Date", "Customer", "Zip", "Phone", "Stock#",
    "Year", "Make", "Model", "Type", "New/Used", "Salesperson", "2nd SP",
    "Selling Price", "Vehicle Cost", "Front Gross", "Lender", "Rate",
    "Finance Type", "Reserve", "Warranty", "GAP", "AFT1", "AFT2", "Doc Fee",
    "F&I Total", "Back Gross", "Total Gross", "PVR", "Washout", "Washout Amt",
    "JDE Gross", "Dealer Gross", "Source", "Funded", "Status", "Notes",
  ];

  const rows = deals.map((d) =>
    toCsvRow([
      d.deal_number, d.sale_day, d.sale_date, d.customer_name, d.customer_zip,
      d.customer_phone, d.stock_number, d.vehicle_year, d.vehicle_make,
      d.vehicle_model, d.vehicle_type, d.new_used, d.salesperson,
      d.second_salesperson, d.selling_price, d.vehicle_cost, d.front_gross,
      d.lender, d.rate, d.finance_type, d.reserve, d.warranty, d.gap,
      d.aftermarket_1, d.aftermarket_2, d.doc_fee, d.fi_total, d.back_gross,
      d.total_gross, d.pvr, d.is_washout, d.washout_amount, d.jde_gross,
      d.dealer_gross, d.source, d.funded, d.status, d.notes,
    ]),
  );

  return [toCsvRow(headers), ...rows].join("\n");
}
