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

export type TabType = "inventory" | "roster" | "deals" | "lenders" | "campaigns" | "unknown";

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

  // ── Exclusions: skip sheets that look like summaries / internal tools ──
  // "Dealer Recap", "Salesperson Washout", "Washout", "Pay Calc", etc.
  if (
    lower.includes("recap") ||
    lower.includes("washout") ||
    lower.includes("pay calc") ||
    lower.includes("commission") ||
    lower.includes("performance") ||
    lower.includes("chart") ||
    lower.includes("data") ||
    lower.includes("fix") ||
    lower.includes("chargeback") ||
    lower.includes("rollup") ||
    lower.includes("credential") ||
    lower.includes("information") ||
    lower.includes("zip code") ||
    /^day\s*\d+$/i.test(lower) ||
    /^sheet\d+$/i.test(lower)
  ) {
    return "unknown";
  }

  // Order matters — check more specific patterns first
  if (
    lower.includes("mail") ||
    lower.includes("campaign") ||
    lower.includes("traffic") ||
    lower.includes("mailer")
  ) {
    return "campaigns";
  }

  // "Deal Log" but NOT "Dealer" (Dealer Recap already excluded above)
  if (
    lower.includes("deal log") ||
    lower === "deal log" ||
    lower === "deals" ||
    lower === "sales" ||
    lower.includes("sales log")
  ) {
    return "deals";
  }

  // Roster check BEFORE lenders — "Roster & Lenders" should be roster
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
    lower.includes("lender") ||
    lower.includes("finance") ||
    lower.includes("bank")
  ) {
    return "lenders";
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
// Content-Aware Tab Detection (from headers)
// ────────────────────────────────────────────────────────

/**
 * Header fingerprints — characteristic header keywords that strongly
 * indicate a specific tab type. Each signal group matches if ANY keyword
 * appears as a substring in ANY header.
 */
const TAB_TYPE_HEADER_SIGNALS: Record<Exclude<TabType, "unknown">, string[][]> = {
  deals: [
    ["customer", "buyer"],
    ["front gross", "front", "feg"],
    ["selling price", "sale price"],
    ["deal", "store"],
    ["lender", "bank"],
    ["reserve"],
    ["warranty", "vsc"],
    ["gap"],
    ["trade"],
    ["salesperson", "sp", "rep", "sold by"],
  ],
  inventory: [
    ["stock", "stk"],
    ["vin"],
    ["mileage", "miles", "odometer"],
    ["acquisition", "unit cost", "dealer cost"],
    ["jd", "power", "trade clean", "retail clean"],
    ["asking", "115%", "120%", "125%", "130%"],
    ["hat"],
    ["color", "ext color"],
    ["body style", "body type"],
    ["trim", "series"],
  ],
  roster: [
    ["salespeople", "salesperson", "personnel", "staff"],
    ["phone", "cell", "mobile"],
    ["confirmed", "confirm"],
    ["setup"],
    ["role", "position", "title"],
  ],
  lenders: [
    ["lender", "bank", "finance source"],
    ["buy rate", "rate", "apr"],
    ["max advance", "advance", "loan limit"],
  ],
  campaigns: [
    ["zip", "postal", "zip code"],
    ["pieces", "sent", "mailed"],
    ["town", "city"],
    ["day 1", "day 2", "day 3"],
    ["total responses", "responses"],
  ],
};

/**
 * Detect tab type from column headers when sheet name detection fails.
 * Scores each tab type by counting how many header signal groups match.
 */
export function detectTabTypeFromHeaders(headers: string[]): {
  tabType: TabType;
  score: number;
  maxPossible: number;
} {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  let bestType: TabType = "unknown";
  let bestScore = 0;
  let bestMax = 0;

  for (const [type, signals] of Object.entries(TAB_TYPE_HEADER_SIGNALS)) {
    let score = 0;
    for (const signalGroup of signals) {
      const matched = lowerHeaders.some((header) =>
        signalGroup.some((keyword) => header.includes(keyword)),
      );
      if (matched) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestType = type as TabType;
      bestMax = signals.length;
    }
  }

  // Require at least 30% of signals AND at least 2 matches
  const threshold = bestMax * 0.3;
  if (bestScore < threshold || bestScore < 2) {
    return { tabType: "unknown", score: 0, maxPossible: 0 };
  }

  return { tabType: bestType as TabType, score: bestScore, maxPossible: bestMax };
}

// ────────────────────────────────────────────────────────
// Confidence Scoring
// ────────────────────────────────────────────────────────

/** Required / important fields per tab type for confidence calculation. */
const REQUIRED_FIELDS_MAP: Record<Exclude<TabType, "unknown">, string[]> = {
  inventory: ["stock_number", "year", "make", "model"],
  roster: ["name"],
  deals: ["customer_name", "stock_number"],
  lenders: ["name"],
  campaigns: ["zip_code"],
};

export interface MappingConfidence {
  /** 0-100 score: percentage of columns mapped to a real DB field */
  score: number;
  /** Number of columns mapped to a real DB field (not __skip__) */
  mappedCount: number;
  /** Total number of spreadsheet columns */
  totalColumns: number;
  /** Whether all required fields for this tab type are mapped */
  requiredFieldsMapped: boolean;
  /** List of required fields that are missing */
  missingRequired: string[];
  /** True if confidence >= 80% AND all required fields present */
  autoReady: boolean;
}

/**
 * Compute a confidence score for the current column mapping.
 */
export function computeMappingConfidence(
  columnMap: Record<string, string>,
  tabType: TabType,
): MappingConfidence {
  if (tabType === "unknown") {
    return {
      score: 0,
      mappedCount: 0,
      totalColumns: Object.keys(columnMap).length,
      requiredFieldsMapped: false,
      missingRequired: [],
      autoReady: false,
    };
  }

  const entries = Object.entries(columnMap);
  const totalColumns = entries.length;
  const mappedCount = entries.filter(
    ([, v]) => v && v !== "__skip__",
  ).length;

  const score =
    totalColumns > 0 ? Math.round((mappedCount / totalColumns) * 100) : 0;

  // Check required fields
  const mappedFields = new Set(
    entries.map(([, v]) => v).filter((v) => v && v !== "__skip__"),
  );
  const required = REQUIRED_FIELDS_MAP[tabType] ?? [];
  const missingRequired = required.filter((f) => !mappedFields.has(f));
  const requiredFieldsMapped = missingRequired.length === 0;

  const autoReady = score >= 80 && requiredFieldsMapped;

  return {
    score,
    mappedCount,
    totalColumns,
    requiredFieldsMapped,
    missingRequired,
    autoReady,
  };
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
  { value: "location", label: "Location" },
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
    difference: "retail_spread",
    label: "label", status: "label",
    location: "location", vehlocation: "location", vehiclelocation: "location",
    keylocation: "__skip__",
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
  { value: "vehicle_age", label: "Vehicle Age" },
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
    store: "deal_number",
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
    // Vehicle age (days on lot)
    age: "vehicle_age", vehicleage: "vehicle_age", lotdays: "vehicle_age",
    agedays: "vehicle_age",
    newused: "new_used", condition: "new_used", newvused: "new_used",
    nu: "new_used",
    // Trade — single-word headers in trade position
    acv: "trade_acv",
    miles: "trade_mileage",
    payoff: "trade_payoff", owedontrade: "trade_payoff",
    payof: "trade_payoff",
    // Trade — prefixed headers
    tradeyear: "trade_year", tradeyr: "trade_year",
    trademake: "trade_make",
    trademodel: "trade_model",
    tradetype: "trade_type",
    trademileage: "trade_mileage", trademiles: "trade_mileage",
    tradeacv: "trade_acv", tradevalue: "trade_acv", tradein: "trade_acv",
    tradepayoff: "trade_payoff",
    // Trade — deduplicated headers (YEAR_2, MAKE_2, MODEL_2 from duplicate header detection)
    year2: "trade_year", yr2: "trade_year",
    make2: "trade_make",
    model2: "trade_model",
    // Salesperson
    salesperson: "salesperson", sp: "salesperson", salesrep: "salesperson",
    rep: "salesperson", soldby: "salesperson",
    "1strep": "salesperson", firstrep: "salesperson",
    salespersonpct: "salesperson_pct", sppct: "salesperson_pct",
    spcommission: "salesperson_pct",
    secondsalesperson: "second_salesperson", sp2: "second_salesperson",
    secondsp: "second_salesperson", "2ndsp": "second_salesperson",
    "2ndsalesperson": "second_salesperson",
    "2ndrep": "second_salesperson", secondrep: "second_salesperson",
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
    aft1: "aftermarket_1", aft: "aftermarket_1",
    aftermarket2: "aftermarket_2", am2: "aftermarket_2",
    aft2: "aftermarket_2",
    docfee: "doc_fee", doc: "doc_fee", documentfee: "doc_fee",
    // Meta
    source: "source", leadsource: "source",
    notes: "notes", note: "notes", comments: "notes",
    workdone: "notes",
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
  if (raw.includes("vehicle") && raw.includes("age")) return "vehicle_age";
  if (raw.includes("lot") && raw.includes("day")) return "vehicle_age";
  if (raw.includes("sold") && raw.includes("by")) return "salesperson";
  if (raw.includes("sales") && raw.includes("rep")) return "salesperson";
  if (raw.includes("1st") && raw.includes("rep")) return "salesperson";
  if (raw.includes("2nd") && raw.includes("sp")) return "second_salesperson";
  if (raw.includes("2nd") && raw.includes("rep")) return "second_salesperson";

  // Handle deduped header suffixes: "YEAR_2" → trade_year, "MAKE_2" → trade_make, etc.
  const dedupMatch = raw.match(/^(.+?)[\s_]+(\d+)$/);
  if (dedupMatch) {
    const base = dedupMatch[1].trim();
    const suffix = parseInt(dedupMatch[2]);
    if (suffix === 2) {
      // Second occurrence → trade fields
      if (base === "year" || base === "yr") return "trade_year";
      if (base === "make") return "trade_make";
      if (base === "model") return "trade_model";
      if (base === "type") return "trade_type";
      if (base === "miles" || base === "mileage") return "trade_mileage";
      if (base === "acv") return "trade_acv";
    }
  }

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
// Campaigns (Mail Tracking) Fields & Auto-Mapper
// ────────────────────────────────────────────────────────

export const CAMPAIGNS_DB_FIELDS: FieldDef[] = [
  { value: "__skip__", label: "— Skip —" },
  { value: "zip_code", label: "Zip Code" },
  { value: "town", label: "Town" },
  { value: "pieces_sent", label: "Pieces Sent" },
  { value: "day_1", label: "Day 1" },
  { value: "day_2", label: "Day 2" },
  { value: "day_3", label: "Day 3" },
  { value: "day_4", label: "Day 4" },
  { value: "day_5", label: "Day 5" },
  { value: "day_6", label: "Day 6" },
  { value: "day_7", label: "Day 7" },
  { value: "day_8", label: "Day 8" },
  { value: "day_9", label: "Day 9" },
  { value: "day_10", label: "Day 10" },
  { value: "day_11", label: "Day 11" },
  { value: "day_12", label: "Day 12" },
  { value: "total_responses", label: "Total Responses" },
  { value: "sold_from_mail", label: "# Sold" },
  { value: "gross_from_mail", label: "Gross per ZIP" },
];

/**
 * Best-effort auto-mapping from header text to mail_tracking DB field.
 */
export function autoMapCampaignsColumn(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  const exactMap: Record<string, string> = {
    zip: "zip_code", zipcode: "zip_code", zipcodes: "zip_code",
    postalcode: "zip_code", postal: "zip_code",
    town: "town", city: "town", townname: "town", cityname: "town",
    area: "town", municipality: "town",
    pieces: "pieces_sent", piecessent: "pieces_sent", mailpieces: "pieces_sent",
    qty: "pieces_sent", quantity: "pieces_sent", count: "pieces_sent",
    sent: "pieces_sent", mailed: "pieces_sent", total: "pieces_sent",
    totalpieces: "pieces_sent",
    day1: "day_1", d1: "day_1", "1": "day_1",
    day2: "day_2", d2: "day_2", "2": "day_2",
    day3: "day_3", d3: "day_3", "3": "day_3",
    day4: "day_4", d4: "day_4", "4": "day_4",
    day5: "day_5", d5: "day_5", "5": "day_5",
    day6: "day_6", d6: "day_6", "6": "day_6",
    day7: "day_7", d7: "day_7", "7": "day_7",
    day8: "day_8", d8: "day_8", "8": "day_8",
    day9: "day_9", d9: "day_9", "9": "day_9",
    day10: "day_10", d10: "day_10", "10": "day_10",
    day11: "day_11", d11: "day_11", "11": "day_11",
    day12: "day_12", d12: "day_12", "12": "day_12",
    totalresponses: "total_responses", responses: "total_responses",
    totalresp: "total_responses", resp: "total_responses",
    ziptotalups: "total_responses", totalups: "total_responses",
    ziptotal: "total_responses",
    // # SOLD column (column E in standardized format)
    sold: "sold_from_mail", numsold: "sold_from_mail",
    soldfrommail: "sold_from_mail", soldmail: "sold_from_mail",
    // Gross per ZIP
    grossperzip: "gross_from_mail", grossperzipcode: "gross_from_mail",
    grosszip: "gross_from_mail", gross: "gross_from_mail",
    grossfrommail: "gross_from_mail", totalgross: "gross_from_mail",
  };

  if (exactMap[h]) return exactMap[h];

  const raw = header.toLowerCase().trim();
  if (raw.includes("zip") && (raw.includes("code") || raw.includes("#"))) return "zip_code";
  if (raw.includes("pieces") && raw.includes("sent")) return "pieces_sent";
  if (raw.includes("mail") && raw.includes("piece")) return "pieces_sent";
  if (raw.includes("total") && raw.includes("resp")) return "total_responses";
  if (raw.includes("total") && raw.includes("show")) return "total_responses";
  // "# SOLD" or "SOLD" — map to sold_from_mail
  if (raw.includes("sold")) return "sold_from_mail";
  // "Gross per ZIP" — map to gross_from_mail
  if (raw.includes("gross") && raw.includes("zip")) return "gross_from_mail";
  // "CLOSING %" or "CLOSE RATE" — skip (computed field)
  if (raw.includes("closing") || raw.includes("close")) return "__skip__";

  // Match "Day X" patterns dynamically
  const dayMatch = raw.match(/day\s*(\d{1,2})/);
  if (dayMatch) {
    const num = parseInt(dayMatch[1]);
    if (num >= 1 && num <= 12) return `day_${num}`;
  }

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
    case "campaigns": return CAMPAIGNS_DB_FIELDS;
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
    case "campaigns": return autoMapCampaignsColumn;
    default: return () => "__skip__";
  }
}
