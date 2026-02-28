"use client";

import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BulkActionsToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  isLoading?: boolean;
  children: React.ReactNode;
}

export function BulkActionsToolbar({
  selectedCount,
  onClearSelection,
  isLoading,
  children,
}: BulkActionsToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-4 py-2 mb-3 animate-in slide-in-from-top-2 duration-200">
      <Badge variant="secondary" className="mr-1">
        {isLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {selectedCount} selected
      </Badge>

      <div className="flex items-center gap-2">{children}</div>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2 text-muted-foreground"
        onClick={onClearSelection}
        disabled={isLoading}
      >
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">Clear selection</span>
      </Button>
    </div>
  );
}
