"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { RosterMember } from "@/hooks/useRosterMembers";

const ROLE_LABELS: Record<string, string> = {
  sales: "Sales",
  team_leader: "TL",
  fi_manager: "F&I",
  closer: "Closer",
  manager: "Mgr",
};

interface SalespersonSelectProps {
  /** Currently selected roster member ID (UUID) */
  value: string | null | undefined;
  /** Called with (id, name) when selection changes; id is null when cleared */
  onChange: (id: string | null, name: string | null) => void;
  /** Roster members to show as options */
  roster: RosterMember[];
  /** Placeholder text */
  placeholder?: string;
  /** Allow clearing the selection */
  clearable?: boolean;
  /** HTML id for label association */
  id?: string;
}

export function SalespersonSelect({
  value,
  onChange,
  roster,
  placeholder = "Select salesperson",
  clearable = false,
  id,
}: SalespersonSelectProps) {
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(val) => {
        if (val === "__none__") {
          onChange(null, null);
        } else {
          const member = roster.find((r) => r.id === val);
          onChange(val, member?.name ?? null);
        }
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {clearable && (
          <SelectItem value="__none__">
            <span className="text-muted-foreground">None</span>
          </SelectItem>
        )}
        {roster.map((member) => (
          <SelectItem key={member.id} value={member.id}>
            <span className="flex items-center gap-2">
              {member.name}
              <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">
                {ROLE_LABELS[member.role] ?? member.role}
              </Badge>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
