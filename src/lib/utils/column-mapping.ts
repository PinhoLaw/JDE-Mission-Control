/**
 * column-mapping.ts
 * =================
 * Shared column mapping constants, auto-mappers, and tab detection for all
 * importable tab types: Inventory, Roster, Deals, and Lenders.
 *
 * This is a pure utility module — no "use server" / "use client" directives.
 * Importable from both server actions and client components.
 */

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export type TabType = "inventory" | "roster" | "deals" | "lenders" | "unknown";

export interface FieldDef {
  value: string;
  label: string;
}

// ────────────────────────────────────────────────────────
// Tab Detection
// ────────────────────────────────────────────────────────

/**
 * Detect the tab type from a sheet/tab name using keyword matching.
 */
export function detectTabType(sheetName: string): TabType {
  const lower = sheetName.toLowerCase().trim();

  // Order matters — check more specific patterns first
  if (
    lower.includes("deal") ||
    lower.includes("deal log") ||
    lower === "sales" ||
    lower.includes("sales log")
  ) {
    return "deals";
  }
  if (
    lower.includes("lender") ||
    lower.includes("finance") ||
    lower.includes("bank")
  ) {
    return "lenders";
  }
  if (
    lower.includes("roster") ||
    lower.includes("tables") ||
    lower.includes("salespeople") ||
    lower.includes("personnel") ||
    lower.includes("staff") ||
    lower.includes("team")
  ) {
    return "roster";
  }
  if (
    lower.includes("inventory") ||
    lower.includes("stock") ||
    lower.includes("vehicle") ||
    lower.includes("units") ||
    lower.includes("cars")
  ) {
    return "inventory";
  }
  return "unknown";
}

/**
 * Legacy helper — detect if a sheet name is a roster sheet.
 * Used by the existing inventory import page.
 */
export function isRosterSheet(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("roster") || lower.includes("tables");
}

// ────────────────────────────────────────────────────────
// Inventory Fields & Auto-Mapper
// ────────────────────────────────────────────────────────

export const DB_FIELDS: FieldDef[] = [
  { value: "__skip__", label: "— Skip —" },
  { value: "hat_number", label: "Hat #" },
  { value: "stock_number", label: "Stock #" },
  { value: "vin", label: "VIN" },
  { value: "year", label: "Year" },
  { value: "make", label: "Make" },
  { value: "model", label: "Model" },
  { value: "trim", label: "Trim" },
  { value: "body_style", label: "Body Style" },
  { value: "color", label: "Color" },
  { value: "mileage", label: "Mileage" },
  { value: "age_days", label: "Age (days)" },
  { value: "drivetrain", label: "Drivetrain" },
  { value: "acquisition_cost", label: "Acquisition Cost" },
  { value: "jd_trade_clean", label: "JD Trade Clean" },
  { value: "jd_retail_clean", label: "JD Retail Clean" },
  { value: "asking_price_115", label: "Ask 115%" },
  { value: "asking_price_120", label: "Ask 120%" },
  { value: "asking_price_125", label: "Ask 125%" },
  { value: "asking_price_130", label: "Ask 130%" },
  { value: "profit_115", label: "Profit 115%" },
  { value: "profit_120", label: "Profit 120%" },
  { value: "profit_125", label: "Profit 125%" },
  { value: "profit_130", label: "Profit 130%" },
  { value: "retail_spread", label: "Retail Spread" },
  { value: "label", label: "Label" },
  { value: "notes", label: "Notes" },
];

/**
 * Best-effort auto-mapping from header text to inventory DB field.
 */
export function autoMapColumn(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  const exactMap: Record<string, string> = {
    hat: "hat_number", hatnumber: "hat_number", hatno: "hat_number",
    stock: "stock_number", stocknumber: "stock_number", stockno: "stock_number",
    stk: "stock_number", stkno: "stock_number",
    vin: "vin", vin7: "__skip__", vinno: "vin", vinnumber: "vin",
    year: "year", yr: "year",
    make: "make",
    model: "model",
    trim: "trim", series: "trim", trimlevel: "trim",
    bodystyle: "body_style", body: "body_style", class: "body_style",
    bodytype: "body_style", style: "body_style",
    color: "color", ext: "color", extcolor: "color", exteriorcolor: "color",
    mileage: "mileage", miles: "mileage", odometer: "mileage", odo: "mileage",
    odometerreading: "mileage",
    type: "drivetrain",
    age: "age_days", agedays: "age_days", days: "age_days", ageday: "age_days",
    drivetrain: "drivetrain", drive: "drivetrain", drivetraintype: "drivetrain",
    drivetype: "drivetrain",
    cost: "acquisition_cost", acqcost: "acquisition_cost",
    acquisitioncost: "acquisition_cost", unitcost: "acquisition_cost",
    acvcost: "acquisition_cost", dealercost: "acquisition_cost",
    jdtradeclean: "jd_trade_clean", tradeclean: "jd_trade_clean",
    jdtrade: "jd_trade_clean", cleantrade: "jd_trade_clean",
    jdpowertradeinclean: "jd_trade_clean", jdpowertradeclean: "jd_trade_clean",
    tradein: "jd_trade_clean", tradeinclean: "jd_trade_clean",
    jdpowerretailclean: "jd_retail_clean", retailclean: "jd_retail_clean",
    jdretail: "jd_retail_clean", cleanretail: "jd_retail_clean",
    jdpowerretail: "jd_retail_clean", retail: "jd_retail_clean",
    ask115: "asking_price_115", price115: "asking_price_115", "115": "asking_price_115",
    ask120: "asking_price_120", price120: "asking_price_120", "120": "asking_price_120",
    ask125: "asking_price_125", price125: "asking_price_125", "125": "asking_price_125",
    ask130: "asking_price_130", price130: "asking_price_130", "130": "asking_price_130",
    profit115: "profit_115", profit120: "profit_120",
    profit125: "profit_125", profit130: "profit_130",
    retailspread: "retail_spread", spread: "retail_spread", diff: "retail_spread",
    label: "label", status: "label", location: "__skip__",
    notes: "notes", note: "notes",
  };

  if (exactMap[h]) return exactMap[h];

  // Substring / fuzzy matches for common header variations
  const raw = header.toLowerCase().trim();
  if (raw.includes("stock") && (raw.includes("#") || raw.includes("no") || raw.includes("num"))) return "stock_number";
  if (raw.includes("stk") && (raw.includes("#") || raw.includes("no"))) return "stock_number";
  if (raw.includes("vin") && (raw.includes("#") || raw.includes("no"))) return "vin";
  if (raw.includes("unit") && raw.includes("cost")) return "acquisition_cost";
  if (raw.includes("acq") && raw.includes("cost")) return "acquisition_cost";
  if (raw.includes("dealer") && raw.includes("cost")) return "acquisition_cost";
  if (raw.includes("j.d.") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("j.d.") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("jd") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("jd") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("power") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("power") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("clean") && raw.includes("trade")) return "jd_trade_clean";
  if (raw.includes("clean") && raw.includes("retail")) return "jd_retail_clean";
  if (raw.includes("trade") && raw.includes("in") && raw.includes("clean")) return "jd_trade_clean";
  if (raw.includes("115") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_115";
  if (raw.includes("120") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_120";
  if (raw.includes("125") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_125";
  if (raw.includes("130") && (raw.includes("%") || raw.includes("ask"))) return "asking_price_130";
  if (raw.includes("odometer")) return "mileage";
  if (raw.includes("ext") && raw.includes("color")) return "color";
  if (raw.includes("body") && (raw.includes("style") || raw.includes("type"))) return "body_style";
  if (raw.includes("age") && (raw.includes("day") || raw.includes("lot"))) return "age_days";
  if (raw.includes("trim") && raw.includes("level")) return "trim";

  return "__skip__";
}

// ────────────────────────────────────────────────────────
// Roster Fields & Auto-Mapper
// ────────────────────────────────────────────────────────

export const ROSTER_DB_FIELDS: FieldDef[] = [
  { value: "__skip__", label: "— Skip —" },
  { value: "name", label: "Name" },
  { value: "phone", label: "Phone" },
  { value: "confirmed", label: "Confirmed?" },
  { value: "role", label: "Role" },
  { value: "setup", label: "Setup (notes)" },
  { value: "according_to", label: "According To (notes)" },
  { value: "lenders", label: "Lenders (notes)" },
  { value: "drivetrain", label: "Drivetrain (notes)" },
];

/**
 * Best-effort auto-mapping from header text to roster DB field.
 */
export function autoMapRosterColumn(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    salespeople: "name", salesperson: "name", name: "name", sales: "name", people: "name",
    phone: "phone", cell: "phone", mobile: "phone", phonenumber: "phone",
    confirmed: "confirmed", confirm: "confirmed",
    setup: "setup",
    accordingto: "according_to", accordingtowho: "according_to",
    lenders: "lenders", lender: "lenders",
    drivetrain: "drivetrain", drive: "drivetrain",
    role: "role", position: "role", title: "role",
  };
  return map[h] ?? "__skip__";
}

// ────────────────────────────────────────────────────────
// Deal Fields & Auto-Mapper
// ────────────────────────────────────────────────────────

export const DEAL_DB_FIELDS: FieldDef[] = [
  { value: "__skip__", label: "— Skip —" },
  { value: "deal_number", label: "Deal #" },
  { value: "sale_day", label: "Sale Day" },
  { value: "sale_date", label: "Sale Date" },
  { value: "customer_name", label: "Customer Name" },
  { value: "customer_zip", label: "Customer Zip" },
  { value: "customer_phone", label: "Customer Phone" },
  { value: "stock_number", label: "Stock #" },
  { value: "vehicle_year", label: "Vehicle Year" },
  { value: "vehicle_make", label: "Vehicle Make" },
  { value: "vehicle_model", label: "Vehicle Model" },
  { value: "vehicle_type", label: "Vehicle Type" },
  { value: "vehicle_cost", label: "Vehicle Cost" },
  { value: "new_used", label: "New/Used" },
  { value: "trade_year", label: "Trade Year" },
  { value: "trade_make", label: "Trade Make" },
  { value: "trade_model", label: "Trade Model" },
  { value: "trade_type", label: "Trade Type" },
  { value: "trade_mileage", label: "Trade Mileage" },
  { value: "trade_acv", label: "Trade ACV" },
  { value: "trade_payoff", label: "Trade Payoff" },
  { value: "salesperson", label: "Salesperson" },
  { value: "salesperson_pct", label: "SP Commission %" },
  { value: "second_salesperson", label: "2nd Salesperson" },
  { value: "second_sp_pct", label: "2nd SP Commission %" },
  { value: "selling_price", label: "Selling Price" },
  { value: "front_gross", label: "Front Gross" },
  { value: "lender", label: "Lender" },
  { value: "rate", label: "Rate" },
  { value: "finance_type", label: "Finance Type" },
  { value: "reserve", label: "Reserve" },
  { value: "warranty", label: "Warranty" },
  { value: "gap", label: "GAP" },
  { value: "aftermarket_1", label: "Aftermarket 1" },
  { value: "aftermarket_2", label: "Aftermarket 2" },
  { value: "doc_fee", label: "Doc Fee" },
  { value: "source", label: "Source" },
  { value: "notes", label: "Notes" },
];

/**
 * Best-effort auto-mapping from header text to deal DB field.
 */
export function autoMapDealColumn(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  const exactMap: Record<string, string> = {
    // Deal / sale identification
    deal: "deal_number", dealno: "deal_number", dealnumber: "deal_number",
    dealnum: "deal_number", "deal#": "deal_number",
    saleday: "sale_day", day: "sale_day",
    saledate: "sale_date", date: "sale_date", solddate: "sale_date",
    // Customer
    customer: "customer_name", customername: "customer_name",
    buyer: "customer_name", buyername: "customer_name", name: "customer_name",
    customerzip: "customer_zip", zip: "customer_zip", zipcode: "customer_zip",
    customerphone: "customer_phone", phone: "customer_phone",
    // Vehicle identification
    stock: "stock_number", stocknumber: "stock_number", stockno: "stock_number",
    stk: "stock_number", stkno: "stock_number",
    year: "vehicle_year", vehicleyear: "vehicle_year", yr: "vehicle_year",
    make: "vehicle_make", vehiclemake: "vehicle_make",
    model: "vehicle_model", vehiclemodel: "vehicle_model",
    vehicletype: "vehicle_type", type: "vehicle_type",
    vehiclecost: "vehicle_cost", cost: "vehicle_cost", unitcost: "vehicle_cost",
    acv: "vehicle_cost",
    newused: "new_used", condition: "new_used", newvused: "new_used",
    nu: "new_used",
    // Trade
    tradeyear: "trade_year", tradeyr: "trade_year",
    trademake: "trade_make",
    trademodel: "trade_model",
    tradetype: "trade_type",
    trademileage: "trade_mileage", trademiles: "trade_mileage",
    tradeacv: "trade_acv", tradevalue: "trade_acv", tradein: "trade_acv",
    tradepayoff: "trade_payoff", payoff: "trade_payoff", owedontrade: "trade_payoff",
    // Salesperson
    salesperson: "salesperson", sp: "salesperson", salesrep: "salesperson",
    rep: "salesperson", soldby: "salesperson",
    salespersonpct: "salesperson_pct", sppct: "salesperson_pct",
    spcommission: "salesperson_pct",
    secondsalesperson: "second_salesperson", sp2: "second_salesperson",
    secondsp: "second_salesperson", "2ndsp": "second_salesperson",
    secondsppct: "second_sp_pct", sp2pct: "second_sp_pct",
    // Pricing
    sellingprice: "selling_price", saleprice: "selling_price",
    price: "selling_price", sellprice: "selling_price",
    frontgross: "front_gross", front: "front_gross", feg: "front_gross",
    // Finance
    lender: "lender", lendername: "lender", bank: "lender",
    financesource: "lender",
    rate: "rate", apr: "rate", interestrate: "rate", buyrate: "rate",
    financetype: "finance_type", fintype: "finance_type",
    dealtype: "finance_type",
    reserve: "reserve", finreserve: "reserve",
    warranty: "warranty", vsc: "warranty", servicecontract: "warranty",
    gap: "gap", gapinsurance: "gap",
    aftermarket1: "aftermarket_1", aftermarket: "aftermarket_1",
    am1: "aftermarket_1", accessories: "aftermarket_1",
    aftermarket2: "aftermarket_2", am2: "aftermarket_2",
    docfee: "doc_fee", doc: "doc_fee", documentfee: "doc_fee",
    // Meta
    source: "source", leadsource: "source",
    notes: "notes", note: "notes", comments: "notes",
  };

  if (exactMap[h]) return exactMap[h];

  // Fuzzy / substring matches
  const raw = header.toLowerCase().trim();
  if (raw.includes("deal") && (raw.includes("#") || raw.includes("no") || raw.includes("num"))) return "deal_number";
  if (raw.includes("stock") && (raw.includes("#") || raw.includes("no") || raw.includes("num"))) return "stock_number";
  if (raw.includes("customer") && raw.includes("name")) return "customer_name";
  if (raw.includes("buyer") && raw.includes("name")) return "customer_name";
  if (raw.includes("sale") && raw.includes("date")) return "sale_date";
  if (raw.includes("sale") && raw.includes("day")) return "sale_day";
  if (raw.includes("sell") && raw.includes("price")) return "selling_price";
  if (raw.includes("sale") && raw.includes("price")) return "selling_price";
  if (raw.includes("front") && raw.includes("gross")) return "front_gross";
  if (raw.includes("vehicle") && raw.includes("cost")) return "vehicle_cost";
  if (raw.includes("unit") && raw.includes("cost")) return "vehicle_cost";
  if (raw.includes("trade") && raw.includes("acv")) return "trade_acv";
  if (raw.includes("trade") && raw.includes("value")) return "trade_acv";
  if (raw.includes("trade") && raw.includes("payoff")) return "trade_payoff";
  if (raw.includes("trade") && raw.includes("year")) return "trade_year";
  if (raw.includes("trade") && raw.includes("make")) return "trade_make";
  if (raw.includes("trade") && raw.includes("model")) return "trade_model";
  if (raw.includes("trade") && raw.includes("mile")) return "trade_mileage";
  if (raw.includes("new") && raw.includes("used")) return "new_used";
  if (raw.includes("finance") && raw.includes("type")) return "finance_type";
  if (raw.includes("interest") && raw.includes("rate")) return "rate";
  if (raw.includes("doc") && raw.includes("fee")) return "doc_fee";
  if (raw.includes("service") && raw.includes("contract")) return "warranty";
  if (raw.includes("aftermarket") || raw.includes("after market")) return "aftermarket_1";
  if (raw.includes("lead") && raw.includes("source")) return "source";
  if (raw.includes("sold") && raw.includes("by")) return "salesperson";
  if (raw.includes("sales") && raw.includes("rep")) return "salesperson";
  if (raw.includes("2nd") && raw.includes("sp")) return "second_salesperson";

  return "__skip__";
}

// ────────────────────────────────────────────────────────
// Lender Fields & Auto-Mapper
// ────────────────────────────────────────────────────────

export const LENDER_DB_FIELDS: FieldDef[] = [
  { value: "__skip__", label: "— Skip —" },
  { value: "name", label: "Lender Name" },
  { value: "buy_rate_pct", label: "Buy Rate %" },
  { value: "max_advance", label: "Max Advance" },
  { value: "notes", label: "Notes" },
];

/**
 * Best-effort auto-mapping from header text to lender DB field.
 */
export function autoMapLenderColumn(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  const exactMap: Record<string, string> = {
    name: "name", lender: "name", lendername: "name",
    bank: "name", bankname: "name", financesource: "name",
    buyrate: "buy_rate_pct", buyratepct: "buy_rate_pct",
    rate: "buy_rate_pct", interestrate: "buy_rate_pct",
    apr: "buy_rate_pct", baserate: "buy_rate_pct",
    maxadvance: "max_advance", advance: "max_advance",
    maxloan: "max_advance", loanlimit: "max_advance",
    maxfinance: "max_advance", limit: "max_advance",
    notes: "notes", note: "notes", comments: "notes",
  };

  if (exactMap[h]) return exactMap[h];

  const raw = header.toLowerCase().trim();
  if (raw.includes("lender") && raw.includes("name")) return "name";
  if (raw.includes("bank") && raw.includes("name")) return "name";
  if (raw.includes("buy") && raw.includes("rate")) return "buy_rate_pct";
  if (raw.includes("max") && raw.includes("advance")) return "max_advance";
  if (raw.includes("max") && raw.includes("loan")) return "max_advance";
  if (raw.includes("loan") && raw.includes("limit")) return "max_advance";

  return "__skip__";
}

// ────────────────────────────────────────────────────────
// Dynamic lookups by TabType
// ────────────────────────────────────────────────────────

/**
 * Returns the correct field definitions for a given tab type.
 */
export function getFieldsForType(tabType: TabType): FieldDef[] {
  switch (tabType) {
    case "inventory": return DB_FIELDS;
    case "roster": return ROSTER_DB_FIELDS;
    case "deals": return DEAL_DB_FIELDS;
    case "lenders": return LENDER_DB_FIELDS;
    default: return [];
  }
}

/**
 * Returns the correct auto-mapper function for a given tab type.
 */
export function getMapperForType(tabType: TabType): (header: string) => string {
  switch (tabType) {
    case "inventory": return autoMapColumn;
    case "roster": return autoMapRosterColumn;
    case "deals": return autoMapDealColumn;
    case "lenders": return autoMapLenderColumn;
    default: return () => "__skip__";
  }
}
