/**
 * GET /api/template
 * Generates and returns a standardized JDE event Excel template (.xlsx)
 * with correctly named sheets and headers that the auto-mapper recognizes
 * with 100% confidence.
 */
import { NextResponse } from "next/server";
import ExcelJS from "@protobi/exceljs";

// ── Sheet definitions ──────────────────────────────────
// Each sheet has a name (matching tab-detection keywords) and headers
// that map 1:1 to DB fields via the auto-mapper.

const SHEETS: { name: string; headers: string[]; columnWidths?: number[] }[] = [
  {
    name: "Deal Log",
    headers: [
      "Deal #",
      "Sale Day",
      "Sale Date",
      "Customer",
      "Zip",
      "Phone",
      "Stock #",
      "Year",
      "Make",
      "Model",
      "Type",
      "Cost",
      "Age",
      "N/U",
      "Trade Year",
      "Trade Make",
      "Trade Model",
      "Trade Type",
      "Trade Miles",
      "Trade ACV",
      "Payoff",
      "1st Rep",
      "SP %",
      "2nd Rep",
      "2nd SP %",
      "Selling Price",
      "Front Gross",
      "Lender",
      "Rate",
      "Finance Type",
      "Reserve",
      "Warranty",
      "GAP",
      "AFT 1",
      "AFT 2",
      "Doc Fee",
      "Source",
      "Notes",
    ],
    columnWidths: [
      8, 8, 12, 22, 10, 14, 10, 6, 10, 12, 8, 12, 6, 5,
      6, 10, 12, 8, 10, 12, 12,
      16, 6, 16, 8,
      12, 12, 16, 6, 12, 10, 10, 10, 10, 10, 10, 12, 20,
    ],
  },
  {
    name: "Inventory",
    headers: [
      "Hat #",
      "Stock #",
      "VIN",
      "Year",
      "Make",
      "Model",
      "Trim",
      "Body Style",
      "Color",
      "Mileage",
      "Age",
      "Drivetrain",
      "Cost",
      "JD Trade Clean",
      "JD Retail Clean",
      "115%",
      "120%",
      "125%",
      "130%",
      "Profit 115",
      "Profit 120",
      "Profit 125",
      "Profit 130",
      "Difference",
      "Location",
      "Label",
      "Notes",
    ],
    columnWidths: [
      8, 10, 20, 6, 10, 12, 12, 12, 10, 10, 6, 10, 12,
      14, 14, 10, 10, 10, 10, 10, 10, 10, 10, 12, 14, 10, 20,
    ],
  },
  {
    name: "Campaign Tracking",
    headers: [
      "Zip",
      "Town",
      "Pieces",
      "Day 1",
      "Day 2",
      "Day 3",
      "Day 4",
      "Day 5",
      "Day 6",
      "Day 7",
      "Day 8",
      "Day 9",
      "Day 10",
      "Day 11",
      "Day 12",
      "Zip Total Ups",
    ],
    columnWidths: [
      10, 16, 10, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 14,
    ],
  },
  {
    name: "Roster & Lenders",
    headers: [
      "Salespeople",
      "Phone",
      "Confirmed",
      "Role",
      "Setup",
      "According To",
      "Lenders",
    ],
    columnWidths: [20, 14, 12, 14, 14, 16, 16],
  },
];

// ── Style constants ────────────────────────────────────

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" }, // Dark navy
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
  name: "Calibri",
};

const HEADER_BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: "thin", color: { argb: "FF999999" } },
};

const HEADER_ALIGNMENT: Partial<ExcelJS.Alignment> = {
  vertical: "middle",
  horizontal: "center",
  wrapText: true,
};

export async function GET() {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "JDE Mission Control";
    workbook.created = new Date();

    for (const sheet of SHEETS) {
      const ws = workbook.addWorksheet(sheet.name);

      // Add header row
      const headerRow = ws.addRow(sheet.headers);
      headerRow.height = 28;

      // Style each header cell
      headerRow.eachCell((cell, colNumber) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.border = HEADER_BORDER;
        cell.alignment = HEADER_ALIGNMENT;

        // Set column width
        if (sheet.columnWidths && sheet.columnWidths[colNumber - 1]) {
          ws.getColumn(colNumber).width = sheet.columnWidths[colNumber - 1];
        }
      });

      // Freeze header row
      ws.views = [{ state: "frozen", ySplit: 1 }];

      // Auto-filter on header row
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.headers.length },
      };
    }

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="JDE_Event_Template.xlsx"',
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("[template] Failed to generate template:", err);
    return NextResponse.json(
      { error: "Failed to generate template" },
      { status: 500 },
    );
  }
}
