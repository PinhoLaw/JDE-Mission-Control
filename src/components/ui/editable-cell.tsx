"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditableCellBaseProps {
  vehicleId: string;
  eventId: string;
  field: string;
  onSave: (
    vehicleId: string,
    eventId: string,
    field: string,
    value: unknown,
  ) => Promise<void>;
  className?: string;
}

interface EditableTextCellProps extends EditableCellBaseProps {
  type: "text" | "number";
  value: string | number | null;
  /** Format the display value (e.g. formatCurrency) */
  formatDisplay?: (v: string | number | null) => string;
  placeholder?: string;
}

interface EditableSelectCellProps extends EditableCellBaseProps {
  type: "select";
  value: string | null;
  options: { value: string; label: string; className?: string }[];
}

export type EditableCellProps = EditableTextCellProps | EditableSelectCellProps;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditableCell(props: EditableCellProps) {
  const { type, vehicleId, eventId, field, onSave, className } = props;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localValue, setLocalValue] = useState("");
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get the current display value
  const currentValue = props.value;

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Clear "saved" indicator after 1.5s
  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 1500);
      return () => clearTimeout(t);
    }
  }, [saved]);

  const startEditing = useCallback(() => {
    if (saving) return;
    setLocalValue(currentValue != null ? String(currentValue) : "");
    setEditing(true);
  }, [currentValue, saving]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setLocalValue("");
  }, []);

  const commitValue = useCallback(async () => {
    const trimmed = localValue.trim();
    // Parse value based on type
    let parsedValue: unknown;
    if (type === "number") {
      // Strip currency chars / commas
      const cleaned = trimmed.replace(/[$,]/g, "");
      parsedValue = cleaned === "" ? null : Number(cleaned);
      if (parsedValue !== null && isNaN(parsedValue as number)) {
        cancelEditing();
        return;
      }
    } else {
      parsedValue = trimmed === "" ? null : trimmed;
    }

    // Don't save if value hasn't changed
    const prevStr = currentValue != null ? String(currentValue) : "";
    const newStr = parsedValue != null ? String(parsedValue) : "";
    if (prevStr === newStr) {
      cancelEditing();
      return;
    }

    setSaving(true);
    setEditing(false);
    try {
      await onSave(vehicleId, eventId, field, parsedValue);
      setSaved(true);
    } catch {
      // Error handled by parent (toast)
    } finally {
      setSaving(false);
    }
  }, [localValue, type, currentValue, cancelEditing, onSave, vehicleId, eventId, field]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitValue();
      } else if (e.key === "Escape") {
        cancelEditing();
      }
    },
    [commitValue, cancelEditing],
  );

  // ── Select type ──
  if (type === "select") {
    const selectProps = props as EditableSelectCellProps;
    const selectValue = String(currentValue ?? "");
    return (
      <div className={cn("relative", className)}>
        {saving && (
          <Loader2 className="absolute -left-4 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
        )}
        <Select
          value={selectValue}
          onValueChange={async (newVal) => {
            if (newVal === selectValue) return;
            setSaving(true);
            try {
              await onSave(vehicleId, eventId, field, newVal);
              setSaved(true);
            } catch {
              // handled by parent
            } finally {
              setSaving(false);
            }
          }}
        >
          <SelectTrigger
            className={cn(
              "h-7 w-full border-transparent bg-transparent px-1.5 text-xs hover:border-border focus:border-border shadow-none",
              saving && "opacity-50",
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectProps.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className={opt.className}>{opt.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // ── Text / Number type ──
  const textProps = props as EditableTextCellProps;
  const displayFormatted =
    textProps.formatDisplay
      ? textProps.formatDisplay(currentValue as string | number | null)
      : currentValue != null
        ? String(currentValue)
        : "—";

  if (editing) {
    return (
      <div className={cn("flex items-center gap-0.5", className)}>
        <Input
          ref={inputRef}
          type={type === "number" ? "text" : "text"}
          inputMode={type === "number" ? "decimal" : "text"}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitValue}
          className="h-7 px-1.5 text-xs min-w-[60px] w-full"
          placeholder={textProps.placeholder}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center min-h-[28px] px-1.5 rounded cursor-pointer hover:bg-muted/60 transition-colors",
        saving && "opacity-50",
        className,
      )}
      onClick={startEditing}
      title="Click to edit"
    >
      {saving ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : saved ? (
        <Check className="absolute -left-3.5 h-3 w-3 text-green-500" />
      ) : null}
      <span className={cn("text-xs truncate", currentValue == null && "text-muted-foreground")}>
        {displayFormatted}
      </span>
    </div>
  );
}
