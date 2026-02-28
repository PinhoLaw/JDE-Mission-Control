import ExcelJS from "@protobi/exceljs";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import { createElement } from "react";

// ─── Shared types ────────────────────────────────────────

export interface CommissionEntry {
  name: string;
  commissionRate: number;
  fullDeals: number;
  splitDeals: number;
  weightedFrontGross: number;
  totalBackGross: number;
  totalGross: number;
  commission: number;
  washouts: number;
  avgPVR: number;
}

interface ExportMeta {
  eventName: string;
  defaultRate: number;
  dateFrom?: string;
  dateTo?: string;
}

// ─── Helpers ─────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═════════════════════════════════════════════════════════
// Excel Export (ExcelJS)
// ═════════════════════════════════════════════════════════

export async function generateCommissionExcel(
  data: CommissionEntry[],
  meta: ExportMeta,
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JDE Mission Control";
  wb.created = new Date();

  const ws = wb.addWorksheet("Commission Report");

  // ── Title rows ──
  const titleRow = ws.addRow([`Commission Payout Report — ${meta.eventName}`]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells("A1:J1");

  const dateStr = meta.dateFrom || meta.dateTo
    ? `Date range: ${meta.dateFrom ?? "—"} to ${meta.dateTo ?? "—"}`
    : "All dates";
  const subRow = ws.addRow([
    `Generated ${new Date().toLocaleDateString("en-US")} | ${dateStr} | Default rate: ${fmtPct(meta.defaultRate)}`,
  ]);
  subRow.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  ws.mergeCells("A2:J2");

  ws.addRow([]); // blank spacer

  // ── Header row ──
  const headers = [
    "Salesperson",
    "Rate",
    "Full Deals",
    "Splits",
    "Weighted Front",
    "Back Gross",
    "Total Gross",
    "Avg PVR",
    "Commission",
    "Washouts",
  ];
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    cell.alignment = { horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
  });

  // ── Data rows ──
  for (const c of data) {
    const row = ws.addRow([
      c.name,
      fmtPct(c.commissionRate),
      c.fullDeals,
      c.splitDeals,
      c.weightedFrontGross,
      c.totalBackGross,
      c.totalGross,
      c.avgPVR,
      c.commission,
      c.washouts,
    ]);
    // Currency formatting for columns 5-9
    [5, 6, 7, 8, 9].forEach((col) => {
      const cell = row.getCell(col);
      cell.numFmt = '"$"#,##0.00';
    });
    row.getCell(2).alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(4).alignment = { horizontal: "center" };
    row.getCell(10).alignment = { horizontal: "center" };
  }

  // ── Totals row ──
  const totals = data.reduce(
    (acc, c) => ({
      fullDeals: acc.fullDeals + c.fullDeals,
      splitDeals: acc.splitDeals + c.splitDeals,
      weightedFrontGross: acc.weightedFrontGross + c.weightedFrontGross,
      totalBackGross: acc.totalBackGross + c.totalBackGross,
      totalGross: acc.totalGross + c.totalGross,
      commission: acc.commission + c.commission,
      washouts: acc.washouts + c.washouts,
    }),
    {
      fullDeals: 0,
      splitDeals: 0,
      weightedFrontGross: 0,
      totalBackGross: 0,
      totalGross: 0,
      commission: 0,
      washouts: 0,
    },
  );

  const totalRow = ws.addRow([
    "TOTALS",
    "—",
    totals.fullDeals,
    totals.splitDeals,
    totals.weightedFrontGross,
    totals.totalBackGross,
    totals.totalGross,
    "—",
    totals.commission,
    totals.washouts,
  ]);
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => {
    cell.border = {
      top: { style: "double", color: { argb: "FF000000" } },
    };
  });
  [5, 6, 7, 9].forEach((col) => {
    totalRow.getCell(col).numFmt = '"$"#,##0.00';
  });

  // ── Column widths ──
  ws.columns = [
    { width: 22 }, // Salesperson
    { width: 8 },  // Rate
    { width: 10 }, // Full Deals
    { width: 8 },  // Splits
    { width: 16 }, // Weighted Front
    { width: 14 }, // Back Gross
    { width: 14 }, // Total Gross
    { width: 12 }, // Avg PVR
    { width: 14 }, // Commission
    { width: 10 }, // Washouts
  ];

  // ── Generate and download ──
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safeName = meta.eventName.replace(/[^a-zA-Z0-9]/g, "_");
  triggerDownload(blob, `commissions_${safeName}.xlsx`);
}

// ═════════════════════════════════════════════════════════
// PDF Export (@react-pdf/renderer)
// ═════════════════════════════════════════════════════════

const pdfStyles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 15,
    borderBottomWidth: 2,
    borderBottomColor: "#2563eb",
    paddingBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1e293b",
    fontFamily: "Helvetica-Bold",
  },
  subtitle: {
    fontSize: 10,
    color: "#64748b",
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: "row",
    marginBottom: 15,
    gap: 10,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    padding: 8,
  },
  summaryLabel: {
    fontSize: 7,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    marginTop: 2,
  },
  table: {
    marginTop: 5,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#2563eb",
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    color: "#ffffff",
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e2e8f0",
  },
  tableRowAlt: {
    backgroundColor: "#f8fafc",
  },
  tableCell: {
    fontSize: 8,
    color: "#334155",
  },
  tableCellBold: {
    fontSize: 8,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderTopWidth: 2,
    borderTopColor: "#1e293b",
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#94a3b8",
    borderTopWidth: 0.5,
    borderTopColor: "#e2e8f0",
    paddingTop: 5,
  },
  // Column widths (percentages of table width)
  colName: { width: "18%" },
  colRate: { width: "6%", textAlign: "center" },
  colFull: { width: "7%", textAlign: "center" },
  colSplit: { width: "7%", textAlign: "center" },
  colFront: { width: "13%", textAlign: "right" },
  colBack: { width: "12%", textAlign: "right" },
  colTotal: { width: "12%", textAlign: "right" },
  colPVR: { width: "10%", textAlign: "right" },
  colComm: { width: "11%", textAlign: "right" },
  colWash: { width: "4%", textAlign: "center" },
});

function CommissionPDFDocument({
  data,
  meta,
}: {
  data: CommissionEntry[];
  meta: ExportMeta;
}) {
  const totals = data.reduce(
    (acc, c) => ({
      fullDeals: acc.fullDeals + c.fullDeals,
      splitDeals: acc.splitDeals + c.splitDeals,
      weightedFrontGross: acc.weightedFrontGross + c.weightedFrontGross,
      totalBackGross: acc.totalBackGross + c.totalBackGross,
      totalGross: acc.totalGross + c.totalGross,
      commission: acc.commission + c.commission,
      washouts: acc.washouts + c.washouts,
    }),
    {
      fullDeals: 0,
      splitDeals: 0,
      weightedFrontGross: 0,
      totalBackGross: 0,
      totalGross: 0,
      commission: 0,
      washouts: 0,
    },
  );

  const dateRange =
    meta.dateFrom || meta.dateTo
      ? `${meta.dateFrom ?? "Start"} — ${meta.dateTo ?? "Present"}`
      : "All dates";

  const colStyles = [
    pdfStyles.colName,
    pdfStyles.colRate,
    pdfStyles.colFull,
    pdfStyles.colSplit,
    pdfStyles.colFront,
    pdfStyles.colBack,
    pdfStyles.colTotal,
    pdfStyles.colPVR,
    pdfStyles.colComm,
    pdfStyles.colWash,
  ];

  const headerLabels = [
    "Salesperson",
    "Rate",
    "Full",
    "Splits",
    "Wtd Front",
    "Back Gross",
    "Total Gross",
    "Avg PVR",
    "Commission",
    "Wash",
  ];

  return createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "LETTER", orientation: "landscape", style: pdfStyles.page },
      // Header
      createElement(
        View,
        { style: pdfStyles.header },
        createElement(Text, { style: pdfStyles.title }, "Commission Payout Report"),
        createElement(
          Text,
          { style: pdfStyles.subtitle },
          `${meta.eventName} | ${dateRange} | Default rate: ${fmtPct(meta.defaultRate)} | Generated ${new Date().toLocaleDateString("en-US")}`,
        ),
      ),
      // Summary boxes
      createElement(
        View,
        { style: pdfStyles.summaryRow },
        createElement(
          View,
          { style: pdfStyles.summaryBox },
          createElement(Text, { style: pdfStyles.summaryLabel }, "Total Commission Owed"),
          createElement(
            Text,
            { style: { ...pdfStyles.summaryValue, color: "#16a34a" } },
            fmtCurrency(totals.commission),
          ),
        ),
        createElement(
          View,
          { style: pdfStyles.summaryBox },
          createElement(Text, { style: pdfStyles.summaryLabel }, "Salespeople"),
          createElement(Text, { style: pdfStyles.summaryValue }, String(data.length)),
        ),
        createElement(
          View,
          { style: pdfStyles.summaryBox },
          createElement(Text, { style: pdfStyles.summaryLabel }, "Avg Commission"),
          createElement(
            Text,
            { style: pdfStyles.summaryValue },
            data.length > 0
              ? fmtCurrency(totals.commission / data.length)
              : "$0.00",
          ),
        ),
        createElement(
          View,
          { style: pdfStyles.summaryBox },
          createElement(Text, { style: pdfStyles.summaryLabel }, "Total Washouts"),
          createElement(
            Text,
            { style: { ...pdfStyles.summaryValue, color: totals.washouts > 0 ? "#dc2626" : "#0f172a" } },
            String(totals.washouts),
          ),
        ),
      ),
      // Table
      createElement(
        View,
        { style: pdfStyles.table },
        // Header row
        createElement(
          View,
          { style: pdfStyles.tableHeaderRow },
          ...headerLabels.map((label, i) =>
            createElement(
              Text,
              { key: String(i), style: { ...pdfStyles.tableHeaderCell, ...colStyles[i] } },
              label,
            ),
          ),
        ),
        // Data rows
        ...data.map((c, rowIdx) => {
          const cells = [
            c.name,
            fmtPct(c.commissionRate),
            String(c.fullDeals),
            String(c.splitDeals),
            fmtCurrency(c.weightedFrontGross),
            fmtCurrency(c.totalBackGross),
            fmtCurrency(c.totalGross),
            fmtCurrency(c.avgPVR),
            fmtCurrency(c.commission),
            String(c.washouts),
          ];
          return createElement(
            View,
            {
              key: c.name,
              style: {
                ...pdfStyles.tableRow,
                ...(rowIdx % 2 === 1 ? pdfStyles.tableRowAlt : {}),
              },
            },
            ...cells.map((val, i) =>
              createElement(
                Text,
                {
                  key: String(i),
                  style: {
                    ...(i === 0 || i === 8
                      ? pdfStyles.tableCellBold
                      : pdfStyles.tableCell),
                    ...colStyles[i],
                  },
                },
                val,
              ),
            ),
          );
        }),
        // Totals row
        createElement(
          View,
          { style: pdfStyles.totalRow },
          ...[
            "TOTALS",
            "—",
            String(totals.fullDeals),
            String(totals.splitDeals),
            fmtCurrency(totals.weightedFrontGross),
            fmtCurrency(totals.totalBackGross),
            fmtCurrency(totals.totalGross),
            "—",
            fmtCurrency(totals.commission),
            String(totals.washouts),
          ].map((val, i) =>
            createElement(
              Text,
              { key: String(i), style: { ...pdfStyles.tableCellBold, ...colStyles[i] } },
              val,
            ),
          ),
        ),
      ),
      // Footer
      createElement(
        View,
        { style: pdfStyles.footer },
        createElement(Text, null, "Generated by JDE Mission Control"),
        createElement(
          Text,
          null,
          `Page 1 | ${new Date().toLocaleString("en-US")}`,
        ),
      ),
    ),
  );
}

export async function generateCommissionPDF(
  data: CommissionEntry[],
  meta: ExportMeta,
) {
  const doc = createElement(CommissionPDFDocument, { data, meta });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(doc as any).toBlob();
  const safeName = meta.eventName.replace(/[^a-zA-Z0-9]/g, "_");
  triggerDownload(blob, `commissions_${safeName}.pdf`);
}
