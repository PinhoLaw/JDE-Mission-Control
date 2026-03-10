/**
 * create-slides.mjs
 * Creates the "JDE Mission Control — Dashboard Guide" Google Slides presentation
 * using the existing service account credentials.
 *
 * Usage: node scripts/create-slides.mjs
 */

import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load credentials ───────────────────────────────────────────────────────
function loadCredentials() {
  const envPath = resolve(__dirname, "../.env.local");
  const env = readFileSync(envPath, "utf8");
  const key = "GOOGLE_SERVICE_ACCOUNT_JSON=";
  const startIdx = env.indexOf(key);
  if (startIdx === -1) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not found in .env.local");
  const jsonStart = startIdx + key.length;
  // Find the matching closing brace
  let braceCount = 0;
  let endIdx = jsonStart;
  for (let i = jsonStart; i < env.length; i++) {
    if (env[i] === "{") braceCount++;
    if (env[i] === "}") braceCount--;
    if (braceCount === 0) { endIdx = i + 1; break; }
  }
  return JSON.parse(env.slice(jsonStart, endIdx));
}

// ─── Authenticate ───────────────────────────────────────────────────────────
async function getAuth() {
  const creds = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  return auth;
}

// ─── Color helpers ──────────────────────────────────────────────────────────
const rgb = (r, g, b) => ({
  red: r / 255,
  green: g / 255,
  blue: b / 255,
});

const COLORS = {
  darkBg: rgb(17, 24, 39),       // #111827
  white: rgb(255, 255, 255),
  offWhite: rgb(248, 250, 252),   // #F8FAFC
  blue: rgb(37, 99, 235),         // #2563EB
  lightBlue: rgb(219, 234, 254),  // #DBEAFE
  green: rgb(22, 163, 74),        // #16A34A
  lightGreen: rgb(220, 252, 231), // #DCFCE7
  orange: rgb(245, 158, 11),      // #F59E0B
  lightOrange: rgb(254, 243, 199),// #FEF3C7
  purple: rgb(139, 92, 246),      // #8B5CF6
  lightPurple: rgb(237, 233, 254),// #EDE9FE
  red: rgb(239, 68, 68),          // #EF4444
  lightRed: rgb(254, 226, 226),   // #FEE2E2
  gray: rgb(107, 114, 128),       // #6B7280
  lightGray: rgb(243, 244, 246),  // #F3F4F6
  darkText: rgb(17, 24, 39),      // #111827
  medText: rgb(75, 85, 99),       // #4B5563
};

// ─── Dimension helpers (EMU = English Metric Units, 1 inch = 914400 EMU) ────
const INCH = 914400;
const SLIDE_W = 10 * INCH; // 10 inches
const SLIDE_H = 5.625 * INCH; // 5.625 inches (16:9)

const emu = (inches) => Math.round(inches * INCH);

// ─── Slide content definitions ──────────────────────────────────────────────
const SLIDES = [
  // ── SLIDE 1: Title ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "🚀",
        x: 0, y: 0.6, w: 10, h: 0.9,
        fontSize: 60, bold: true, color: COLORS.white,
        align: "CENTER",
      },
      {
        type: "text",
        text: "JDE Mission Control",
        x: 0, y: 1.4, w: 10, h: 0.8,
        fontSize: 42, bold: true, color: COLORS.white,
        align: "CENTER",
      },
      {
        type: "text",
        text: "Your Dashboard Guide",
        x: 0, y: 2.1, w: 10, h: 0.6,
        fontSize: 24, bold: false, color: COLORS.blue,
        align: "CENTER",
      },
      {
        type: "text",
        text: "Everything you need to know — explained simply.",
        x: 0, y: 3.0, w: 10, h: 0.5,
        fontSize: 16, color: COLORS.gray,
        align: "CENTER",
      },
    ],
  },

  // ── SLIDE 2: What Is This? ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "🤔  What Is This Dashboard?",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 32, bold: true, color: COLORS.darkText,
      },
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 1.4, w: 8.4, h: 2.8,
        fillColor: COLORS.white,
      },
      {
        type: "text",
        text: "Think of it like a scoreboard at a sports game 🏟️",
        x: 1.2, y: 1.6, w: 7.6, h: 0.6,
        fontSize: 22, bold: true, color: COLORS.blue,
        align: "CENTER",
      },
      {
        type: "text",
        text: "JDE Mission Control tracks everything that happens\nduring a live car sales event at a dealership.\n\n📊  How many cars were sold\n💰  How much money was made\n👥  Who's selling the most\n🏆  Who's earning badges & awards",
        x: 1.2, y: 2.3, w: 7.6, h: 2.0,
        fontSize: 17, color: COLORS.medText,
        align: "CENTER",
        lineSpacing: 130,
      },
      {
        type: "text",
        text: "Instead of whiteboards and spreadsheets → you have a live, real-time command center.",
        x: 0.8, y: 4.5, w: 8.4, h: 0.5,
        fontSize: 14, color: COLORS.gray, italic: true,
        align: "CENTER",
      },
    ],
  },

  // ── SLIDE 3: Quick Start ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "⚡ Quick Start — Do These 3 Things First",
        x: 0.6, y: 0.3, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.white,
      },
      // Box 1
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 1.3, w: 2.8, h: 3.2,
        fillColor: COLORS.blue,
      },
      {
        type: "text",
        text: "1️⃣\n\nSelect Your\nEvent\n\nUse the dropdown\nat the top of the\nsidebar to pick\nwhich event\nyou're working on",
        x: 0.5, y: 1.3, w: 2.8, h: 3.2,
        fontSize: 14, bold: false, color: COLORS.white,
        align: "CENTER",
        lineSpacing: 115,
      },
      // Box 2
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 3.6, y: 1.3, w: 2.8, h: 3.2,
        fillColor: COLORS.green,
      },
      {
        type: "text",
        text: "2️⃣\n\nLog Your\nDeals\n\nEvery time a car\nis sold, click\n\"New Deal\" and\nenter the info",
        x: 3.6, y: 1.3, w: 2.8, h: 3.2,
        fontSize: 14, bold: false, color: COLORS.white,
        align: "CENTER",
        lineSpacing: 115,
      },
      // Box 3
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 6.7, y: 1.3, w: 2.8, h: 3.2,
        fillColor: COLORS.orange,
      },
      {
        type: "text",
        text: "3️⃣\n\nCheck the\nScoreboard\n\nGo to the\nPerformance page\nto see charts,\nrankings & stats",
        x: 6.7, y: 1.3, w: 2.8, h: 3.2,
        fontSize: 14, bold: false, color: COLORS.white,
        align: "CENTER",
        lineSpacing: 115,
      },
      {
        type: "text",
        text: "That's it! Everything else updates automatically. 🎉",
        x: 0, y: 4.8, w: 10, h: 0.5,
        fontSize: 15, color: COLORS.gray, italic: true,
        align: "CENTER",
      },
    ],
  },

  // ── SLIDE 4: Sidebar Overview ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "🧭  The Sidebar — Your Map",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 32, bold: true, color: COLORS.darkText,
      },
      {
        type: "text",
        text: "The sidebar is always on the left side of your screen.\nIt's like the table of contents in a book — click any page to go there.",
        x: 0.8, y: 1.1, w: 8.4, h: 0.8,
        fontSize: 15, color: COLORS.medText,
        lineSpacing: 130,
      },
      // Navigation items
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 2.1, w: 8.4, h: 3.0,
        fillColor: COLORS.white,
      },
      {
        type: "text",
        text: "📊  Performance    →   Charts & leaderboard (the scoreboard)\n📝  Deals                →   Every car sold (the deal log)\n🏆  Achievements   →   Badges, points & streaks\n📋  Daily Metrics     →   Enter daily numbers\n👥  Roster                →   Your team of salespeople\n🚗  Inventory           →   Cars available at the dealership\n💵  Commissions     →   Who gets paid what\n⚙️  Settings              →   App configuration",
        x: 1.2, y: 2.2, w: 7.8, h: 2.8,
        fontSize: 14, color: COLORS.medText,
        lineSpacing: 145,
      },
    ],
  },

  // ── SLIDE 5: Event Switcher ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "🔄  The Event Switcher — Most Important Button!",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 28, bold: true, color: COLORS.darkText,
      },
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 1.3, w: 8.4, h: 1.4,
        fillColor: COLORS.lightBlue,
      },
      {
        type: "text",
        text: "At the very top of the sidebar is a dropdown menu.\nWhichever event you pick here filters EVERYTHING across the entire app.",
        x: 1.0, y: 1.4, w: 8.0, h: 1.2,
        fontSize: 16, color: COLORS.blue, bold: true,
        align: "CENTER",
        lineSpacing: 140,
      },
      {
        type: "text",
        text: "💡  Think of it like switching TV channels",
        x: 0.8, y: 3.0, w: 8.4, h: 0.5,
        fontSize: 20, bold: true, color: COLORS.darkText,
        align: "CENTER",
      },
      {
        type: "text",
        text: "Each event = a different sales event at a dealership (usually 6 days).\n\nWhen you switch events:\n• All charts update to show that event's numbers\n• The leaderboard shows that event's team\n• Deals, roster, inventory — everything changes",
        x: 1.0, y: 3.5, w: 8.0, h: 1.8,
        fontSize: 15, color: COLORS.medText,
        align: "CENTER",
        lineSpacing: 130,
      },
    ],
  },

  // ── SLIDE 6: Performance Page Overview ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "📊  The Performance Page",
        x: 0.6, y: 0.3, w: 9, h: 0.7,
        fontSize: 32, bold: true, color: COLORS.white,
      },
      {
        type: "text",
        text: "This is the heart of the dashboard — where you'll spend most of your time.",
        x: 0.8, y: 1.0, w: 8.4, h: 0.5,
        fontSize: 16, color: COLORS.gray, italic: true,
      },
      // Section boxes
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 1.7, w: 4.3, h: 1.4,
        fillColor: rgb(30, 41, 59),
      },
      {
        type: "text",
        text: "🔢  KPI Cards (Top)\n5 big number cards showing totals:\nDeals • Gross • Avg PVR • Close % • Ratios",
        x: 0.7, y: 1.8, w: 3.9, h: 1.2,
        fontSize: 13, color: COLORS.offWhite,
        lineSpacing: 130,
      },
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 5.2, y: 1.7, w: 4.3, h: 1.4,
        fillColor: rgb(30, 41, 59),
      },
      {
        type: "text",
        text: "📈  4 Charts (Middle)\nGross per Day • Top Sellers\nFront vs Back • Daily Trend",
        x: 5.4, y: 1.8, w: 3.9, h: 1.2,
        fontSize: 13, color: COLORS.offWhite,
        lineSpacing: 130,
      },
      {
        type: "shape",
        shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 3.3, w: 9.0, h: 1.4,
        fillColor: rgb(30, 41, 59),
      },
      {
        type: "text",
        text: "🏅  Leaderboard Table (Bottom)\nEvery team member ranked by total gross — shows deals, ups, close %, gross breakdown, avg PVR, and earned badges",
        x: 0.7, y: 3.4, w: 8.6, h: 1.2,
        fontSize: 13, color: COLORS.offWhite,
        lineSpacing: 130,
      },
      {
        type: "text",
        text: "⬆️  KPI Cards    →    📊  Charts    →    🏅  Leaderboard",
        x: 0, y: 5.0, w: 10, h: 0.4,
        fontSize: 14, color: COLORS.gray,
        align: "CENTER",
      },
    ],
  },

  // ── SLIDE 7: KPI Cards ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "🔢  The 5 Number Cards — Your Snapshot",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.darkText,
      },
      {
        type: "text",
        text: "These sit at the very top of the Performance page. One glance = full picture.",
        x: 0.8, y: 1.0, w: 8.4, h: 0.5,
        fontSize: 15, color: COLORS.medText,
      },
      // 5 mini cards
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.3, y: 1.7, w: 1.7, h: 1.5, fillColor: COLORS.lightBlue,
      },
      {
        type: "text",
        text: "📦\nTotal Deals\n\nHow many\ncars sold",
        x: 0.3, y: 1.8, w: 1.7, h: 1.4,
        fontSize: 11, color: COLORS.blue, align: "CENTER", bold: true,
        lineSpacing: 115,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 2.2, y: 1.7, w: 1.7, h: 1.5, fillColor: COLORS.lightGreen,
      },
      {
        type: "text",
        text: "💰\nTotal Gross\n\nAll profit\ncombined",
        x: 2.2, y: 1.8, w: 1.7, h: 1.4,
        fontSize: 11, color: COLORS.green, align: "CENTER", bold: true,
        lineSpacing: 115,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 4.1, y: 1.7, w: 1.7, h: 1.5, fillColor: COLORS.lightOrange,
      },
      {
        type: "text",
        text: "📊\nAvg PVR\n\nProfit per\ncar sold",
        x: 4.1, y: 1.8, w: 1.7, h: 1.4,
        fontSize: 11, color: COLORS.orange, align: "CENTER", bold: true,
        lineSpacing: 115,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 6.0, y: 1.7, w: 1.7, h: 1.5, fillColor: COLORS.lightPurple,
      },
      {
        type: "text",
        text: "🎯\nClose %\n\nDeals ÷ Ups\n(walk-ins)",
        x: 6.0, y: 1.8, w: 1.7, h: 1.4,
        fontSize: 11, color: COLORS.purple, align: "CENTER", bold: true,
        lineSpacing: 115,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 7.9, y: 1.7, w: 1.7, h: 1.5, fillColor: COLORS.lightRed,
      },
      {
        type: "text",
        text: "⚖️\nF:B Ratio\n\nFront vs\nBack gross",
        x: 7.9, y: 1.8, w: 1.7, h: 1.4,
        fontSize: 11, color: COLORS.red, align: "CENTER", bold: true,
        lineSpacing: 115,
      },
      // Explanation
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 3.5, w: 8.4, h: 1.8, fillColor: COLORS.white,
      },
      {
        type: "text",
        text: "🗣️  Quick Definitions:\n\n• PVR = \"Per Vehicle Retailed\" — average profit per car\n• Ups = customers who walked into the dealership\n• Close % = what percentage of walk-ins actually bought a car\n• Front Gross = profit from the car sale itself\n• Back Gross = profit from financing, warranties, add-ons",
        x: 1.0, y: 3.6, w: 8.0, h: 1.7,
        fontSize: 13, color: COLORS.medText,
        lineSpacing: 125,
      },
    ],
  },

  // ── SLIDE 8: Charts ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "📈  The 4 Charts — See the Trends",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.darkText,
      },
      // Chart 1
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.4, y: 1.3, w: 4.4, h: 1.7, fillColor: COLORS.lightBlue,
      },
      {
        type: "text",
        text: "📊 Gross per Day\n\nBar chart showing how much profit\nwas made each day of the event.\nLabels show \"5 sold • 184 ups\"",
        x: 0.6, y: 1.4, w: 4.0, h: 1.5,
        fontSize: 13, color: COLORS.blue,
        lineSpacing: 120,
      },
      // Chart 2
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 5.2, y: 1.3, w: 4.4, h: 1.7, fillColor: COLORS.lightGreen,
      },
      {
        type: "text",
        text: "🏆 Gross by Salesperson\n\nHorizontal bars ranking the top 10\nsellers by total profit.\nBiggest bar = top performer",
        x: 5.4, y: 1.4, w: 4.0, h: 1.5,
        fontSize: 13, color: COLORS.green,
        lineSpacing: 120,
      },
      // Chart 3
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.4, y: 3.2, w: 4.4, h: 1.7, fillColor: COLORS.lightOrange,
      },
      {
        type: "text",
        text: "🍩 Front vs Back Breakdown\n\nDonut chart showing what % of\nprofit comes from the car sale\nvs. financing & add-ons",
        x: 0.6, y: 3.3, w: 4.0, h: 1.5,
        fontSize: 13, color: rgb(180, 120, 0),
        lineSpacing: 120,
      },
      // Chart 4
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 5.2, y: 3.2, w: 4.4, h: 1.7, fillColor: COLORS.lightPurple,
      },
      {
        type: "text",
        text: "📉 Daily PVR Trend\n\nLine chart tracking average profit\nper car over time. Going up = good!\nGoing down = adjust strategy",
        x: 5.4, y: 3.3, w: 4.0, h: 1.5,
        fontSize: 13, color: COLORS.purple,
        lineSpacing: 120,
      },
    ],
  },

  // ── SLIDE 9: Leaderboard ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "🏅  The Leaderboard — Who's Winning?",
        x: 0.6, y: 0.3, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.white,
      },
      {
        type: "text",
        text: "A table ranking every team member from highest to lowest total gross profit.",
        x: 0.8, y: 1.0, w: 8.4, h: 0.5,
        fontSize: 16, color: COLORS.gray,
      },
      // Fake table header
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 1.7, w: 9.0, h: 0.5, fillColor: rgb(30, 41, 59),
      },
      {
        type: "text",
        text: "#     Name              Role          Deals    Ups    Close%    Front     Back     Total      PVR      Badges",
        x: 0.6, y: 1.75, w: 8.8, h: 0.4,
        fontSize: 11, color: COLORS.gray, bold: true,
      },
      // Fake rows
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 2.3, w: 9.0, h: 0.45, fillColor: rgb(30, 50, 70),
      },
      {
        type: "text",
        text: "1     John Smith     Sales          12        40      30%       $24K      $18K     $42K     $3.5K     🎯🔥",
        x: 0.6, y: 2.35, w: 8.8, h: 0.35,
        fontSize: 11, color: COLORS.offWhite,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 2.85, w: 9.0, h: 0.45, fillColor: rgb(25, 38, 55),
      },
      {
        type: "text",
        text: "2     Jane Doe         Sales           8         35      23%       $16K      $12K     $28K     $3.5K     🏆",
        x: 0.6, y: 2.9, w: 8.8, h: 0.35,
        fontSize: 11, color: COLORS.offWhite,
      },
      // What each column means
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 3.6, w: 9.0, h: 1.6, fillColor: rgb(30, 41, 59),
      },
      {
        type: "text",
        text: "What each column means:\n\n#  =  Rank (1st = most profit)          Deals  =  Cars sold          Ups  =  Customers seen\nClose%  =  How many ups became sales     Front  =  Car sale profit     Back  =  F&I profit\nTotal  =  Front + Back combined            PVR  =  Avg profit per car   Badges  =  Awards earned",
        x: 0.7, y: 3.7, w: 8.6, h: 1.4,
        fontSize: 12, color: COLORS.offWhite,
        lineSpacing: 135,
      },
    ],
  },

  // ── SLIDE 10: Deals Page ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "📝  The Deals Page — Every Car Sold",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.darkText,
      },
      {
        type: "text",
        text: "This is your deal log — a list of every single car sale at the event.",
        x: 0.8, y: 1.0, w: 8.4, h: 0.5,
        fontSize: 16, color: COLORS.medText,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 1.7, w: 8.4, h: 1.2, fillColor: COLORS.lightGreen,
      },
      {
        type: "text",
        text: "Each row = one car sale, with info like:\n🚗 Vehicle (stock #, year, make, model)  •  👤 Customer  •  🧑‍💼 Salesperson\n💰 Front Gross  •  💵 Back Gross  •  📊 Total Gross  •  📅 Date",
        x: 1.0, y: 1.8, w: 8.0, h: 1.0,
        fontSize: 14, color: COLORS.green,
        align: "CENTER",
        lineSpacing: 130,
      },
      {
        type: "text",
        text: "How to log a new deal:",
        x: 0.8, y: 3.2, w: 8.4, h: 0.4,
        fontSize: 20, bold: true, color: COLORS.darkText,
      },
      {
        type: "text",
        text: "1.  Click the \"New Deal\" button in the top right\n2.  Fill in the vehicle, customer, and gross numbers\n3.  Pick the salesperson from the roster dropdown\n4.  Hit Save — done! ✅",
        x: 1.0, y: 3.7, w: 8.0, h: 1.5,
        fontSize: 16, color: COLORS.medText,
        lineSpacing: 145,
      },
    ],
  },

  // ── SLIDE 11: What Happens When You Log a Deal ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "⚡  What Happens When You Log a Deal?",
        x: 0.6, y: 0.3, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.white,
      },
      {
        type: "text",
        text: "A lot of magic happens behind the scenes — automatically!",
        x: 0.8, y: 0.95, w: 8.4, h: 0.5,
        fontSize: 15, color: COLORS.gray, italic: true,
      },
      // Chain steps
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 1.7, w: 2.7, h: 1.6, fillColor: COLORS.blue,
      },
      {
        type: "text",
        text: "1️⃣\n\n💾 Deal Saved\n\nThe sale is recorded\nin the database",
        x: 0.5, y: 1.7, w: 2.7, h: 1.6,
        fontSize: 12, color: COLORS.white, align: "CENTER",
        lineSpacing: 115,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 3.65, y: 1.7, w: 2.7, h: 1.6, fillColor: COLORS.green,
      },
      {
        type: "text",
        text: "2️⃣\n\n🏆 Badges Check\n\nDid this earn any\nnew achievements?",
        x: 3.65, y: 1.7, w: 2.7, h: 1.6,
        fontSize: 12, color: COLORS.white, align: "CENTER",
        lineSpacing: 115,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 6.8, y: 1.7, w: 2.7, h: 1.6, fillColor: COLORS.orange,
      },
      {
        type: "text",
        text: "3️⃣\n\n🔥 Streak Updated\n\nConsecutive days\nwith a sale tracked",
        x: 6.8, y: 1.7, w: 2.7, h: 1.6,
        fontSize: 12, color: COLORS.white, align: "CENTER",
        lineSpacing: 115,
      },
      // Row 2
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 1.8, y: 3.6, w: 2.7, h: 1.4, fillColor: COLORS.purple,
      },
      {
        type: "text",
        text: "4️⃣\n\n🚗 Inventory Synced\n\nVehicle marked\nas \"sold\"",
        x: 1.8, y: 3.6, w: 2.7, h: 1.4,
        fontSize: 12, color: COLORS.white, align: "CENTER",
        lineSpacing: 115,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 5.5, y: 3.6, w: 2.7, h: 1.4, fillColor: COLORS.red,
      },
      {
        type: "text",
        text: "5️⃣\n\n🎉 Toast Pops Up!\n\n\"Badge Earned:\nFirst Blood!\"",
        x: 5.5, y: 3.6, w: 2.7, h: 1.4,
        fontSize: 12, color: COLORS.white, align: "CENTER",
        lineSpacing: 115,
      },
    ],
  },

  // ── SLIDE 12: Achievements Overview ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "🏆  Achievements — Badges, Points & Streaks",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 28, bold: true, color: COLORS.darkText,
      },
      {
        type: "text",
        text: "Think of it like earning trophies in a video game 🎮\nSell more, sell better → earn badges → climb the points leaderboard",
        x: 0.8, y: 1.1, w: 8.4, h: 0.7,
        fontSize: 16, color: COLORS.medText,
        align: "CENTER",
        lineSpacing: 135,
      },
      // 3 tab cards
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.4, y: 2.1, w: 2.9, h: 2.8, fillColor: COLORS.lightBlue,
      },
      {
        type: "text",
        text: "Tab 1: Badges 🎖️\n\nAll 18 badges shown\nin a grid.\n\n✅ Earned = full color\n🔒 Locked = grayed out\n\nEach badge has\na point value",
        x: 0.5, y: 2.2, w: 2.7, h: 2.6,
        fontSize: 13, color: COLORS.blue, align: "CENTER",
        lineSpacing: 120,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 3.55, y: 2.1, w: 2.9, h: 2.8, fillColor: COLORS.lightGreen,
      },
      {
        type: "text",
        text: "Tab 2: Team 👥\n\nTable showing each\nteam member's:\n\n• Badges earned\n• Total points\n• Current streak\n• Recent badge",
        x: 3.65, y: 2.2, w: 2.7, h: 2.6,
        fontSize: 13, color: COLORS.green, align: "CENTER",
        lineSpacing: 120,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 6.7, y: 2.1, w: 2.9, h: 2.8, fillColor: COLORS.lightOrange,
      },
      {
        type: "text",
        text: "Tab 3: Points 🥇\n\nLeaderboard ranked\nby total badge points.\n\nSeparate from the\ngross leaderboard —\nthis is about\nachievements!",
        x: 6.8, y: 2.2, w: 2.7, h: 2.6,
        fontSize: 13, color: rgb(180, 120, 0), align: "CENTER",
        lineSpacing: 120,
      },
    ],
  },

  // ── SLIDE 13: Badge Categories ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "🎖️  18 Badges Across 5 Categories",
        x: 0.6, y: 0.3, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.white,
      },
      // Sales
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.3, y: 1.2, w: 3.0, h: 1.6, fillColor: rgb(30, 58, 138),
      },
      {
        type: "text",
        text: "🔵 Sales (5 badges)\n\nFirst Blood • Hat Trick\n5-Pack • 10-Unit Club\n15-Car Legend",
        x: 0.4, y: 1.3, w: 2.8, h: 1.4,
        fontSize: 12, color: COLORS.lightBlue, align: "CENTER",
        lineSpacing: 120,
      },
      // Gross
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 3.5, y: 1.2, w: 3.0, h: 1.6, fillColor: rgb(20, 83, 45),
      },
      {
        type: "text",
        text: "🟢 Gross (4 badges)\n\n$10K Day • $25K Day\n$50K Total\n$100K Club",
        x: 3.6, y: 1.3, w: 2.8, h: 1.4,
        fontSize: 12, color: COLORS.lightGreen, align: "CENTER",
        lineSpacing: 120,
      },
      // Closing
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 6.7, y: 1.2, w: 3.0, h: 1.6, fillColor: rgb(76, 29, 149),
      },
      {
        type: "text",
        text: "🟣 Closing (3 badges)\n\nSharpshooter (20%+)\nSniper (30%+)\nCloser Supreme (40%+)",
        x: 6.8, y: 1.3, w: 2.8, h: 1.4,
        fontSize: 12, color: COLORS.lightPurple, align: "CENTER",
        lineSpacing: 120,
      },
      // Streak
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 1.8, y: 3.1, w: 3.0, h: 1.6, fillColor: rgb(120, 53, 15),
      },
      {
        type: "text",
        text: "🟠 Streak (3 badges)\n\nOn a Roll (2 days)\nHot Streak (3 days)\nIron Man (5+ days)",
        x: 1.9, y: 3.2, w: 2.8, h: 1.4,
        fontSize: 12, color: COLORS.lightOrange, align: "CENTER",
        lineSpacing: 120,
      },
      // Team
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 5.2, y: 3.1, w: 3.0, h: 1.6, fillColor: rgb(127, 29, 29),
      },
      {
        type: "text",
        text: "🔴 Team (3 badges)\n\nTop Dog (#1 on board)\nComeback Kid\nClean Sheet (0 washouts)",
        x: 5.3, y: 3.2, w: 2.8, h: 1.4,
        fontSize: 12, color: COLORS.lightRed, align: "CENTER",
        lineSpacing: 120,
      },
      {
        type: "text",
        text: "Badges are earned automatically when you hit the target — no manual action needed!",
        x: 0, y: 4.9, w: 10, h: 0.5,
        fontSize: 14, color: COLORS.gray, italic: true,
        align: "CENTER",
      },
    ],
  },

  // ── SLIDE 14: Streaks ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "🔥  Streaks — Keep the Momentum Going",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 30, bold: true, color: COLORS.darkText,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 1.3, w: 8.4, h: 1.3, fillColor: COLORS.lightOrange,
      },
      {
        type: "text",
        text: "A streak counts how many days IN A ROW you've made at least one sale.\nSell today + sell tomorrow = 2-day streak 🔥🔥\nMiss a day? Streak resets back to 1.",
        x: 1.0, y: 1.4, w: 8.0, h: 1.1,
        fontSize: 16, color: rgb(150, 100, 0),
        align: "CENTER",
        lineSpacing: 140,
      },
      {
        type: "text",
        text: "How it shows up:",
        x: 0.8, y: 2.9, w: 8.4, h: 0.4,
        fontSize: 20, bold: true, color: COLORS.darkText,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 3.5, w: 8.4, h: 1.6, fillColor: COLORS.white,
      },
      {
        type: "text",
        text: "🔥 3  (best: 5)    ← This means:\n\n• Current streak: 3 consecutive days with a sale\n• Best ever streak: 5 days (their personal record)\n• 🟠 Orange flame = 3+ days  •  🟡 Yellow = 1-2 days  •  ⚪ Gray = no streak",
        x: 1.0, y: 3.6, w: 8.0, h: 1.4,
        fontSize: 14, color: COLORS.medText,
        lineSpacing: 130,
      },
    ],
  },

  // ── SLIDE 15: Daily Metrics ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "📋  Daily Metrics — Enter Your Daily Numbers",
        x: 0.6, y: 0.4, w: 9, h: 0.7,
        fontSize: 28, bold: true, color: COLORS.darkText,
      },
      {
        type: "text",
        text: "A simple spreadsheet where you type in the daily totals for the event.",
        x: 0.8, y: 1.0, w: 8.4, h: 0.5,
        fontSize: 16, color: COLORS.medText,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.8, y: 1.7, w: 8.4, h: 1.5, fillColor: COLORS.white,
      },
      {
        type: "text",
        text: "Each row = one day of the event:\n\n📅 Date  •  👣 Ups (walk-ins)  •  🚗 Sold  •  💰 Total Gross\n💵 Front Gross  •  🏦 Back Gross  •  📝 Notes",
        x: 1.0, y: 1.8, w: 8.0, h: 1.3,
        fontSize: 14, color: COLORS.medText,
        align: "CENTER",
        lineSpacing: 130,
      },
      {
        type: "text",
        text: "How to use it:",
        x: 0.8, y: 3.4, w: 8.4, h: 0.4,
        fontSize: 20, bold: true, color: COLORS.darkText,
      },
      {
        type: "text",
        text: "1.  Click \"Add Day\" to add a new row (date auto-fills)\n2.  Type numbers directly into the cells\n3.  Changed rows turn yellow so you know what needs saving\n4.  Click \"Save Changes\" to save everything at once\n5.  Close % auto-calculates (you don't type it)",
        x: 1.0, y: 3.9, w: 8.0, h: 1.5,
        fontSize: 15, color: COLORS.medText,
        lineSpacing: 140,
      },
    ],
  },

  // ── SLIDE 16: Roster & Inventory ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "👥  Roster & 🚗 Inventory",
        x: 0.6, y: 0.3, w: 9, h: 0.7,
        fontSize: 32, bold: true, color: COLORS.white,
      },
      // Roster box
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.5, y: 1.2, w: 4.2, h: 3.5, fillColor: rgb(30, 41, 59),
      },
      {
        type: "text",
        text: "👥  Roster\n\nYour team for this event.\n\nEach person has:\n• Name\n• Role (Sales, Closer,\n   Team Leader, F&I)\n\nWhen you log a deal,\nyou pick the salesperson\nfrom this list.\n\nEveryone on the roster\nshows up on the leaderboard.",
        x: 0.7, y: 1.3, w: 3.8, h: 3.3,
        fontSize: 14, color: COLORS.offWhite,
        lineSpacing: 125,
      },
      // Inventory box
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 5.3, y: 1.2, w: 4.2, h: 3.5, fillColor: rgb(30, 41, 59),
      },
      {
        type: "text",
        text: "🚗  Inventory\n\nCars available at the\ndealership for this event.\n\nEach vehicle has:\n• Stock number\n• Year, Make, Model\n• Status (available/sold)\n\nWhen you log a deal\nwith a stock number,\nthat car automatically\ngets marked as \"sold\".",
        x: 5.5, y: 1.3, w: 3.8, h: 3.3,
        fontSize: 14, color: COLORS.offWhite,
        lineSpacing: 125,
      },
    ],
  },

  // ── SLIDE 17: Cheat Sheet ──
  {
    bg: COLORS.offWhite,
    elements: [
      {
        type: "text",
        text: "📌  Quick Reference Cheat Sheet",
        x: 0.6, y: 0.3, w: 9, h: 0.6,
        fontSize: 30, bold: true, color: COLORS.darkText,
      },
      {
        type: "shape", shapeType: "ROUND_RECTANGLE",
        x: 0.4, y: 1.0, w: 9.2, h: 4.3, fillColor: COLORS.white,
      },
      {
        type: "text",
        text: "\"I want to...\"                                                                     → Go here\n\n🔄  Switch which event I'm looking at             →  Event Switcher (top of sidebar)\n📊  See charts and rankings                              →  Performance page\n📝  Log a car sale                                               →  Deals → New Deal button\n🏆  See who earned badges                                →  Achievements page\n📋  Enter daily ups/sold/gross numbers            →  Daily Metrics page\n👥  Add a new team member                              →  Roster page\n🚗  Check what cars are left                                →  Inventory page\n💵  See who gets paid what                                →  Commissions page\n✏️  Edit a deal                                                      →  Deals → click the deal row\n🔄  Refresh the data                                            →  Click \"Refresh\" on Performance",
        x: 0.7, y: 1.1, w: 8.6, h: 4.1,
        fontSize: 13, color: COLORS.medText,
        lineSpacing: 138,
      },
    ],
  },

  // ── SLIDE 18: Closing ──
  {
    bg: COLORS.darkBg,
    elements: [
      {
        type: "text",
        text: "🎉",
        x: 0, y: 0.8, w: 10, h: 0.9,
        fontSize: 60, color: COLORS.white,
        align: "CENTER",
      },
      {
        type: "text",
        text: "You're Ready!",
        x: 0, y: 1.7, w: 10, h: 0.8,
        fontSize: 42, bold: true, color: COLORS.white,
        align: "CENTER",
      },
      {
        type: "text",
        text: "Remember the 3 steps:",
        x: 0, y: 2.6, w: 10, h: 0.5,
        fontSize: 18, color: COLORS.gray,
        align: "CENTER",
      },
      {
        type: "text",
        text: "1. Pick your event   🔄\n2. Log your deals   📝\n3. Watch the scoreboard   📊",
        x: 0, y: 3.1, w: 10, h: 1.2,
        fontSize: 22, bold: true, color: COLORS.blue,
        align: "CENTER",
        lineSpacing: 150,
      },
      {
        type: "text",
        text: "Everything else happens automatically. Go sell some cars! 🚗💨",
        x: 0, y: 4.5, w: 10, h: 0.5,
        fontSize: 16, color: COLORS.gray, italic: true,
        align: "CENTER",
      },
    ],
  },
];

// ─── Build Slides API requests ──────────────────────────────────────────────

function buildRequests() {
  const requests = [];

  // Create all slides first (slide 0 = the default blank one we'll reuse)
  for (let i = 1; i < SLIDES.length; i++) {
    requests.push({
      createSlide: {
        objectId: `slide_${i}`,
        insertionIndex: i,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    });
  }

  // Now add content to each slide
  SLIDES.forEach((slide, slideIdx) => {
    const slideId = slideIdx === 0 ? "p" : `slide_${slideIdx}`;

    // Set background color
    if (slide.bg) {
      requests.push({
        updatePageProperties: {
          objectId: slideId,
          pageProperties: {
            pageBackgroundFill: {
              solidFill: { color: { rgbColor: slide.bg } },
            },
          },
          fields: "pageBackgroundFill",
        },
      });
    }

    // Add elements
    slide.elements.forEach((el, elIdx) => {
      const elementId = `el_${slideIdx}_${elIdx}`;

      if (el.type === "shape") {
        // Create shape
        requests.push({
          createShape: {
            objectId: elementId,
            shapeType: el.shapeType,
            elementProperties: {
              pageObjectId: slideId,
              size: {
                width: { magnitude: emu(el.w), unit: "EMU" },
                height: { magnitude: emu(el.h), unit: "EMU" },
              },
              transform: {
                scaleX: 1, scaleY: 1,
                translateX: emu(el.x), translateY: emu(el.y),
                unit: "EMU",
              },
            },
          },
        });

        // Style the shape
        const shapeProps = {
          objectId: elementId,
          shapeProperties: {
            shapeBackgroundFill: {
              solidFill: { color: { rgbColor: el.fillColor } },
            },
            outline: { propertyState: "NOT_RENDERED" },
          },
          fields: "shapeBackgroundFill,outline",
        };
        requests.push({ updateShapeProperties: shapeProps });
      }

      if (el.type === "text") {
        // Create text box
        requests.push({
          createShape: {
            objectId: elementId,
            shapeType: "TEXT_BOX",
            elementProperties: {
              pageObjectId: slideId,
              size: {
                width: { magnitude: emu(el.w), unit: "EMU" },
                height: { magnitude: emu(el.h), unit: "EMU" },
              },
              transform: {
                scaleX: 1, scaleY: 1,
                translateX: emu(el.x), translateY: emu(el.y),
                unit: "EMU",
              },
            },
          },
        });

        // Insert text
        requests.push({
          insertText: {
            objectId: elementId,
            text: el.text,
            insertionIndex: 0,
          },
        });

        // Style the text
        const textStyle = {
          fontSize: { magnitude: el.fontSize || 14, unit: "PT" },
          foregroundColor: {
            opaqueColor: { rgbColor: el.color || COLORS.darkText },
          },
        };
        let fields = "fontSize,foregroundColor";

        if (el.bold) {
          textStyle.bold = true;
          fields += ",bold";
        }
        if (el.italic) {
          textStyle.italic = true;
          fields += ",italic";
        }

        requests.push({
          updateTextStyle: {
            objectId: elementId,
            style: textStyle,
            textRange: { type: "ALL" },
            fields,
          },
        });

        // Paragraph style (alignment, line spacing)
        const paragraphStyle = {};
        let pFields = "";

        if (el.align) {
          paragraphStyle.alignment = el.align;
          pFields += "alignment";
        }
        if (el.lineSpacing) {
          paragraphStyle.lineSpacing = el.lineSpacing;
          pFields += (pFields ? "," : "") + "lineSpacing";
        }

        if (pFields) {
          requests.push({
            updateParagraphStyle: {
              objectId: elementId,
              style: paragraphStyle,
              textRange: { type: "ALL" },
              fields: pFields,
            },
          });
        }

        // Remove outline from text boxes
        requests.push({
          updateShapeProperties: {
            objectId: elementId,
            shapeProperties: {
              outline: { propertyState: "NOT_RENDERED" },
            },
            fields: "outline",
          },
        });
      }
    });
  });

  return requests;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔑 Authenticating with Google service account...");
  const auth = await getAuth();

  const slides = google.slides({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  // 1. Create a new presentation
  console.log("📝 Creating presentation...");
  const presentation = await slides.presentations.create({
    requestBody: {
      title: "JDE Mission Control — Dashboard Guide",
    },
  });

  const presentationId = presentation.data.presentationId;
  console.log(`✅ Presentation created: ${presentationId}`);

  // 2. Build and send all slide requests
  console.log(`📊 Building ${SLIDES.length} slides...`);
  const requests = buildRequests();

  // Split into batches of 200 to avoid API limits
  const BATCH_SIZE = 200;
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    console.log(`  Sending batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} requests)...`);
    await slides.presentations.batchUpdate({
      presentationId,
      requestBody: { requests: batch },
    });
  }

  console.log("✅ All slides created!");

  // 3. Make the presentation publicly accessible via link
  console.log("🔗 Setting sharing permissions...");
  await drive.permissions.create({
    fileId: presentationId,
    requestBody: {
      role: "writer",
      type: "anyone",
    },
  });

  const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  console.log("\n" + "═".repeat(70));
  console.log("🎉 DONE! Your presentation is ready:");
  console.log(`\n   ${url}\n`);
  console.log("═".repeat(70));
  console.log("\nAnyone with the link can edit it. Open it in your browser!");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  if (err.response?.data) {
    console.error("Details:", JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
