/**
 * Sets up 4 clean Roster tabs in the JDE Mission Control spreadsheet:
 *   1. Roster       — Team entry with validation & formatting
 *   2. Lenders      — Lender list with buy rates
 *   3. Tables       — Table/seating assignments
 *   4. Summary      — Auto-calculated KPIs
 *
 * Uses the raw Sheets API batchUpdate for full control.
 */

const { JWT } = require("google-auth-library");
const fs = require("fs");
const path = require("path");

// ── Config ───────────────────────────────────────────────
const SPREADSHEET_ID = "10NUwAoUAsHsSCL4GrTiwjumvpa3TqMN56wqQ-rFPfrA";
const ENV_PATH = path.resolve(__dirname, "../.env.local");

// ── Auth ─────────────────────────────────────────────────
async function getToken() {
  const envContent = fs.readFileSync(ENV_PATH, "utf8");
  const saLine = envContent
    .split("\n")
    .find((l) => l.startsWith("GOOGLE_SERVICE_ACCOUNT_JSON="));
  const saJson = saLine
    .split("=")
    .slice(1)
    .join("=")
    .trim()
    .replace(/^'/, "")
    .replace(/'$/, "");
  const sa = JSON.parse(saJson);
  const auth = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  return (await auth.getAccessToken()).token;
}

// ── Helpers ──────────────────────────────────────────────
function rgb(r, g, b) {
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: 1 };
}
const WHITE = rgb(255, 255, 255);
const DARK = rgb(30, 30, 30);
const HEADER_BG = rgb(55, 65, 81);    // dark slate
const HEADER_FG = WHITE;
const LIGHT_GREEN = rgb(220, 252, 231);
const LIGHT_RED = rgb(254, 226, 226);
const LIGHT_BLUE = rgb(219, 234, 254);
const LIGHT_YELLOW = rgb(254, 249, 195);
const LIGHT_GRAY = rgb(243, 244, 246);

function textCell(text, bold = false, bg = null, fg = null, fmt = "TEXT") {
  const cell = {
    userEnteredValue:
      fmt === "NUMBER"
        ? { numberValue: Number(text) || 0 }
        : fmt === "FORMULA"
          ? { formulaValue: text }
          : fmt === "BOOL"
            ? { boolValue: text === true || text === "TRUE" }
            : { stringValue: String(text) },
    userEnteredFormat: {
      textFormat: { bold, fontSize: 10 },
      verticalAlignment: "MIDDLE",
    },
  };
  if (bg) cell.userEnteredFormat.backgroundColor = bg;
  if (fg) cell.userEnteredFormat.textFormat.foregroundColor = fg;
  return cell;
}

function headerCell(text) {
  return textCell(text, true, HEADER_BG, HEADER_FG);
}

// ── Main ─────────────────────────────────────────────────
async function main() {
  const token = await getToken();
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

  // Step 1: Get existing sheet IDs so we don't duplicate
  const metaRes = await fetch(baseUrl + "?fields=sheets.properties", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json();
  const existingSheets = meta.sheets.map((s) => s.properties.title);
  console.log("Existing sheets:", existingSheets.length);

  // We'll create tabs with unique IDs
  const ROSTER_ID = 9001;
  const LENDERS_ID = 9002;
  const TABLES_ID = 9003;
  const SUMMARY_ID = 9004;

  const tabsToCreate = [
    { title: "Roster", id: ROSTER_ID, color: rgb(34, 197, 94) },
    { title: "Lenders", id: LENDERS_ID, color: rgb(59, 130, 246) },
    { title: "Tables", id: TABLES_ID, color: rgb(249, 115, 22) },
    { title: "Summary", id: SUMMARY_ID, color: rgb(168, 85, 247) },
  ];

  // ── Build batchUpdate requests ──────────────────────────
  const requests = [];

  // 1) Create sheets (skip if already exists)
  for (const tab of tabsToCreate) {
    if (existingSheets.includes(tab.title)) {
      console.log(`  "${tab.title}" already exists — will clear and rebuild`);
      // Find the existing sheet ID
      const existing = meta.sheets.find(
        (s) => s.properties.title === tab.title,
      );
      if (existing) {
        tab.id = existing.properties.sheetId;
        // Clear content
        requests.push({
          updateCells: {
            range: { sheetId: tab.id },
            fields: "userEnteredValue,userEnteredFormat,dataValidation",
          },
        });
      }
    } else {
      requests.push({
        addSheet: {
          properties: {
            sheetId: tab.id,
            title: tab.title,
            tabColorStyle: { rgbColor: tab.color },
            gridProperties: { rowCount: 200, columnCount: 15 },
          },
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  // ROSTER TAB
  // ══════════════════════════════════════════════════════════

  const rosterHeaders = [
    "ID",
    "Name",
    "Phone",
    "Email",
    "Role",
    "Team",
    "Comm %",
    "Confirmed",
    "Active",
    "Notes",
  ];

  // Instruction row (row 1)
  requests.push({
    updateCells: {
      start: { sheetId: ROSTER_ID, rowIndex: 0, columnIndex: 0 },
      rows: [
        {
          values: [
            {
              userEnteredValue: {
                stringValue:
                  "📋 Fill this sheet first → then open JDE Mission Control. Everything syncs automatically.",
              },
              userEnteredFormat: {
                textFormat: {
                  bold: true,
                  fontSize: 12,
                  foregroundColor: rgb(30, 64, 175),
                },
                backgroundColor: LIGHT_BLUE,
                verticalAlignment: "MIDDLE",
                wrapStrategy: "WRAP",
              },
            },
          ],
        },
      ],
      fields: "userEnteredValue,userEnteredFormat",
    },
  });

  // Merge instruction row across all columns
  requests.push({
    mergeCells: {
      range: {
        sheetId: ROSTER_ID,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 10,
      },
      mergeType: "MERGE_ALL",
    },
  });

  // Header row (row 2)
  requests.push({
    updateCells: {
      start: { sheetId: ROSTER_ID, rowIndex: 1, columnIndex: 0 },
      rows: [{ values: rosterHeaders.map((h) => headerCell(h)) }],
      fields: "userEnteredValue,userEnteredFormat",
    },
  });

  // Freeze top 2 rows
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: ROSTER_ID,
        gridProperties: { frozenRowCount: 2 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // Column widths
  const rosterWidths = [60, 200, 130, 220, 130, 100, 80, 90, 70, 200];
  rosterWidths.forEach((w, i) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: ROSTER_ID,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: w },
        fields: "pixelSize",
      },
    });
  });

  // Row height for instruction row
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: ROSTER_ID,
        dimension: "ROWS",
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 40 },
      fields: "pixelSize",
    },
  });

  // Auto-ID formula in column A (rows 3-100)
  // =IF(B3<>"", "R_"&TEXT(ROW()-2,"000"), "")
  for (let r = 2; r < 100; r++) {
    requests.push({
      updateCells: {
        start: { sheetId: ROSTER_ID, rowIndex: r, columnIndex: 0 },
        rows: [
          {
            values: [
              {
                userEnteredValue: {
                  formulaValue: `=IF(B${r + 1}<>"","R_"&TEXT(ROW()-2,"000"),"")`,
                },
                userEnteredFormat: {
                  textFormat: { fontSize: 10, foregroundColor: rgb(107, 114, 128) },
                  verticalAlignment: "MIDDLE",
                },
              },
            ],
          },
        ],
        fields: "userEnteredValue,userEnteredFormat",
      },
    });
  }

  // Data validation: Role dropdown (col E, rows 3-100)
  requests.push({
    setDataValidation: {
      range: {
        sheetId: ROSTER_ID,
        startRowIndex: 2,
        endRowIndex: 100,
        startColumnIndex: 4,
        endColumnIndex: 5,
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: [
            { userEnteredValue: "Sales" },
            { userEnteredValue: "Team Leader" },
            { userEnteredValue: "F&I Manager" },
            { userEnteredValue: "Closer" },
            { userEnteredValue: "Manager" },
            { userEnteredValue: "Support" },
          ],
        },
        showCustomUi: true,
        strict: true,
      },
    },
  });

  // Data validation: Comm % (col G) — number between 0 and 1
  requests.push({
    setDataValidation: {
      range: {
        sheetId: ROSTER_ID,
        startRowIndex: 2,
        endRowIndex: 100,
        startColumnIndex: 6,
        endColumnIndex: 7,
      },
      rule: {
        condition: {
          type: "NUMBER_BETWEEN",
          values: [
            { userEnteredValue: "0" },
            { userEnteredValue: "1" },
          ],
        },
        strict: true,
      },
    },
  });

  // Format Comm % column as percentage
  requests.push({
    repeatCell: {
      range: {
        sheetId: ROSTER_ID,
        startRowIndex: 2,
        endRowIndex: 100,
        startColumnIndex: 6,
        endColumnIndex: 7,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "PERCENT", pattern: "0%" },
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat.numberFormat,userEnteredFormat.verticalAlignment",
    },
  });

  // Data validation: Confirmed checkbox (col H)
  requests.push({
    setDataValidation: {
      range: {
        sheetId: ROSTER_ID,
        startRowIndex: 2,
        endRowIndex: 100,
        startColumnIndex: 7,
        endColumnIndex: 8,
      },
      rule: { condition: { type: "BOOLEAN" }, showCustomUi: true },
    },
  });

  // Data validation: Active checkbox (col I)
  requests.push({
    setDataValidation: {
      range: {
        sheetId: ROSTER_ID,
        startRowIndex: 2,
        endRowIndex: 100,
        startColumnIndex: 8,
        endColumnIndex: 9,
      },
      rule: { condition: { type: "BOOLEAN" }, showCustomUi: true },
    },
  });

  // Conditional formatting: green row when Confirmed=TRUE
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: ROSTER_ID,
            startRowIndex: 2,
            endRowIndex: 100,
            startColumnIndex: 0,
            endColumnIndex: 10,
          },
        ],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: "=$H3=TRUE" }],
          },
          format: { backgroundColor: LIGHT_GREEN },
        },
      },
      index: 0,
    },
  });

  // Conditional formatting: light red when Name is filled but Phone AND Email are empty
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: ROSTER_ID,
            startRowIndex: 2,
            endRowIndex: 100,
            startColumnIndex: 2,
            endColumnIndex: 4,
          },
        ],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [
              {
                userEnteredValue:
                  '=AND($B3<>"", C3="")',
              },
            ],
          },
          format: { backgroundColor: LIGHT_RED },
        },
      },
      index: 1,
    },
  });

  // Pre-fill existing roster data from the old sheet
  const existingRoster = [
    ["NATE HARDING", "", "", "Sales", "", "", true, true, ""],
    ["IRELAND COMBS", "", "", "Sales", "", "", true, true, ""],
    ["TREVON HALL", "", "", "Sales", "", "", true, true, ""],
    ["DREW O'DEI", "", "", "Sales", "", "", true, true, ""],
    ["NICK WILEY", "", "", "Sales", "", "", true, true, ""],
    ["HALEY DELUDE", "", "", "Team Leader", "", "", true, true, ""],
    ["DARRELL ALBERICO", "", "", "Sales", "", "", true, true, ""],
    ["BRYANT ROGERS", "", "", "Sales", "", "", true, true, ""],
    ["ABDUL AL TABBAH", "", "", "Sales", "", "", true, true, ""],
    ["JOSE TORRES", "", "", "Sales", "", "", true, true, ""],
    ["IGOR PLETNOR", "", "", "Sales", "", "", true, true, ""],
    ["MAYCON MIKE GUIMARAES", "", "", "F&I Manager", "", "", true, true, ""],
    ["OSSIE SAMPSON", "", "", "Sales", "", "", true, true, ""],
    ['MAKOTO "TOKYO" MACHO', "", "", "Sales", "", "", true, true, ""],
    ["BRYAN ROGERS", "", "", "Sales", "", "", true, true, ""],
    ["CHRIS MARTIN", "", "", "Sales", "", "", true, true, ""],
    ["MIKE LASHLEY", "", "", "Closer", "", "", false, true, ""],
    ["RJ", "", "", "Closer", "", "", false, true, ""],
  ];

  // Write roster data starting at row 3 (col B onward; col A has the formula)
  for (let i = 0; i < existingRoster.length; i++) {
    const [name, phone, email, role, team, commPct, confirmed, active, notes] =
      existingRoster[i];
    requests.push({
      updateCells: {
        start: { sheetId: ROSTER_ID, rowIndex: i + 2, columnIndex: 1 },
        rows: [
          {
            values: [
              textCell(name),
              textCell(phone),
              textCell(email),
              textCell(role),
              textCell(team),
              commPct ? textCell(commPct, false, null, null, "NUMBER") : textCell(""),
              textCell(confirmed, false, null, null, "BOOL"),
              textCell(active, false, null, null, "BOOL"),
              textCell(notes),
            ],
          },
        ],
        fields: "userEnteredValue,userEnteredFormat",
      },
    });
  }

  // Enable filter on header row
  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId: ROSTER_ID,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
      },
    },
  });

  // ══════════════════════════════════════════════════════════
  // LENDERS TAB
  // ══════════════════════════════════════════════════════════

  const lenderHeaders = ["Lender Name", "Buy Rate %", "Max Advance", "Notes", "Active"];

  requests.push({
    updateCells: {
      start: { sheetId: LENDERS_ID, rowIndex: 0, columnIndex: 0 },
      rows: [{ values: lenderHeaders.map((h) => headerCell(h)) }],
      fields: "userEnteredValue,userEnteredFormat",
    },
  });

  // Freeze row 1
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: LENDERS_ID,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // Column widths
  [200, 100, 120, 250, 70].forEach((w, i) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: LENDERS_ID,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: w },
        fields: "pixelSize",
      },
    });
  });

  // Buy Rate % format
  requests.push({
    repeatCell: {
      range: {
        sheetId: LENDERS_ID,
        startRowIndex: 1,
        endRowIndex: 50,
        startColumnIndex: 1,
        endColumnIndex: 2,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "PERCENT", pattern: "0.00%" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // Max Advance currency format
  requests.push({
    repeatCell: {
      range: {
        sheetId: LENDERS_ID,
        startRowIndex: 1,
        endRowIndex: 50,
        startColumnIndex: 2,
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: "$#,##0" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // Active checkbox
  requests.push({
    setDataValidation: {
      range: {
        sheetId: LENDERS_ID,
        startRowIndex: 1,
        endRowIndex: 50,
        startColumnIndex: 4,
        endColumnIndex: 5,
      },
      rule: { condition: { type: "BOOLEAN" }, showCustomUi: true },
    },
  });

  // Pre-fill existing lenders
  const existingLenders = [
    ["5th/3rd", "", "", "", true],
    ["Chase", "", "", "", true],
    ["GM Financial (Retail)", "", "", "", true],
    ["GM Financial (Lease)", "", "", "", true],
    ["KeyBank N.A.", "", "", "", true],
    ["Ally", "", "", "", true],
    ["Mazda Capital", "", "", "", true],
    ["Bank of America", "", "", "", true],
    ["Gateway", "", "", "", true],
    ["NBT Bank", "", "", "", true],
    ["Capital One", "", "", "", true],
    ["Huntington", "", "", "", true],
    ["TD Auto", "", "", "", true],
    ["HANSCOM Federal CU", "", "", "", true],
    ["Service CU", "", "", "", true],
    ["Wells Fargo", "", "", "", true],
    ["CASH", "", "", "No lender — cash deal", true],
  ];

  for (let i = 0; i < existingLenders.length; i++) {
    const [name, rate, maxAdv, notes, active] = existingLenders[i];
    requests.push({
      updateCells: {
        start: { sheetId: LENDERS_ID, rowIndex: i + 1, columnIndex: 0 },
        rows: [
          {
            values: [
              textCell(name),
              rate ? textCell(rate, false, null, null, "NUMBER") : textCell(""),
              maxAdv ? textCell(maxAdv, false, null, null, "NUMBER") : textCell(""),
              textCell(notes),
              textCell(active, false, null, null, "BOOL"),
            ],
          },
        ],
        fields: "userEnteredValue,userEnteredFormat",
      },
    });
  }

  // Filter on header
  requests.push({
    setBasicFilter: {
      filter: {
        range: {
          sheetId: LENDERS_ID,
          startRowIndex: 0,
          endRowIndex: 50,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
      },
    },
  });

  // ══════════════════════════════════════════════════════════
  // TABLES TAB
  // ══════════════════════════════════════════════════════════

  const tableHeaders = ["Table #", "Capacity", "Assigned Team", "Status", "Notes"];

  requests.push({
    updateCells: {
      start: { sheetId: TABLES_ID, rowIndex: 0, columnIndex: 0 },
      rows: [{ values: tableHeaders.map((h) => headerCell(h)) }],
      fields: "userEnteredValue,userEnteredFormat",
    },
  });

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: TABLES_ID,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  });

  [80, 90, 200, 120, 250].forEach((w, i) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: TABLES_ID,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: w },
        fields: "pixelSize",
      },
    });
  });

  // Status dropdown
  requests.push({
    setDataValidation: {
      range: {
        sheetId: TABLES_ID,
        startRowIndex: 1,
        endRowIndex: 30,
        startColumnIndex: 3,
        endColumnIndex: 4,
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: [
            { userEnteredValue: "Open" },
            { userEnteredValue: "Assigned" },
            { userEnteredValue: "Closed" },
          ],
        },
        showCustomUi: true,
        strict: true,
      },
    },
  });

  // Conditional formatting for status
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: TABLES_ID,
            startRowIndex: 1,
            endRowIndex: 30,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
        ],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: '=$D2="Assigned"' }],
          },
          format: { backgroundColor: LIGHT_GREEN },
        },
      },
      index: 0,
    },
  });

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: TABLES_ID,
            startRowIndex: 1,
            endRowIndex: 30,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
        ],
        booleanRule: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: '=$D2="Closed"' }],
          },
          format: { backgroundColor: LIGHT_GRAY },
        },
      },
      index: 1,
    },
  });

  // Pre-fill 10 tables
  for (let i = 1; i <= 10; i++) {
    requests.push({
      updateCells: {
        start: { sheetId: TABLES_ID, rowIndex: i, columnIndex: 0 },
        rows: [
          {
            values: [
              textCell(String(i), false, null, null, "NUMBER"),
              textCell("4", false, null, null, "NUMBER"),
              textCell(""),
              textCell("Open"),
              textCell(""),
            ],
          },
        ],
        fields: "userEnteredValue,userEnteredFormat",
      },
    });
  }

  // ══════════════════════════════════════════════════════════
  // SUMMARY TAB
  // ══════════════════════════════════════════════════════════

  const summaryData = [
    // Row 1: Title
    [
      {
        userEnteredValue: { stringValue: "📊 Roster Summary" },
        userEnteredFormat: {
          textFormat: { bold: true, fontSize: 16, foregroundColor: DARK },
          backgroundColor: LIGHT_YELLOW,
          verticalAlignment: "MIDDLE",
        },
      },
    ],
    // Row 2: blank
    [],
    // Row 3: Section header
    [
      headerCell("Metric"),
      headerCell("Count"),
      { userEnteredValue: { stringValue: "" } },
      headerCell("Team Breakdown"),
      headerCell("Count"),
    ],
    // Row 4: Total Team
    [
      textCell("Total Team Members", true),
      textCell('=COUNTA(Roster!B3:B100)', false, null, null, "FORMULA"),
      textCell(""),
      textCell("Sales", true),
      textCell('=COUNTIF(Roster!E3:E100,"Sales")', false, null, null, "FORMULA"),
    ],
    // Row 5: Confirmed
    [
      textCell("Confirmed", true, LIGHT_GREEN),
      textCell('=COUNTIF(Roster!H3:H100,TRUE)', false, LIGHT_GREEN, null, "FORMULA"),
      textCell(""),
      textCell("Team Leaders", true),
      textCell('=COUNTIF(Roster!E3:E100,"Team Leader")', false, null, null, "FORMULA"),
    ],
    // Row 6: Pending Confirmation
    [
      textCell("Pending Confirmation", true, LIGHT_RED),
      textCell(
        '=COUNTA(Roster!B3:B100)-COUNTIF(Roster!H3:H100,TRUE)',
        false,
        LIGHT_RED,
        null,
        "FORMULA",
      ),
      textCell(""),
      textCell("F&I Managers", true),
      textCell('=COUNTIF(Roster!E3:E100,"F&I Manager")', false, null, null, "FORMULA"),
    ],
    // Row 7: Active Members
    [
      textCell("Active Members", true),
      textCell('=COUNTIF(Roster!I3:I100,TRUE)', false, null, null, "FORMULA"),
      textCell(""),
      textCell("Closers", true),
      textCell('=COUNTIF(Roster!E3:E100,"Closer")', false, null, null, "FORMULA"),
    ],
    // Row 8: Inactive
    [
      textCell("Inactive Members", true),
      textCell(
        '=COUNTA(Roster!B3:B100)-COUNTIF(Roster!I3:I100,TRUE)',
        false,
        null,
        null,
        "FORMULA",
      ),
      textCell(""),
      textCell("Managers", true),
      textCell('=COUNTIF(Roster!E3:E100,"Manager")', false, null, null, "FORMULA"),
    ],
    // Row 9
    [
      textCell(""),
      textCell(""),
      textCell(""),
      textCell("Support", true),
      textCell('=COUNTIF(Roster!E3:E100,"Support")', false, null, null, "FORMULA"),
    ],
    // Row 10: blank
    [],
    // Row 11: Lenders section
    [headerCell("Lenders"), headerCell("Count")],
    // Row 12
    [
      textCell("Total Lenders", true),
      textCell('=COUNTA(Lenders!A2:A50)', false, null, null, "FORMULA"),
    ],
    // Row 13
    [
      textCell("Active Lenders", true),
      textCell('=COUNTIF(Lenders!E2:E50,TRUE)', false, null, null, "FORMULA"),
    ],
    // Row 14: blank
    [],
    // Row 15: Tables section
    [headerCell("Tables"), headerCell("Count")],
    // Row 16
    [
      textCell("Total Tables", true),
      textCell('=COUNTA(Tables!A2:A30)', false, null, null, "FORMULA"),
    ],
    // Row 17
    [
      textCell("Assigned", true, LIGHT_GREEN),
      textCell(
        '=COUNTIF(Tables!D2:D30,"Assigned")',
        false,
        LIGHT_GREEN,
        null,
        "FORMULA",
      ),
    ],
    // Row 18
    [
      textCell("Open", true),
      textCell('=COUNTIF(Tables!D2:D30,"Open")', false, null, null, "FORMULA"),
    ],
    // Row 19
    [
      textCell("Closed", true, LIGHT_GRAY),
      textCell(
        '=COUNTIF(Tables!D2:D30,"Closed")',
        false,
        LIGHT_GRAY,
        null,
        "FORMULA",
      ),
    ],
  ];

  // Write summary
  requests.push({
    updateCells: {
      start: { sheetId: SUMMARY_ID, rowIndex: 0, columnIndex: 0 },
      rows: summaryData.map((row) => ({ values: row })),
      fields: "userEnteredValue,userEnteredFormat",
    },
  });

  // Merge title row
  requests.push({
    mergeCells: {
      range: {
        sheetId: SUMMARY_ID,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 5,
      },
      mergeType: "MERGE_ALL",
    },
  });

  // Title row height
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: SUMMARY_ID,
        dimension: "ROWS",
        startIndex: 0,
        endIndex: 1,
      },
      properties: { pixelSize: 50 },
      fields: "pixelSize",
    },
  });

  // Summary column widths
  [200, 100, 30, 200, 100].forEach((w, i) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: SUMMARY_ID,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: w },
        fields: "pixelSize",
      },
    });
  });

  // Freeze row 1 on Summary
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: SUMMARY_ID,
        gridProperties: { frozenRowCount: 1 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // ── Execute ──────────────────────────────────────────────
  console.log(`\nSending ${requests.length} requests...`);

  const batchRes = await fetch(baseUrl + ":batchUpdate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!batchRes.ok) {
    const errText = await batchRes.text();
    console.error("batchUpdate FAILED:", batchRes.status, errText);
    process.exit(1);
  }

  const result = await batchRes.json();
  console.log(
    `\n✅ Done! ${result.replies?.length ?? 0} operations completed.`,
  );
  console.log("Tabs created: Roster, Lenders, Tables, Summary");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
