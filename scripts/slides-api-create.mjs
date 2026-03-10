import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCredentials() {
  const envPath = resolve(__dirname, "../.env.local");
  const env = readFileSync(envPath, "utf8");
  const key = "GOOGLE_SERVICE_ACCOUNT_JSON=";
  const startIdx = env.indexOf(key);
  if (startIdx === -1) throw new Error("Not found");
  const jsonStart = startIdx + key.length;
  let braceCount = 0, endIdx = jsonStart;
  for (let i = jsonStart; i < env.length; i++) {
    if (env[i] === "{") braceCount++;
    if (env[i] === "}") braceCount--;
    if (braceCount === 0) { endIdx = i + 1; break; }
  }
  return JSON.parse(env.slice(jsonStart, endIdx));
}

async function main() {
  const creds = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  const slides = google.slides({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  // Step 1: Create empty presentation via Slides API
  console.log("📝 Creating presentation via Slides API...");
  const pres = await slides.presentations.create({
    requestBody: { title: "JDE Mission Control — Dashboard Guide" },
  });
  const presId = pres.data.presentationId;
  console.log(`✅ Created: ${presId}`);

  // Step 2: Share it
  console.log("🔗 Setting sharing...");
  await drive.permissions.create({
    fileId: presId,
    requestBody: { role: "writer", type: "anyone" },
  });

  const url = `https://docs.google.com/presentation/d/${presId}/edit`;
  console.log("\n" + "═".repeat(70));
  console.log("🎉 Presentation created and shared:");
  console.log(`\n   ${url}\n`);
  console.log("═".repeat(70));
  console.log("\nNow building slides...");

  // Step 3: Build all slide content
  // We'll add content via batchUpdate
  const r = rgb;
  const requests = buildAllSlides(presId, pres.data);

  const BATCH = 200;
  for (let i = 0; i < requests.length; i += BATCH) {
    const batch = requests.slice(i, i + BATCH);
    console.log(`  Sending batch ${Math.floor(i/BATCH)+1}/${Math.ceil(requests.length/BATCH)} (${batch.length} requests)...`);
    await slides.presentations.batchUpdate({
      presentationId: presId,
      requestBody: { requests: batch },
    });
  }

  console.log("\n✅ All 18 slides built!");
  console.log(`\n   ${url}\n`);
}

// ─── Color helper ───
function rgb(r, g, b) {
  return { red: r/255, green: g/255, blue: b/255 };
}

// ─── EMU helpers ───
const INCH = 914400;
const emu = (inches) => Math.round(inches * INCH);

// ─── Slide size (widescreen 16:9) ───
const SW = 13.333;
const SH = 7.5;

let elementCounter = 0;
function nextId() { return `e_${elementCounter++}`; }

function bgReq(slideId, color) {
  return {
    updatePageProperties: {
      objectId: slideId,
      pageProperties: {
        pageBackgroundFill: { solidFill: { color: { rgbColor: color } } },
      },
      fields: "pageBackgroundFill",
    },
  };
}

function createTextBox(slideId, id, x, y, w, h) {
  return {
    createShape: {
      objectId: id,
      shapeType: "TEXT_BOX",
      elementProperties: {
        pageObjectId: slideId,
        size: {
          width: { magnitude: emu(w), unit: "EMU" },
          height: { magnitude: emu(h), unit: "EMU" },
        },
        transform: {
          scaleX: 1, scaleY: 1,
          translateX: emu(x), translateY: emu(y),
          unit: "EMU",
        },
      },
    },
  };
}

function createRect(slideId, id, x, y, w, h) {
  return {
    createShape: {
      objectId: id,
      shapeType: "ROUND_RECTANGLE",
      elementProperties: {
        pageObjectId: slideId,
        size: {
          width: { magnitude: emu(w), unit: "EMU" },
          height: { magnitude: emu(h), unit: "EMU" },
        },
        transform: {
          scaleX: 1, scaleY: 1,
          translateX: emu(x), translateY: emu(y),
          unit: "EMU",
        },
      },
    },
  };
}

function styleRect(id, fillColor) {
  return {
    updateShapeProperties: {
      objectId: id,
      shapeProperties: {
        shapeBackgroundFill: { solidFill: { color: { rgbColor: fillColor } } },
        outline: { propertyState: "NOT_RENDERED" },
      },
      fields: "shapeBackgroundFill,outline",
    },
  };
}

function insertText(id, text) {
  return { insertText: { objectId: id, text, insertionIndex: 0 } };
}

function styleText(id, fontSize, color, bold, italic) {
  const style = {
    fontSize: { magnitude: fontSize, unit: "PT" },
    foregroundColor: { opaqueColor: { rgbColor: color } },
  };
  let fields = "fontSize,foregroundColor";
  if (bold) { style.bold = true; fields += ",bold"; }
  if (italic) { style.italic = true; fields += ",italic"; }
  return {
    updateTextStyle: {
      objectId: id,
      style,
      textRange: { type: "ALL" },
      fields,
    },
  };
}

function alignText(id, alignment, lineSpacing) {
  const style = {};
  let fields = "";
  if (alignment) { style.alignment = alignment; fields += "alignment"; }
  if (lineSpacing) { style.lineSpacing = lineSpacing; fields += (fields?",":"") + "lineSpacing"; }
  if (!fields) return null;
  return {
    updateParagraphStyle: {
      objectId: id,
      style,
      textRange: { type: "ALL" },
      fields,
    },
  };
}

function noOutline(id) {
  return {
    updateShapeProperties: {
      objectId: id,
      shapeProperties: { outline: { propertyState: "NOT_RENDERED" } },
      fields: "outline",
    },
  };
}

// Convenience: add a full text element
function addText(reqs, slideId, text, x, y, w, h, fontSize, color, opts = {}) {
  const id = nextId();
  reqs.push(createTextBox(slideId, id, x, y, w, h));
  reqs.push(insertText(id, text));
  reqs.push(styleText(id, fontSize, color, opts.bold, opts.italic));
  const a = alignText(id, opts.align, opts.lineSpacing);
  if (a) reqs.push(a);
  reqs.push(noOutline(id));
}

// Convenience: add a colored rounded rectangle
function addRect(reqs, slideId, x, y, w, h, fillColor) {
  const id = nextId();
  reqs.push(createRect(slideId, id, x, y, w, h));
  reqs.push(styleRect(id, fillColor));
}

// ─── Colors ───
const C = {
  dark: rgb(17,24,39),
  darkCard: rgb(30,41,59),
  white: rgb(255,255,255),
  offWhite: rgb(248,250,252),
  blue: rgb(37,99,235),
  lightBlue: rgb(219,234,254),
  darkBlue: rgb(30,58,138),
  green: rgb(22,163,74),
  lightGreen: rgb(220,252,231),
  darkGreen: rgb(20,83,45),
  orange: rgb(245,158,11),
  lightOrange: rgb(254,243,199),
  darkOrange: rgb(120,53,15),
  purple: rgb(139,92,246),
  lightPurple: rgb(237,233,254),
  darkPurple: rgb(76,29,149),
  red: rgb(239,68,68),
  lightRed: rgb(254,226,226),
  darkRed: rgb(127,29,29),
  gray: rgb(107,114,128),
  darkText: rgb(17,24,39),
  medText: rgb(75,85,99),
};


function buildAllSlides(presId, presData) {
  const reqs = [];
  const defaultSlideId = presData.slides[0].objectId;

  // Create 17 more slides (we already have 1)
  const slideIds = [defaultSlideId];
  for (let i = 1; i < 18; i++) {
    const sid = `slide_${i}`;
    slideIds.push(sid);
    reqs.push({
      createSlide: {
        objectId: sid,
        insertionIndex: i,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    });
  }

  // Delete default title placeholder elements from slide 0
  const defaultSlide = presData.slides[0];
  for (const el of defaultSlide.pageElements || []) {
    reqs.push({ deleteObject: { objectId: el.objectId } });
  }

  // ═══ SLIDE 1: Title ═══
  let s = slideIds[0];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "🚀", 0, 0.8, SW, 1.2, 60, C.white, { bold: true, align: "CENTER" });
  addText(reqs, s, "JDE Mission Control", 0, 2.0, SW, 1.0, 48, C.white, { bold: true, align: "CENTER" });
  addText(reqs, s, "Your Dashboard Guide", 0, 3.0, SW, 0.7, 28, C.blue, { align: "CENTER" });
  addText(reqs, s, "Everything you need to know — explained simply.", 0, 4.2, SW, 0.5, 18, C.gray, { align: "CENTER" });

  // ═══ SLIDE 2: What Is This? ═══
  s = slideIds[1];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "🤔  What Is This Dashboard?", 0.8, 0.5, 12, 0.8, 36, C.darkText, { bold: true });
  addRect(reqs, s, 1.0, 1.7, 11.3, 4.5, C.white);
  addText(reqs, s, "Think of it like a scoreboard at a sports game  🏟️", 1.5, 1.9, 10.3, 0.7, 24, C.blue, { bold: true, align: "CENTER" });
  addText(reqs, s, "JDE Mission Control tracks everything that happens\nduring a live car sales event at a dealership.\n\n📊  How many cars were sold\n💰  How much money was made\n👥  Who's selling the most\n🏆  Who's earning badges & awards", 1.5, 2.8, 10.3, 2.8, 18, C.medText, { align: "CENTER", lineSpacing: 130 });
  addText(reqs, s, "Instead of whiteboards and spreadsheets → you have a live, real-time command center.", 1.0, 6.3, 11.3, 0.5, 15, C.gray, { italic: true, align: "CENTER" });

  // ═══ SLIDE 3: Quick Start ═══
  s = slideIds[2];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "⚡  Quick Start — Do These 3 Things First", 0.8, 0.4, 12, 0.8, 34, C.white, { bold: true });
  addRect(reqs, s, 0.6, 1.6, 3.7, 4.5, C.blue);
  addText(reqs, s, "1️⃣\n\nSelect Your Event\n\nUse the dropdown at the\ntop of the sidebar to pick\nwhich event you're on", 0.6, 1.7, 3.7, 4.3, 17, C.white, { align: "CENTER", lineSpacing: 125 });
  addRect(reqs, s, 4.8, 1.6, 3.7, 4.5, C.green);
  addText(reqs, s, "2️⃣\n\nLog Your Deals\n\nEvery time a car is sold,\nclick \"New Deal\" and\nenter the info", 4.8, 1.7, 3.7, 4.3, 17, C.white, { align: "CENTER", lineSpacing: 125 });
  addRect(reqs, s, 9.0, 1.6, 3.7, 4.5, C.orange);
  addText(reqs, s, "3️⃣\n\nCheck the Scoreboard\n\nGo to Performance page\nto see charts, rankings\n& stats", 9.0, 1.7, 3.7, 4.3, 17, C.white, { align: "CENTER", lineSpacing: 125 });
  addText(reqs, s, "That's it! Everything else updates automatically.  🎉", 0, 6.5, SW, 0.5, 17, C.gray, { italic: true, align: "CENTER" });

  // ═══ SLIDE 4: Sidebar ═══
  s = slideIds[3];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "🧭  The Sidebar — Your Map", 0.8, 0.5, 12, 0.8, 36, C.darkText, { bold: true });
  addText(reqs, s, "The sidebar is always on the left. Click any page to go there.", 1.0, 1.3, 11.3, 0.5, 17, C.medText);
  addRect(reqs, s, 1.0, 2.1, 11.3, 4.8, C.white);
  addText(reqs, s, "📊  Performance         →   Charts & leaderboard (the scoreboard)\n📝  Deals                      →   Every car sold (the deal log)\n🏆  Achievements        →   Badges, points & streaks\n📋  Daily Metrics          →   Enter daily numbers\n👥  Roster                      →   Your team of salespeople\n🚗  Inventory                →   Cars available at the dealership\n💵  Commissions          →   Who gets paid what\n⚙️  Settings                   →   App configuration", 1.4, 2.3, 10.5, 4.4, 18, C.medText, { lineSpacing: 150 });

  // ═══ SLIDE 5: Event Switcher ═══
  s = slideIds[4];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "🔄  The Event Switcher — Most Important Button!", 0.8, 0.5, 12, 0.8, 32, C.darkText, { bold: true });
  addRect(reqs, s, 1.0, 1.5, 11.3, 1.8, C.lightBlue);
  addText(reqs, s, "At the very top of the sidebar is a dropdown menu.\nWhichever event you pick here filters EVERYTHING.", 1.3, 1.7, 10.7, 1.4, 20, C.blue, { bold: true, align: "CENTER", lineSpacing: 140 });
  addText(reqs, s, "💡  Think of it like switching TV channels", 1.0, 3.8, 11.3, 0.6, 24, C.darkText, { bold: true, align: "CENTER" });
  addText(reqs, s, "Each event = a sales event at a dealership (usually 6 days).\n\nWhen you switch events:\n•  All charts update to show that event's numbers\n•  The leaderboard shows that event's team\n•  Deals, roster, inventory — everything changes", 1.3, 4.5, 10.7, 2.5, 17, C.medText, { align: "CENTER", lineSpacing: 130 });

  // ═══ SLIDE 6: Performance Overview ═══
  s = slideIds[5];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "📊  The Performance Page", 0.8, 0.4, 12, 0.8, 36, C.white, { bold: true });
  addText(reqs, s, "The heart of the dashboard — where you'll spend most of your time.", 1.0, 1.2, 11.3, 0.5, 17, C.gray, { italic: true });
  addRect(reqs, s, 0.6, 2.0, 5.8, 2.0, C.darkCard);
  addText(reqs, s, "🔢  KPI Cards (Top)\n\n5 big number cards: Deals • Gross\nAvg PVR • Close % • Ratios", 0.9, 2.1, 5.2, 1.8, 16, C.offWhite, { lineSpacing: 125 });
  addRect(reqs, s, 6.9, 2.0, 5.8, 2.0, C.darkCard);
  addText(reqs, s, "📈  4 Charts (Middle)\n\nGross per Day • Top Sellers\nFront vs Back • Daily Trend", 7.2, 2.1, 5.2, 1.8, 16, C.offWhite, { lineSpacing: 125 });
  addRect(reqs, s, 0.6, 4.3, 12.1, 2.0, C.darkCard);
  addText(reqs, s, "🏅  Leaderboard Table (Bottom)\n\nEvery member ranked by total gross — shows deals, ups, close %, gross, PVR, badges", 0.9, 4.4, 11.5, 1.8, 16, C.offWhite, { lineSpacing: 125 });

  // ═══ SLIDE 7: KPI Cards ═══
  s = slideIds[6];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "🔢  The 5 Number Cards — Your Snapshot", 0.8, 0.4, 12, 0.8, 34, C.darkText, { bold: true });
  addText(reqs, s, "Top of the Performance page. One glance = full picture.", 1.0, 1.1, 11.3, 0.5, 17, C.medText);
  const kpis = [
    ["📦\nTotal Deals\nCars sold", C.lightBlue, C.blue],
    ["💰\nTotal Gross\nAll profit", C.lightGreen, C.green],
    ["📊\nAvg PVR\nProfit/car", C.lightOrange, C.orange],
    ["🎯\nClose %\nDeals÷Ups", C.lightPurple, C.purple],
    ["⚖️\nF:B Ratio\nFront vs Back", C.lightRed, C.red],
  ];
  for (let i = 0; i < kpis.length; i++) {
    const x = 0.5 + i * 2.5;
    addRect(reqs, s, x, 1.8, 2.2, 2.0, kpis[i][1]);
    addText(reqs, s, kpis[i][0], x, 1.9, 2.2, 1.8, 16, kpis[i][2], { bold: true, align: "CENTER", lineSpacing: 125 });
  }
  addRect(reqs, s, 1.0, 4.2, 11.3, 2.8, C.white);
  addText(reqs, s, "🗣️  Quick Definitions:\n\n• PVR = \"Per Vehicle Retailed\" — avg profit per car\n• Ups = customers who walked in\n• Close % = what % of walk-ins bought a car\n• Front Gross = profit from the car sale itself\n• Back Gross = profit from financing, warranties, add-ons", 1.3, 4.3, 10.7, 2.6, 16, C.medText, { lineSpacing: 128 });

  // ═══ SLIDE 8: Charts ═══
  s = slideIds[7];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "📈  The 4 Charts — See the Trends", 0.8, 0.4, 12, 0.8, 34, C.darkText, { bold: true });
  const charts = [
    [0.5, 1.4, "📊 Gross per Day\n\nBar chart showing daily profit.\nLabels: \"5 sold • 184 ups\"", C.lightBlue, C.blue],
    [6.9, 1.4, "🏆 Gross by Salesperson\n\nTop 10 sellers ranked by\ntotal profit. Biggest bar = #1", C.lightGreen, C.green],
    [0.5, 4.2, "🍩 Front vs Back Breakdown\n\nDonut chart: car sale profit\nvs financing & add-ons", C.lightOrange, C.darkOrange],
    [6.9, 4.2, "📉 Daily PVR Trend\n\nAvg profit per car over time.\nGoing up = good!", C.lightPurple, C.purple],
  ];
  for (const [x, y, text, bg, tc] of charts) {
    addRect(reqs, s, x, y, 5.9, 2.4, bg);
    addText(reqs, s, text, x+0.3, y+0.2, 5.3, 2.0, 17, tc, { lineSpacing: 125 });
  }

  // ═══ SLIDE 9: Leaderboard ═══
  s = slideIds[8];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "🏅  The Leaderboard — Who's Winning?", 0.8, 0.4, 12, 0.8, 34, C.white, { bold: true });
  addText(reqs, s, "A table ranking every team member by total gross profit.", 1.0, 1.15, 11.3, 0.5, 17, C.gray);
  addRect(reqs, s, 0.6, 1.9, 12.1, 0.55, C.darkCard);
  addText(reqs, s, "#    Name              Role         Deals    Ups    Close%    Front    Back    Total    PVR    Badges", 0.8, 1.95, 11.7, 0.45, 14, C.gray, { bold: true });
  addRect(reqs, s, 0.6, 2.55, 12.1, 0.5, rgb(30,50,70));
  addText(reqs, s, "1    John Smith     Sales         12        40      30%      $24K    $18K    $42K    $3.5K    🎯🔥", 0.8, 2.6, 11.7, 0.4, 14, C.offWhite);
  addRect(reqs, s, 0.6, 3.15, 12.1, 0.5, rgb(25,38,55));
  addText(reqs, s, "2    Jane Doe        Sales          8         35      23%      $16K    $12K    $28K    $3.5K    🏆", 0.8, 3.2, 11.7, 0.4, 14, C.offWhite);
  addRect(reqs, s, 0.6, 4.0, 12.1, 2.8, C.darkCard);
  addText(reqs, s, "What each column means:\n\n#  =  Rank (most profit)       Deals  =  Cars sold       Ups  =  Customers seen\nClose%  =  Ups→Sales           Front  =  Car sale profit  Back  =  F&I profit\nTotal  =  Front + Back            PVR  =  Avg per car       Badges  =  Awards", 0.9, 4.1, 11.5, 2.6, 15, C.offWhite, { lineSpacing: 138 });

  // ═══ SLIDE 10: Deals ═══
  s = slideIds[9];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "📝  The Deals Page — Every Car Sold", 0.8, 0.5, 12, 0.8, 34, C.darkText, { bold: true });
  addText(reqs, s, "Your deal log — a list of every single car sale at the event.", 1.0, 1.2, 11.3, 0.5, 17, C.medText);
  addRect(reqs, s, 1.0, 2.0, 11.3, 1.5, C.lightGreen);
  addText(reqs, s, "Each row = one car sale:\n🚗 Vehicle  •  👤 Customer  •  🧑‍💼 Salesperson  •  💰 Gross  •  📅 Date", 1.3, 2.1, 10.7, 1.3, 18, C.green, { align: "CENTER", lineSpacing: 135 });
  addText(reqs, s, "How to log a new deal:", 1.0, 3.8, 11.3, 0.5, 24, C.darkText, { bold: true });
  addText(reqs, s, "1.  Click \"New Deal\" button\n2.  Fill in vehicle, customer, and gross numbers\n3.  Pick the salesperson from the roster dropdown\n4.  Hit Save — done! ✅", 1.3, 4.4, 10.7, 2.5, 19, C.medText, { lineSpacing: 145 });

  // ═══ SLIDE 11: Deal Chain Reaction ═══
  s = slideIds[10];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "⚡  What Happens When You Log a Deal?", 0.8, 0.3, 12, 0.8, 34, C.white, { bold: true });
  addText(reqs, s, "A lot of magic happens behind the scenes — automatically!", 1.0, 1.05, 11.3, 0.5, 16, C.gray, { italic: true });
  const chain1 = [
    [0.5, C.blue, "1️⃣\n💾 Deal Saved\nRecorded in database"],
    [4.8, C.green, "2️⃣\n🏆 Badges Check\nNew achievements?"],
    [9.1, C.orange, "3️⃣\n🔥 Streak Updated\nConsecutive days tracked"],
  ];
  for (const [x, c, t] of chain1) {
    addRect(reqs, s, x, 1.8, 3.5, 2.2, c);
    addText(reqs, s, t, x, 1.9, 3.5, 2.0, 17, C.white, { align: "CENTER", lineSpacing: 130 });
  }
  const chain2 = [
    [2.6, C.purple, "4️⃣\n🚗 Inventory Synced\nVehicle marked \"sold\""],
    [7.0, C.red, "5️⃣\n🎉 Toast Pops Up!\n\"Badge Earned: First Blood!\""],
  ];
  for (const [x, c, t] of chain2) {
    addRect(reqs, s, x, 4.3, 3.5, 2.2, c);
    addText(reqs, s, t, x, 4.4, 3.5, 2.0, 17, C.white, { align: "CENTER", lineSpacing: 130 });
  }

  // ═══ SLIDE 12: Achievements ═══
  s = slideIds[11];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "🏆  Achievements — Badges, Points & Streaks", 0.8, 0.4, 12, 0.8, 32, C.darkText, { bold: true });
  addText(reqs, s, "Like earning trophies in a video game  🎮\nSell more → earn badges → climb the points leaderboard", 1.0, 1.2, 11.3, 0.8, 18, C.medText, { align: "CENTER", lineSpacing: 130 });
  const tabs = [
    ["Tab 1: Badges 🎖️\n\nAll 18 badges in a grid\n✅ Earned = full color\n🔒 Locked = grayed out\nEach has a point value", C.lightBlue, C.blue],
    ["Tab 2: Team 👥\n\nEach member's stats:\n• Badges earned\n• Total points\n• Current streak\n• Recent badge", C.lightGreen, C.green],
    ["Tab 3: Points 🥇\n\nLeaderboard by badge\npoints — separate from\nthe gross leaderboard.\nThis is about achievements!", C.lightOrange, C.darkOrange],
  ];
  for (let i = 0; i < tabs.length; i++) {
    const x = 0.5 + i * 4.25;
    addRect(reqs, s, x, 2.4, 3.8, 4.2, tabs[i][1]);
    addText(reqs, s, tabs[i][0], x+0.1, 2.6, 3.6, 3.8, 17, tabs[i][2], { align: "CENTER", lineSpacing: 128 });
  }

  // ═══ SLIDE 13: Badge Categories ═══
  s = slideIds[12];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "🎖️  18 Badges Across 5 Categories", 0.8, 0.3, 12, 0.8, 34, C.white, { bold: true });
  const cats1 = [
    ["🔵 Sales (5)\n\nFirst Blood • Hat Trick\n5-Pack • 10-Unit Club\n15-Car Legend", C.darkBlue, C.lightBlue],
    ["🟢 Gross (4)\n\n$10K Day • $25K Day\n$50K Total\n$100K Club", C.darkGreen, C.lightGreen],
    ["🟣 Closing (3)\n\nSharpshooter (20%+)\nSniper (30%+)\nCloser Supreme (40%+)", C.darkPurple, C.lightPurple],
  ];
  for (let i = 0; i < cats1.length; i++) {
    const x = 0.4 + i * 4.3;
    addRect(reqs, s, x, 1.3, 3.8, 2.3, cats1[i][1]);
    addText(reqs, s, cats1[i][0], x+0.1, 1.4, 3.6, 2.1, 15, cats1[i][2], { align: "CENTER", lineSpacing: 125 });
  }
  const cats2 = [
    ["🟠 Streak (3)\n\nOn a Roll (2 days)\nHot Streak (3 days)\nIron Man (5+ days)", C.darkOrange, C.lightOrange],
    ["🔴 Team (3)\n\nTop Dog (#1 on board)\nComeback Kid\nClean Sheet (0 washouts)", C.darkRed, C.lightRed],
  ];
  for (let i = 0; i < cats2.length; i++) {
    const x = 2.5 + i * 4.5;
    addRect(reqs, s, x, 3.9, 3.8, 2.3, cats2[i][1]);
    addText(reqs, s, cats2[i][0], x+0.1, 4.0, 3.6, 2.1, 15, cats2[i][2], { align: "CENTER", lineSpacing: 125 });
  }
  addText(reqs, s, "Badges are earned automatically when you hit the target!", 0, 6.5, SW, 0.5, 15, C.gray, { italic: true, align: "CENTER" });

  // ═══ SLIDE 14: Streaks ═══
  s = slideIds[13];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "🔥  Streaks — Keep the Momentum Going", 0.8, 0.4, 12, 0.8, 34, C.darkText, { bold: true });
  addRect(reqs, s, 1.0, 1.5, 11.3, 2.0, C.lightOrange);
  addText(reqs, s, "A streak = how many days IN A ROW you've made a sale.\nSell today + tomorrow = 2-day streak 🔥🔥\nMiss a day? Resets to 1.", 1.3, 1.7, 10.7, 1.6, 19, C.darkOrange, { align: "CENTER", lineSpacing: 135 });
  addText(reqs, s, "How it shows up:", 1.0, 3.8, 11.3, 0.5, 24, C.darkText, { bold: true });
  addRect(reqs, s, 1.0, 4.5, 11.3, 2.3, C.white);
  addText(reqs, s, "🔥 3  (best: 5)   ← This means:\n\n• Current streak: 3 consecutive days with a sale\n• Personal record: 5 days\n• 🟠 Orange = 3+ days  •  🟡 Yellow = 1-2  •  ⚪ Gray = none", 1.3, 4.6, 10.7, 2.0, 17, C.medText, { lineSpacing: 130 });

  // ═══ SLIDE 15: Daily Metrics ═══
  s = slideIds[14];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "📋  Daily Metrics — Enter Your Daily Numbers", 0.8, 0.4, 12, 0.8, 32, C.darkText, { bold: true });
  addText(reqs, s, "A simple spreadsheet for daily totals.", 1.0, 1.2, 11.3, 0.5, 17, C.medText);
  addRect(reqs, s, 1.0, 1.9, 11.3, 1.5, C.white);
  addText(reqs, s, "Each row = one day of the event:\n📅 Date  •  👣 Ups  •  🚗 Sold  •  💰 Total Gross  •  💵 Front  •  🏦 Back  •  📝 Notes", 1.3, 2.0, 10.7, 1.3, 17, C.medText, { align: "CENTER", lineSpacing: 130 });
  addText(reqs, s, "How to use it:", 1.0, 3.7, 11.3, 0.5, 24, C.darkText, { bold: true });
  addText(reqs, s, "1.  Click \"Add Day\" — date auto-fills\n2.  Type numbers into cells\n3.  Changed rows turn yellow\n4.  Click \"Save Changes\"\n5.  Close % auto-calculates", 1.3, 4.3, 10.7, 2.5, 18, C.medText, { lineSpacing: 140 });

  // ═══ SLIDE 16: Roster & Inventory ═══
  s = slideIds[15];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "👥  Roster  &  🚗  Inventory", 0.8, 0.4, 12, 0.8, 36, C.white, { bold: true });
  addRect(reqs, s, 0.6, 1.5, 5.7, 5.0, C.darkCard);
  addText(reqs, s, "👥  Roster\n\nYour team for this event.\nEach person has:\n• Name\n• Role (Sales, Closer,\n  Team Leader, F&I)\n\nWhen you log a deal,\nyou pick the salesperson\nfrom this list.", 0.9, 1.6, 5.1, 4.8, 17, C.offWhite, { lineSpacing: 125 });
  addRect(reqs, s, 7.0, 1.5, 5.7, 5.0, C.darkCard);
  addText(reqs, s, "🚗  Inventory\n\nCars at the dealership.\nEach vehicle has:\n• Stock number\n• Year, Make, Model\n• Status (available/sold)\n\nWhen you log a deal\nwith a stock #, that car\nautomatically = \"sold\".", 7.3, 1.6, 5.1, 4.8, 17, C.offWhite, { lineSpacing: 125 });

  // ═══ SLIDE 17: Cheat Sheet ═══
  s = slideIds[16];
  reqs.push(bgReq(s, C.offWhite));
  addText(reqs, s, "📌  Quick Reference Cheat Sheet", 0.8, 0.3, 12, 0.7, 34, C.darkText, { bold: true });
  addRect(reqs, s, 0.5, 1.2, 12.3, 5.8, C.white);
  addText(reqs, s, "\"I want to...\"                                                    →  Go here\n\n🔄  Switch events                    →  Sidebar dropdown\n📊  See charts & rankings       →  Performance page\n📝  Log a car sale                    →  Deals → New Deal\n🏆  See badges                        →  Achievements page\n📋  Enter daily numbers          →  Daily Metrics\n👥  Add team member              →  Roster page\n🚗  Check available cars         →  Inventory page\n💵  See pay                               →  Commissions\n✏️  Edit a deal                           →  Deals → click row\n🔄  Refresh data                      →  Performance → Refresh", 0.9, 1.4, 11.5, 5.4, 17, C.medText, { lineSpacing: 140 });

  // ═══ SLIDE 18: Closing ═══
  s = slideIds[17];
  reqs.push(bgReq(s, C.dark));
  addText(reqs, s, "🎉", 0, 0.8, SW, 1.2, 60, C.white, { align: "CENTER" });
  addText(reqs, s, "You're Ready!", 0, 2.1, SW, 1.0, 48, C.white, { bold: true, align: "CENTER" });
  addText(reqs, s, "Remember the 3 steps:", 0, 3.3, SW, 0.6, 22, C.gray, { align: "CENTER" });
  addText(reqs, s, "1.  Pick your event   🔄\n2.  Log your deals   📝\n3.  Watch the scoreboard   📊", 0, 4.0, SW, 1.8, 26, C.blue, { bold: true, align: "CENTER", lineSpacing: 150 });
  addText(reqs, s, "Everything else happens automatically. Go sell some cars!  🚗💨", 0, 6.0, SW, 0.6, 18, C.gray, { italic: true, align: "CENTER" });

  return reqs;
}

main().catch(e => {
  console.error("❌", e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
});
