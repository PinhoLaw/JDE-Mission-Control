"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportInventoryCSV, exportDealsCSV } from "@/lib/actions/export";
import { toast } from "sonner";

interface CsvExportButtonsProps {
  eventId: string;
}

export function CsvExportButtons({ eventId }: CsvExportButtonsProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExport(type: string) {
    setExporting(true);
    try {
      let csv: string;
      let filename: string;

      if (type === "inventory") {
        csv = await exportInventoryCSV(eventId);
        filename = "inventory_export.csv";
      } else {
        csv = await exportDealsCSV(eventId);
        filename = "deals_export.csv";
      }

      if (!csv) {
        toast.info("No data to export");
        return;
      }

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${type === "inventory" ? "Inventory" : "Deals"} exported`);
    } catch (err) {
      toast.error("Export failed");
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Select onValueChange={handleExport} disabled={exporting}>
      <SelectTrigger className="w-[130px] h-8 text-xs">
        <div className="flex items-center gap-1.5">
          <Download className="h-3 w-3" />
          <SelectValue placeholder="Export CSV" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inventory">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Inventory
          </div>
        </SelectItem>
        <SelectItem value="deals">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Deals
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
