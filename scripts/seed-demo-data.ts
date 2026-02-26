/**
 * Seed Demo Data for JDE Mission Control
 *
 * Run with:
 *   npx tsx scripts/seed-demo-data.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 * (reads .env.local automatically via dotenv if present).
 *
 * This script creates a realistic demo event with:
 *   - Event + event_config + event_member (owner = first auth user)
 *   - 8 roster members (sales, team_leader, fi_manager, closer, manager)
 *   - 4 lenders
 *   - 60 vehicles (mix of available, sold, hold, pending)
 *   - 30 sales deals (mix of funded, pending, with splits, washouts)
 *   - 12 mail_tracking zip codes
 *   - 5 daily_metrics rows
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ──────────────────────────────────────────────────────
// Load .env.local if it exists
// ──────────────────────────────────────────────────────
// Try multiple possible .env.local locations
const possiblePaths = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(__dirname, "../.env.local"),
];
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    const envContent = fs.readFileSync(p, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
    break;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function money(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}
function uuid() {
  return crypto.randomUUID();
}

const MAKES = [
  "Toyota",
  "Honda",
  "Ford",
  "Chevrolet",
  "Nissan",
  "Hyundai",
  "Kia",
  "Jeep",
  "Ram",
  "Dodge",
  "Chrysler",
  "BMW",
  "Mercedes",
  "Subaru",
  "Mazda",
  "Volkswagen",
];

const MODELS: Record<string, string[]> = {
  Toyota: ["Camry", "Corolla", "RAV4", "Highlander", "Tacoma", "Tundra"],
  Honda: ["Civic", "Accord", "CR-V", "Pilot", "HR-V"],
  Ford: ["F-150", "Explorer", "Escape", "Mustang", "Bronco", "Edge"],
  Chevrolet: ["Silverado", "Equinox", "Malibu", "Tahoe", "Traverse"],
  Nissan: ["Altima", "Rogue", "Sentra", "Pathfinder", "Murano"],
  Hyundai: ["Elantra", "Tucson", "Santa Fe", "Sonata", "Kona"],
  Kia: ["Forte", "Sportage", "Seltos", "Telluride", "K5"],
  Jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Compass"],
  Ram: ["1500", "2500"],
  Dodge: ["Charger", "Durango", "Challenger"],
  Chrysler: ["300", "Pacifica"],
  BMW: ["3 Series", "X3", "X5", "5 Series"],
  Mercedes: ["C-Class", "GLC", "E-Class", "GLE"],
  Subaru: ["Outback", "Forester", "Crosstrek", "Impreza"],
  Mazda: ["CX-5", "Mazda3", "CX-30", "CX-50"],
  Volkswagen: ["Jetta", "Tiguan", "Atlas", "Taos"],
};

const COLORS = [
  "White",
  "Black",
  "Silver",
  "Gray",
  "Blue",
  "Red",
  "Green",
  "Burgundy",
  "Gold",
  "Beige",
];
const TRIMS = [
  "Base",
  "LE",
  "SE",
  "XLE",
  "Limited",
  "Sport",
  "LX",
  "EX",
  "Touring",
  "SXT",
];
const BODY_STYLES = [
  "Sedan",
  "SUV",
  "Truck",
  "Coupe",
  "Van",
  "Hatchback",
  "Crossover",
];
const SOURCES = [
  "Walk-In",
  "Phone",
  "Internet",
  "Mail",
  "Repeat",
  "Referral",
  "Be-Back",
];
const FIRST_NAMES = [
  "Mike",
  "Dave",
  "Sarah",
  "Chris",
  "Jessica",
  "Brian",
  "Amanda",
  "Kevin",
  "Rachel",
  "Tom",
  "Lisa",
  "Jason",
  "Nicole",
  "Matt",
  "Ashley",
  "Dan",
];
const LAST_NAMES = [
  "Johnson",
  "Williams",
  "Brown",
  "Davis",
  "Miller",
  "Wilson",
  "Taylor",
  "Anderson",
  "Thomas",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Garcia",
  "Harris",
  "Clark",
];

const LENDER_NAMES = [
  "Capital One Auto",
  "Ally Financial",
  "Chase Auto",
  "TD Auto Finance",
  "Santander",
  "Wells Fargo Dealer",
];

const ZIP_CODES = [
  { zip: "60601", town: "Chicago Loop" },
  { zip: "60602", town: "Chicago Downtown" },
  { zip: "60614", town: "Lincoln Park" },
  { zip: "60657", town: "Lakeview" },
  { zip: "60611", town: "Streeterville" },
  { zip: "60622", town: "Wicker Park" },
  { zip: "60647", town: "Logan Square" },
  { zip: "60618", town: "North Center" },
  { zip: "60640", town: "Uptown" },
  { zip: "60613", town: "Wrigleyville" },
  { zip: "60625", town: "Ravenswood" },
  { zip: "60660", town: "Edgewater" },
];

// ──────────────────────────────────────────────────────
// Seed
// ──────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Starting seed...\n");

  // 1. Get first auth user to make them owner
  const {
    data: { users },
  } = await supabase.auth.admin.listUsers({ perPage: 1 });
  if (!users || users.length === 0) {
    console.error(
      "❌ No auth users found. Sign up at least once before seeding.",
    );
    process.exit(1);
  }
  const ownerId = users[0].id;
  console.log(`👤 Owner: ${users[0].email} (${ownerId})`);

  // 2. Create Event
  const eventId = uuid();
  const slug = "lincoln-cdjr-feb-march-26";
  const { error: eventErr } = await supabase.from("events").insert({
    id: eventId,
    name: "Lincoln CDJR Feb/March 26",
    slug,
    dealer_name: "Lincoln CDJR",
    address: "1234 Main Street",
    city: "Lincoln",
    state: "NE",
    zip: "68501",
    franchise: "CDJR",
    status: "active",
    start_date: "2026-02-23",
    end_date: "2026-03-01",
    sale_days: 7,
    budget: 45000,
    notes: "Demo seed event — 7-day pop-up sale",
    created_by: ownerId,
  });
  if (eventErr) throw eventErr;
  console.log(`📅 Event created: Lincoln CDJR Feb/March 26 (${eventId})`);

  // 3. Event Member (owner)
  await supabase
    .from("event_members")
    .insert({ event_id: eventId, user_id: ownerId, role: "owner" });
  console.log("   → Owner membership linked");

  // 4. Event Config
  await supabase.from("event_config").insert({
    event_id: eventId,
    doc_fee: 799,
    tax_rate: 0.0725,
    pack: 500,
    jde_commission_pct: 0.35,
    rep_commission_pct: 0.25,
    mail_campaign_name: "Lincoln CDJR Presidents Day Blowout",
    mail_pieces_sent: 42000,
    target_units: 80,
    target_gross: 250000,
    target_pvr: 3200,
    washout_threshold: 0,
  });
  console.log("   → Event config set");

  // 5. Roster (8 members)
  const rosterData = [
    {
      name: "Mike Sullivan",
      role: "manager" as const,
      phone: "555-100-0001",
      email: "mike@jde.com",
      team: "A",
      confirmed: true,
    },
    {
      name: "Dave Rodriguez",
      role: "team_leader" as const,
      phone: "555-100-0002",
      email: "dave@jde.com",
      team: "A",
      confirmed: true,
    },
    {
      name: "Sarah Chen",
      role: "team_leader" as const,
      phone: "555-100-0003",
      email: "sarah@jde.com",
      team: "B",
      confirmed: true,
    },
    {
      name: "Chris Baker",
      role: "fi_manager" as const,
      phone: "555-100-0004",
      email: "chris@jde.com",
      confirmed: true,
    },
    {
      name: "Jessica Lopez",
      role: "sales" as const,
      phone: "555-100-0005",
      team: "A",
      commission_pct: 0.25,
      confirmed: true,
    },
    {
      name: "Brian Kim",
      role: "sales" as const,
      phone: "555-100-0006",
      team: "A",
      commission_pct: 0.25,
      confirmed: true,
    },
    {
      name: "Amanda Davis",
      role: "sales" as const,
      phone: "555-100-0007",
      team: "B",
      commission_pct: 0.25,
      confirmed: false,
    },
    {
      name: "Kevin Turner",
      role: "closer" as const,
      phone: "555-100-0008",
      email: "kevin@jde.com",
      commission_pct: 0.3,
      confirmed: true,
    },
  ];

  const rosterIds: string[] = [];
  for (const r of rosterData) {
    const id = uuid();
    rosterIds.push(id);
    await supabase.from("roster").insert({
      id,
      event_id: eventId,
      name: r.name,
      phone: r.phone ?? null,
      email: r.email ?? null,
      role: r.role,
      team: r.team ?? null,
      commission_pct: r.commission_pct ?? null,
      confirmed: r.confirmed,
      active: true,
    });
  }
  console.log(`👥 Roster: ${rosterData.length} members`);

  // Salesperson names for deals
  const salesNames = rosterData
    .filter((r) => ["sales", "closer", "team_leader"].includes(r.role))
    .map((r) => r.name);

  // 6. Lenders (4)
  const lenderRows = LENDER_NAMES.slice(0, 4).map((name) => ({
    id: uuid(),
    event_id: eventId,
    name,
    buy_rate_pct: money(2, 6),
    max_advance: rand(25000, 50000),
    active: true,
  }));
  for (const l of lenderRows) {
    await supabase.from("lenders").insert(l);
  }
  console.log(`🏦 Lenders: ${lenderRows.length}`);

  // 7. Vehicles (60)
  const vehicleIds: string[] = [];
  const vehicles = [];

  for (let i = 0; i < 60; i++) {
    const make = pick(MAKES);
    const model = pick(MODELS[make]);
    const year = rand(2018, 2025);
    const acqCost = money(8000, 35000);
    const retail = acqCost * (1 + money(0.1, 0.35));
    const id = uuid();
    vehicleIds.push(id);

    const status =
      i < 25
        ? "sold"
        : i < 50
          ? "available"
          : i < 55
            ? "hold"
            : ("pending" as const);

    vehicles.push({
      id,
      event_id: eventId,
      hat_number: i + 1,
      stock_number: `LN${String(i + 101).padStart(4, "0")}`,
      vin: `1HGBH41JXMN${String(rand(100000, 999999))}`,
      year,
      make,
      model,
      trim: pick(TRIMS),
      body_style: pick(BODY_STYLES),
      color: pick(COLORS),
      mileage: rand(5000, 120000),
      age_days: rand(10, 365),
      drivetrain: pick(["FWD", "AWD", "4WD", "RWD"]),
      acquisition_cost: Math.round(acqCost),
      jd_trade_clean: Math.round(acqCost * 0.9),
      jd_retail_clean: Math.round(retail),
      asking_price_115: Math.round(acqCost * 1.15),
      asking_price_120: Math.round(acqCost * 1.2),
      asking_price_125: Math.round(acqCost * 1.25),
      asking_price_130: Math.round(acqCost * 1.3),
      profit_115: Math.round(acqCost * 0.15),
      profit_120: Math.round(acqCost * 0.2),
      profit_125: Math.round(acqCost * 0.25),
      profit_130: Math.round(acqCost * 0.3),
      retail_spread: Math.round(retail - acqCost),
      status,
      sold_price: status === "sold" ? Math.round(acqCost * money(1.05, 1.3)) : null,
      sold_date:
        status === "sold"
          ? `2026-02-${String(rand(23, 27)).padStart(2, "0")}`
          : null,
    });
  }

  // Batch insert vehicles in chunks
  for (let i = 0; i < vehicles.length; i += 20) {
    const chunk = vehicles.slice(i, i + 20);
    const { error } = await supabase.from("vehicle_inventory").insert(chunk);
    if (error) throw error;
  }
  console.log(`🚗 Vehicles: ${vehicles.length}`);

  // 8. Sales Deals (30)
  const soldVehicles = vehicles.filter((v) => v.status === "sold");
  const deals = [];

  for (let i = 0; i < 30; i++) {
    const veh = soldVehicles[i % soldVehicles.length];
    const sp = pick(salesNames);
    const hasSplit = Math.random() < 0.2;
    const sp2 = hasSplit
      ? pick(salesNames.filter((n) => n !== sp))
      : null;
    const spPct = hasSplit ? 0.5 : 1;
    const sp2Pct = hasSplit ? 0.5 : null;

    const vehicleCost = veh.acquisition_cost;
    const sellingPrice = Math.round(vehicleCost * money(1.05, 1.35));
    const frontGross = sellingPrice - vehicleCost;

    const reserve = money(200, 1500);
    const warranty = money(0, 2500);
    const gap = Math.random() < 0.6 ? money(300, 900) : 0;
    const am1 = Math.random() < 0.4 ? money(200, 800) : 0;
    const am2 = Math.random() < 0.15 ? money(100, 500) : 0;
    const docFee = 799;
    const fiTotal =
      Math.round((reserve + warranty + gap + am1 + am2 + docFee) * 100) / 100;
    const backGross = Math.round(fiTotal * 100) / 100;
    const totalGross = Math.round((frontGross + backGross) * 100) / 100;
    const pvr = totalGross;
    const isWashout = totalGross < 0;

    const saleDay = rand(1, 5);
    const saleDate = `2026-02-${String(22 + saleDay).padStart(2, "0")}`;
    const customerFirst = pick(FIRST_NAMES);
    const customerLast = pick(LAST_NAMES);

    const hasTrade = Math.random() < 0.35;
    const tradeMake = hasTrade ? pick(MAKES) : null;
    const tradeModel =
      tradeMake && MODELS[tradeMake] ? pick(MODELS[tradeMake]) : null;
    const tradeAcv = hasTrade ? rand(3000, 18000) : null;

    deals.push({
      id: uuid(),
      event_id: eventId,
      vehicle_id: veh.id,
      deal_number: i + 1,
      sale_day: saleDay,
      sale_date: saleDate,
      customer_name: `${customerFirst} ${customerLast}`,
      customer_zip: pick(ZIP_CODES).zip,
      stock_number: veh.stock_number,
      vehicle_year: veh.year,
      vehicle_make: veh.make,
      vehicle_model: veh.model,
      vehicle_type: veh.body_style,
      vehicle_cost: vehicleCost,
      new_used: "Used" as const,
      trade_year: hasTrade ? rand(2010, 2022) : null,
      trade_make: tradeMake,
      trade_model: tradeModel,
      trade_type: hasTrade ? pick(BODY_STYLES) : null,
      trade_mileage: hasTrade ? rand(40000, 160000) : null,
      trade_acv: tradeAcv,
      trade_payoff: hasTrade && Math.random() < 0.5 ? rand(1000, tradeAcv!) : null,
      salesperson: sp,
      salesperson_pct: spPct,
      second_salesperson: sp2,
      second_sp_pct: sp2Pct,
      selling_price: sellingPrice,
      front_gross: frontGross,
      lender: pick(lenderRows).name,
      rate: money(3, 12),
      finance_type: pick(["retail", "retail", "retail", "cash", "lease"]) as
        | "retail"
        | "cash"
        | "lease",
      reserve: Math.round(reserve * 100) / 100,
      warranty: Math.round(warranty * 100) / 100,
      gap: Math.round(gap * 100) / 100,
      aftermarket_1: Math.round(am1 * 100) / 100,
      aftermarket_2: Math.round(am2 * 100) / 100,
      doc_fee: docFee,
      fi_total: fiTotal,
      back_gross: backGross,
      total_gross: totalGross,
      pvr,
      is_washout: isWashout,
      washout_amount: isWashout ? totalGross : null,
      source: pick(SOURCES),
      funded: Math.random() < 0.7,
      status: (Math.random() < 0.7 ? "funded" : "pending") as
        | "funded"
        | "pending",
    });
  }

  for (let i = 0; i < deals.length; i += 10) {
    const chunk = deals.slice(i, i + 10);
    const { error } = await supabase.from("sales_deals").insert(chunk);
    if (error) throw error;
  }
  console.log(`💰 Deals: ${deals.length}`);

  // 9. Mail Tracking (12 zip codes)
  const mailRows = ZIP_CODES.map((z) => {
    const pieces = rand(2000, 5000);
    const days = Array.from({ length: 12 }, () => rand(0, 15));
    const totalResp = days.reduce((s, d) => s + d, 0);
    return {
      event_id: eventId,
      zip_code: z.zip,
      town: z.town,
      pieces_sent: pieces,
      day_1: days[0],
      day_2: days[1],
      day_3: days[2],
      day_4: days[3],
      day_5: days[4],
      day_6: days[5],
      day_7: days[6],
      day_8: days[7],
      day_9: days[8],
      day_10: days[9],
      day_11: days[10],
      day_12: days[11],
      total_responses: totalResp,
      response_rate: pieces > 0 ? Math.round((totalResp / pieces) * 10000) / 10000 : 0,
      sold_from_mail: rand(0, Math.min(5, totalResp)),
    };
  });
  const { error: mailErr } = await supabase
    .from("mail_tracking")
    .insert(mailRows);
  if (mailErr) throw mailErr;
  console.log(`📬 Mail tracking: ${mailRows.length} zip codes`);

  // 10. Daily Metrics (5 days)
  const dailyRows = [];
  for (let day = 1; day <= 5; day++) {
    const dayDeals = deals.filter((d) => d.sale_day === day);
    dailyRows.push({
      event_id: eventId,
      sale_day: day,
      sale_date: `2026-02-${String(22 + day).padStart(2, "0")}`,
      total_ups: dayDeals.length + rand(5, 20),
      total_sold: dayDeals.length,
      total_gross: dayDeals.reduce((s, d) => s + d.total_gross, 0),
      total_front: dayDeals.reduce((s, d) => s + d.front_gross, 0),
      total_back: dayDeals.reduce((s, d) => s + d.back_gross, 0),
    });
  }
  const { error: dailyErr } = await supabase
    .from("daily_metrics")
    .insert(dailyRows);
  if (dailyErr) throw dailyErr;
  console.log(`📊 Daily metrics: ${dailyRows.length} days`);

  // Done
  console.log("\n✅ Seed complete!");
  console.log(`   Event ID: ${eventId}`);
  console.log(`   Slug: ${slug}`);
  console.log(
    `   Summary: ${vehicles.length} vehicles, ${deals.length} deals, ${rosterData.length} roster, ${lenderRows.length} lenders, ${mailRows.length} mail zones, ${dailyRows.length} daily metrics`,
  );
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
