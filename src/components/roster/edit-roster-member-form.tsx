"use client";

import { useState, useCallback } from "react";
import type { RosterMember } from "@/types/database";
import { updateRosterMember } from "@/lib/actions/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSheetPush } from "@/hooks/useSheetPush";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RosterRole = RosterMember["role"];

const ROLE_LABELS: Record<RosterRole, string> = {
  sales: "Sales",
  team_leader: "Team Leader",
  fi_manager: "F&I Manager",
  closer: "Closer",
  manager: "Manager",
};

// ---------------------------------------------------------------------------
// Sheet push helper (same column mapping as roster page)
// A=ID, B=NAME, C=PHONE, D=EMAIL, E=ROLE, F=TEAM, G=COMM %, H=CONFIRMED,
// I=ACTIVE, J=NOTES
// ---------------------------------------------------------------------------

function rosterMemberToRow(member: {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  role: string;
  team?: string | null;
  commission_pct?: number | null;
  confirmed: boolean;
  active: boolean;
  notes?: string | null;
}): unknown[] {
  return [
    member.id,
    member.name,
    member.phone ?? "",
    member.email ?? "",
    ROLE_LABELS[member.role as RosterRole] ?? member.role,
    member.team ?? "",
    member.commission_pct != null
      ? (member.commission_pct * 100).toFixed(0)
      : "",
    member.confirmed ? "YES" : "NO",
    member.active ? "YES" : "NO",
    member.notes ?? "",
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EditRosterMemberFormProps {
  member: RosterMember;
  eventId: string;
  sheetId?: string | null;
  onSuccess?: () => void;
}

export function EditRosterMemberForm({
  member,
  eventId,
  // sheetId no longer needed — useSheetPush injects it from EventProvider
  onSuccess,
}: EditRosterMemberFormProps) {
  const { push: sheetPush } = useSheetPush();

  const [form, setForm] = useState({
    name: member.name,
    phone: member.phone ?? "",
    email: member.email ?? "",
    role: member.role as RosterRole,
    team: member.team ?? "",
    commission_pct:
      member.commission_pct != null
        ? (member.commission_pct * 100).toFixed(0)
        : "",
    notes: member.notes ?? "",
    confirmed: member.confirmed,
    active: member.active,
  });

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSubmitting(true);
    try {
      const updates: Record<string, unknown> = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        role: form.role,
        team: form.team.trim() || null,
        commission_pct: form.commission_pct
          ? parseFloat(form.commission_pct) / 100
          : null,
        notes: form.notes.trim() || null,
        confirmed: form.confirmed,
        active: form.active,
      };

      await updateRosterMember(member.id, eventId, updates);
      toast.success(`${form.name.trim()} updated`);

      // Fire-and-forget: push updated member to Google Sheet
      sheetPush(
        {
          action: "update_raw",
          sheetTitle: "Roster Push",
          matchColumnIndex: 0,
          matchValue: member.id,
          values: rosterMemberToRow({
            id: member.id,
            name: form.name.trim(),
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            role: form.role,
            team: form.team.trim() || null,
            commission_pct: form.commission_pct
              ? parseFloat(form.commission_pct) / 100
              : null,
            confirmed: form.confirmed,
            active: form.active,
            notes: form.notes.trim() || null,
          }),
        },
        { successMessage: "Sheet updated" },
      );

      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update member",
      );
    } finally {
      setSubmitting(false);
    }
  }, [form, member.id, eventId, onSuccess, sheetPush]);

  return (
    <div className="grid gap-4 py-4">
      {/* Name */}
      <div className="grid gap-2">
        <Label htmlFor="edit-roster-name">Name *</Label>
        <Input
          id="edit-roster-name"
          placeholder="John Smith"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>

      {/* Phone / Email */}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="edit-roster-phone">Phone</Label>
          <Input
            id="edit-roster-phone"
            placeholder="(555) 123-4567"
            value={form.phone}
            onChange={(e) =>
              setForm((f) => ({ ...f, phone: e.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-roster-email">Email</Label>
          <Input
            id="edit-roster-email"
            type="email"
            placeholder="john@example.com"
            value={form.email}
            onChange={(e) =>
              setForm((f) => ({ ...f, email: e.target.value }))
            }
          />
        </div>
      </div>

      {/* Role / Team */}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="edit-roster-role">Role</Label>
          <Select
            value={form.role}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, role: v as RosterRole }))
            }
          >
            <SelectTrigger id="edit-roster-role">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="team_leader">Team Leader</SelectItem>
              <SelectItem value="fi_manager">F&I Manager</SelectItem>
              <SelectItem value="closer">Closer</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edit-roster-team">Team</Label>
          <Input
            id="edit-roster-team"
            placeholder="Team A"
            value={form.team}
            onChange={(e) =>
              setForm((f) => ({ ...f, team: e.target.value }))
            }
          />
        </div>
      </div>

      {/* Commission % */}
      <div className="grid gap-2">
        <Label htmlFor="edit-roster-commission">Commission %</Label>
        <Input
          id="edit-roster-commission"
          type="number"
          step="0.5"
          min="0"
          max="100"
          placeholder="25"
          value={form.commission_pct}
          onChange={(e) =>
            setForm((f) => ({ ...f, commission_pct: e.target.value }))
          }
        />
      </div>

      {/* Notes */}
      <div className="grid gap-2">
        <Label htmlFor="edit-roster-notes">Notes</Label>
        <Textarea
          id="edit-roster-notes"
          placeholder="Optional notes about this team member..."
          rows={3}
          value={form.notes}
          onChange={(e) =>
            setForm((f) => ({ ...f, notes: e.target.value }))
          }
        />
      </div>

      {/* Confirmed / Active toggles */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Checkbox
            id="edit-roster-confirmed"
            checked={form.confirmed}
            onCheckedChange={(checked) =>
              setForm((f) => ({ ...f, confirmed: !!checked }))
            }
          />
          <Label htmlFor="edit-roster-confirmed" className="text-sm">
            Confirmed
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="edit-roster-active"
            checked={form.active}
            onCheckedChange={(checked) =>
              setForm((f) => ({ ...f, active: !!checked }))
            }
          />
          <Label htmlFor="edit-roster-active" className="text-sm">
            Active
          </Label>
        </div>
      </div>

      {/* Submit */}
      <Button onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Update Member
      </Button>
    </div>
  );
}
