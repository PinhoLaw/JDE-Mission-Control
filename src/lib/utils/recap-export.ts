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
import { formatCurrency, formatPercent } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────

interface SpSummary {
  name: string;
  units: number;
  gross: number;
  commission: number;
}

interface PnlData {
  totalUnits: number;
  newUnits: number;
  usedUnits: number;
  totalCommissionableGross: number;
  jdePct: number;
  jdeCommission: number;
  nonCommGross: number;
  totalSaleGross: number;
  repsCommissions: number;
  variableNet: number;
  totalNet: number;
}

export interface RecapExportData {
  eventName: string;
  month: string;
  year: string;
  pnl: PnlData;
  marketingCost: number;
  miscExpenses: number;
  prizeGiveaways: number;
  spSummary: SpSummary[];
  spTotals: { units: number; gross: number; commission: number };
}

// ─── Helpers ─────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ═════════════════════════════════════════════════════════
// Excel Export
// ═════════════════════════════════════════════════════════

export async function generateRecapExcel(data: RecapExportData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JDE Mission Control";
  wb.created = new Date();

  const ws = wb.addWorksheet("Event Recap");

  // Title
  const titleRow = ws.addRow([
    `${data.eventName} ${data.month} ${data.year} — Event Recap`,
  ]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells("A1:D1");

  const dateRow = ws.addRow([
    `Generated ${new Date().toLocaleDateString("en-US")}`,
  ]);
  dateRow.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  ws.mergeCells("A2:D2");
  ws.addRow([]);

  // P&L Section
  const pnlHeader = ws.addRow(["P&L SUMMARY", "", "Amount"]);
  pnlHeader.font = { bold: true };
  pnlHeader.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };
  pnlHeader.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  pnlHeader.getCell(3).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };
  pnlHeader.getCell(3).font = { bold: true, color: { argb: "FFFFFFFF" } };

  const pnlRows: [string, number, boolean?][] = [
    ["TOTAL COMMISSIONABLE GROSS", data.pnl.totalCommissionableGross],
    [`JDE COMMISSION [${formatPercent(data.pnl.jdePct)}]`, -data.pnl.jdeCommission],
    ["MARKETING COST", -data.marketingCost],
    ["NON COMM GROSS", data.pnl.nonCommGross],
    ["TOTAL SALE GROSS", data.pnl.totalSaleGross, true],
    ["REPS COMMISSIONS", -data.pnl.repsCommissions],
    ["VARIABLE NET", data.pnl.variableNet, true],
    ["TOTAL NET", data.pnl.totalNet, true],
    ["", 0],
    ["MIS EXPENSES", data.miscExpenses],
    ["HELIUM / PRIZE GIVEAWAYS", data.prizeGiveaways],
    ["JDE COMMISSION", data.pnl.jdeCommission],
  ];

  for (const [label, amount, isGreen] of pnlRows) {
    const row = ws.addRow([label, "", amount]);
    row.getCell(3).numFmt = '"$"#,##0.00';
    if (isGreen) {
      row.font = { bold: true };
      row.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDCFCE7" },
      };
      row.getCell(3).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDCFCE7" },
      };
    }
  }

  ws.addRow([]);
  ws.addRow([`${data.pnl.newUnits} NEW`, "", `${data.pnl.usedUnits} USED`]);

  ws.addRow([]);
  ws.addRow([]);

  // Salespeople Summary
  const spHeader = ws.addRow(["Salesperson", "Units", "Gross", "Commission"]);
  spHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  spHeader.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
  });

  for (const sp of data.spSummary) {
    const row = ws.addRow([
      sp.name,
      sp.units % 1 === 0 ? sp.units : sp.units.toFixed(1),
      sp.gross,
      sp.commission,
    ]);
    row.getCell(3).numFmt = '"$"#,##0.00';
    row.getCell(4).numFmt = '"$"#,##0.00';
  }

  const totRow = ws.addRow([
    "TOTAL REPS",
    data.spTotals.units % 1 === 0
      ? data.spTotals.units
      : data.spTotals.units.toFixed(1),
    data.spTotals.gross,
    data.spTotals.commission,
  ]);
  totRow.font = { bold: true };
  totRow.eachCell((cell) => {
    cell.border = {
      top: { style: "double", color: { argb: "FF000000" } },
    };
  });
  totRow.getCell(3).numFmt = '"$"#,##0.00';
  totRow.getCell(4).numFmt = '"$"#,##0.00';

  // Column widths
  ws.columns = [
    { width: 32 },
    { width: 10 },
    { width: 18 },
    { width: 16 },
  ];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safeName = data.eventName.replace(/[^a-zA-Z0-9]/g, "_");
  triggerDownload(blob, `recap_${safeName}.xlsx`);
}

// ═════════════════════════════════════════════════════════
// PDF Export
// ═════════════════════════════════════════════════════════

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: "Helvetica" },
  header: { marginBottom: 12, borderBottomWidth: 2, borderBottomColor: "#16a34a", paddingBottom: 8 },
  title: { fontSize: 16, fontWeight: "bold", fontFamily: "Helvetica-Bold", color: "#1e293b" },
  subtitle: { fontSize: 9, color: "#64748b", marginTop: 3 },
  columns: { flexDirection: "row", gap: 12 },
  leftCol: { flex: 3 },
  rightCol: { flex: 2 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  greenRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 4, backgroundColor: "#dcfce7" },
  sepRow: { height: 6, backgroundColor: "#f1f5f9", marginVertical: 2 },
  label: { flex: 1, fontSize: 8, color: "#334155" },
  labelBold: { flex: 1, fontSize: 9, fontWeight: "bold", fontFamily: "Helvetica-Bold", color: "#166534" },
  value: { width: 90, fontSize: 8, textAlign: "right", color: "#334155", fontFamily: "Helvetica" },
  valueBold: { width: 90, fontSize: 9, textAlign: "right", fontWeight: "bold", fontFamily: "Helvetica-Bold", color: "#166534" },
  valueRed: { width: 90, fontSize: 8, textAlign: "right", color: "#dc2626", fontFamily: "Helvetica" },
  valueGreen: { width: 90, fontSize: 8, textAlign: "right", color: "#16a34a", fontFamily: "Helvetica" },
  // SP table
  spHeaderRow: { flexDirection: "row", backgroundColor: "#2563eb", paddingVertical: 3, paddingHorizontal: 4 },
  spHeaderCell: { fontSize: 7, color: "#ffffff", fontWeight: "bold", fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  spRow: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  spTotalRow: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 4, borderTopWidth: 2, borderTopColor: "#1e293b" },
  spName: { width: "40%" },
  spUnits: { width: "12%", textAlign: "center" },
  spGross: { width: "24%", textAlign: "right" },
  spComm: { width: "24%", textAlign: "right" },
  cell: { fontSize: 8, color: "#334155" },
  cellBold: { fontSize: 8, fontWeight: "bold", fontFamily: "Helvetica-Bold", color: "#0f172a" },
  // Units boxes
  unitsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  unitBox: { flex: 1, borderWidth: 1, borderRadius: 4, padding: 6, alignItems: "center" },
  unitNum: { fontSize: 18, fontWeight: "bold", fontFamily: "Helvetica-Bold" },
  unitLabel: { fontSize: 7, fontWeight: "bold", fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  footer: { position: "absolute", bottom: 20, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: "#94a3b8", borderTopWidth: 0.5, borderTopColor: "#e2e8f0", paddingTop: 5 },
});

function RecapPDFDocument({ data }: { data: RecapExportData }) {
  const pnlLines: { label: string; value: string; type: "normal" | "red" | "green" | "greenRow" | "sep" }[] = [
    { label: "TOTAL COMMISSIONABLE GROSS", value: formatCurrency(data.pnl.totalCommissionableGross), type: "normal" },
    { label: `JDE COMMISSION [${formatPercent(data.pnl.jdePct)}]`, value: `- ${formatCurrency(data.pnl.jdeCommission)}`, type: "red" },
    { label: "MARKETING COST", value: `- ${formatCurrency(data.marketingCost)}`, type: "red" },
    { label: "NON COMM GROSS", value: `+ ${formatCurrency(data.pnl.nonCommGross)}`, type: "green" },
    { label: "TOTAL SALE GROSS", value: formatCurrency(data.pnl.totalSaleGross), type: "greenRow" },
    { label: "REPS COMMISSIONS", value: `- ${formatCurrency(data.pnl.repsCommissions)}`, type: "red" },
    { label: "VARIABLE NET", value: formatCurrency(data.pnl.variableNet), type: "greenRow" },
    { label: "TOTAL NET", value: formatCurrency(data.pnl.totalNet), type: "greenRow" },
    { label: "", value: "", type: "sep" },
    { label: "MIS EXPENSES", value: formatCurrency(data.miscExpenses), type: "normal" },
    { label: "HELIUM / PRIZE GIVEAWAYS ETC", value: formatCurrency(data.prizeGiveaways), type: "normal" },
    { label: "JDE COMMISSION", value: formatCurrency(data.pnl.jdeCommission), type: "normal" },
  ];

  return createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "LETTER", style: s.page },
      // Header
      createElement(
        View,
        { style: s.header },
        createElement(Text, { style: s.title }, `${data.eventName} ${data.month} ${data.year}`),
        createElement(Text, { style: s.subtitle }, `Event Recap | Generated ${new Date().toLocaleDateString("en-US")}`),
      ),
      // Two columns
      createElement(
        View,
        { style: s.columns },
        // Left — P&L
        createElement(
          View,
          { style: s.leftCol },
          createElement(Text, { style: s.sectionTitle }, "Financial Summary"),
          ...pnlLines.map((line, i) => {
            if (line.type === "sep") {
              return createElement(View, { key: String(i), style: s.sepRow });
            }
            const isGreen = line.type === "greenRow";
            const rowStyle = isGreen ? s.greenRow : s.row;
            const labelStyle = isGreen ? s.labelBold : s.label;
            let valueStyle = s.value;
            if (isGreen) valueStyle = s.valueBold;
            else if (line.type === "red") valueStyle = s.valueRed;
            else if (line.type === "green") valueStyle = s.valueGreen;
            return createElement(
              View,
              { key: String(i), style: rowStyle },
              createElement(Text, { style: labelStyle }, line.label),
              createElement(Text, { style: valueStyle }, line.value),
            );
          }),
          // Units boxes
          createElement(
            View,
            { style: s.unitsRow },
            createElement(
              View,
              { style: { ...s.unitBox, borderColor: "#93c5fd", backgroundColor: "#eff6ff" } },
              createElement(Text, { style: { ...s.unitNum, color: "#1d4ed8" } }, String(data.pnl.newUnits)),
              createElement(Text, { style: { ...s.unitLabel, color: "#2563eb" } }, "NEW"),
            ),
            createElement(
              View,
              { style: { ...s.unitBox, borderColor: "#fdba74", backgroundColor: "#fff7ed" } },
              createElement(Text, { style: { ...s.unitNum, color: "#c2410c" } }, String(data.pnl.usedUnits)),
              createElement(Text, { style: { ...s.unitLabel, color: "#ea580c" } }, "USED"),
            ),
          ),
        ),
        // Right — SP Summary
        createElement(
          View,
          { style: s.rightCol },
          createElement(Text, { style: s.sectionTitle }, "Sales People Summary"),
          // Header
          createElement(
            View,
            { style: s.spHeaderRow },
            createElement(Text, { style: { ...s.spHeaderCell, ...s.spName } }, "Salesperson"),
            createElement(Text, { style: { ...s.spHeaderCell, ...s.spUnits } }, "Units"),
            createElement(Text, { style: { ...s.spHeaderCell, ...s.spGross } }, "Gross"),
            createElement(Text, { style: { ...s.spHeaderCell, ...s.spComm } }, "Comm"),
          ),
          // Rows
          ...data.spSummary.map((sp) =>
            createElement(
              View,
              { key: sp.name, style: s.spRow },
              createElement(Text, { style: { ...s.cell, ...s.spName } }, sp.name),
              createElement(Text, { style: { ...s.cell, ...s.spUnits } }, sp.units % 1 === 0 ? String(sp.units) : sp.units.toFixed(1)),
              createElement(Text, { style: { ...s.cell, ...s.spGross } }, formatCurrency(sp.gross)),
              createElement(Text, { style: { ...s.cell, ...s.spComm, color: "#16a34a" } }, formatCurrency(sp.commission)),
            ),
          ),
          // Total
          createElement(
            View,
            { style: s.spTotalRow },
            createElement(Text, { style: { ...s.cellBold, ...s.spName } }, "TOTAL REPS"),
            createElement(Text, { style: { ...s.cellBold, ...s.spUnits } }, data.spTotals.units % 1 === 0 ? String(data.spTotals.units) : data.spTotals.units.toFixed(1)),
            createElement(Text, { style: { ...s.cellBold, ...s.spGross } }, formatCurrency(data.spTotals.gross)),
            createElement(Text, { style: { ...s.cellBold, ...s.spComm, color: "#16a34a" } }, formatCurrency(data.spTotals.commission)),
          ),
        ),
      ),
      // Footer
      createElement(
        View,
        { style: s.footer },
        createElement(Text, null, "Generated by JDE Mission Control"),
        createElement(Text, null, `${new Date().toLocaleString("en-US")}`),
      ),
    ),
  );
}

export async function generateRecapPDF(data: RecapExportData) {
  const doc = createElement(RecapPDFDocument, { data });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await pdf(doc as any).toBlob();
  const safeName = data.eventName.replace(/[^a-zA-Z0-9]/g, "_");
  triggerDownload(blob, `recap_${safeName}.pdf`);
}
