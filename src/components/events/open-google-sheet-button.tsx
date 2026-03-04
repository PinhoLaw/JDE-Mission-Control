// Google Sheets auto-creation — replaces Excel upload flow (March 2026)
"use client";

import { Button } from "@/components/ui/button";
import { ExternalLink, FileSpreadsheet } from "lucide-react";

interface OpenGoogleSheetButtonProps {
  sheetUrl: string | null;
  sheetId: string | null;
  /** Button size — matches shadcn Button sizes */
  size?: "default" | "sm" | "lg" | "icon";
  /** Button variant */
  variant?: "default" | "outline" | "secondary" | "ghost";
  /** Custom label text */
  label?: string;
}

export function OpenGoogleSheetButton({
  sheetUrl,
  sheetId,
  size = "sm",
  variant = "outline",
  label = "Open Google Sheet",
}: OpenGoogleSheetButtonProps) {
  // Derive URL from sheetId if sheetUrl is not set
  const url =
    sheetUrl || (sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null);

  if (!url) {
    return (
      <Button size={size} variant={variant} disabled>
        <FileSpreadsheet className="h-4 w-4" />
        No Sheet Linked
      </Button>
    );
  }

  return (
    <Button size={size} variant={variant} asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <FileSpreadsheet className="h-4 w-4" />
        {label}
        <ExternalLink className="h-3 w-3 ml-1" />
      </a>
    </Button>
  );
}
