"use client";

import { useState, useCallback } from "react";
import type { Lender } from "@/types/database";
import { updateLender } from "@/lib/actions/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EditLenderFormProps {
  lender: Lender;
  eventId: string;
  onSuccess?: () => void;
}

export function EditLenderForm({
  lender,
  eventId,
  onSuccess,
}: EditLenderFormProps) {
  const [form, setForm] = useState({
    name: lender.name,
    buy_rate_pct: lender.buy_rate_pct != null ? String(lender.buy_rate_pct) : "",
    max_advance: lender.max_advance != null ? String(lender.max_advance) : "",
    notes: lender.notes ?? "",
    active: lender.active,
  });

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error("Lender name is required");
      return;
    }

    setSubmitting(true);
    try {
      const updates: {
        name?: string;
        buy_rate_pct?: number | null;
        max_advance?: number | null;
        notes?: string | null;
        active?: boolean;
      } = {
        name: form.name.trim(),
        buy_rate_pct: form.buy_rate_pct
          ? parseFloat(form.buy_rate_pct)
          : null,
        max_advance: form.max_advance
          ? parseFloat(form.max_advance)
          : null,
        notes: form.notes.trim() || null,
        active: form.active,
      };

      await updateLender(lender.id, eventId, updates);
      toast.success(`${form.name.trim()} updated`);
      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update lender",
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, lender.id, eventId, onSuccess]);

  return (
    <div className="grid gap-4 py-4">
      {/* Name */}
      <div className="grid gap-2">
        <Label htmlFor="edit-lender-name">Lender Name *</Label>
        <Input
          id="edit-lender-name"
          placeholder="Capital One"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>

      {/* Buy Rate / Max Advance */}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="edit-lender-buy-rate">Buy Rate %</Label>
          <Input
            id="edit-lender-buy-rate"
            type="number"
            step="0.25"
            min="0"
            max="100"
            placeholder="2.5"
            value={form.buy_rate_pct}
            onChange={(e) =>
              setForm((f) => ({ ...f, buy_rate_pct: e.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-lender-max-advance">Max Advance</Label>
          <Input
            id="edit-lender-max-advance"
            type="number"
            step="500"
            min="0"
            placeholder="50000"
            value={form.max_advance}
            onChange={(e) =>
              setForm((f) => ({ ...f, max_advance: e.target.value }))
            }
          />
        </div>
      </div>

      {/* Notes */}
      <div className="grid gap-2">
        <Label htmlFor="edit-lender-notes">Notes</Label>
        <Textarea
          id="edit-lender-notes"
          placeholder="Optional notes about this lender..."
          rows={3}
          value={form.notes}
          onChange={(e) =>
            setForm((f) => ({ ...f, notes: e.target.value }))
          }
        />
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="edit-lender-active"
          checked={form.active}
          onCheckedChange={(checked) =>
            setForm((f) => ({ ...f, active: !!checked }))
          }
        />
        <Label htmlFor="edit-lender-active" className="text-sm">
          Active
        </Label>
      </div>

      {/* Submit */}
      <Button onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Update Lender
      </Button>
    </div>
  );
}
