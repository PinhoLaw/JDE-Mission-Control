"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { RosterMember, Lender } from "@/types/database";
import {
  addRosterMember,
  updateRosterMember,
  deleteRosterMember,
  addLender,
  updateLender,
  deleteLender,
  fetchRosterForEvent,
  copyRosterFromEvent,
  importRosterMembers,
  bulkUpdateRosterStatus,
  bulkAssignTeam,
  bulkDeleteRosterMembers,
} from "@/lib/actions/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EditRosterMemberForm } from "@/components/roster/edit-roster-member-form";
import { EditLenderForm } from "@/components/roster/edit-lender-form";
import { LastSyncedIndicator } from "@/components/ui/last-synced-indicator";
import { useSheetPush } from "@/hooks/useSheetPush";
import { CSVImportDialog } from "@/components/roster/csv-import-dialog";
import { BulkActionsToolbar } from "@/components/ui/data-table-bulk-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Users,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  UserPlus,
  Building2,
  Copy,
  Download,
  Upload,
  Pencil,
  FileSpreadsheet,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type RosterRole = RosterMember["role"];

const ROLE_LABELS: Record<RosterRole, string> = {
  sales: "Sales",
  team_leader: "Team Leader",
  fi_manager: "F&I Manager",
  closer: "Closer",
  manager: "Manager",
};

// Reverse mapping: display label → DB key (for sheet import)
const ROLE_FROM_LABEL: Record<string, RosterRole> = Object.fromEntries(
  Object.entries(ROLE_LABELS).map(([key, label]) => [label.toLowerCase(), key as RosterRole]),
) as Record<string, RosterRole>;

const ROLE_COLORS: Record<RosterRole, string> = {
  sales: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  team_leader:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  fi_manager:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  closer:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  manager: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const EMPTY_ROSTER_FORM = {
  name: "",
  phone: "",
  email: "",
  role: "sales" as RosterRole,
  team: "",
  commission_pct: "",
};

const EMPTY_LENDER_FORM = {
  name: "",
  buy_rate_pct: "",
  max_advance: "",
};

// ---------------------------------------------------------------------------
// Sheet push helpers — "Roster Push" column mapping:
// A=ID, B=NAME, C=PHONE, D=EMAIL, E=ROLE, F=TEAM, G=COMM %, H=CONFIRMED, I=ACTIVE, J=NOTES
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
    member.commission_pct != null ? (member.commission_pct * 100).toFixed(0) : "",
    member.confirmed ? "YES" : "NO",
    member.active ? "YES" : "NO",
    member.notes ?? "",
  ];
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

type SourceRosterMember = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  team: string | null;
  commission_pct: number | null;
  notes: string | null;
};

export default function RosterPage() {
  const { currentEvent, availableEvents } = useEvent();

  // Centralized sheet push
  const { push: sheetPush } = useSheetPush();

  // Data
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [rosterDialogOpen, setRosterDialogOpen] = useState(false);
  const [lenderDialogOpen, setLenderDialogOpen] = useState(false);

  // Forms
  const [rosterForm, setRosterForm] = useState(EMPTY_ROSTER_FORM);
  const [lenderForm, setLenderForm] = useState(EMPTY_LENDER_FORM);

  // Pending actions (optimistic UI)
  const [submittingRoster, setSubmittingRoster] = useState(false);
  const [submittingLender, setSubmittingLender] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Copy from event dialog
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [selectedSourceEventId, setSelectedSourceEventId] = useState("");
  const [sourceRoster, setSourceRoster] = useState<SourceRosterMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingSource, setLoadingSource] = useState(false);
  const [copying, setCopying] = useState(false);

  // Import / Push sheet sync
  const [importingFromSheet, setImportingFromSheet] = useState(false);
  const [pushingToSheet, setPushingToSheet] = useState(false);

  // Edit member dialog
  const [editingMember, setEditingMember] = useState<RosterMember | null>(null);
  const [editingLender, setEditingLender] = useState<Lender | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [csvImportOpen, setCSVImportOpen] = useState(false);

  // Bulk selection
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // ---------- Data fetching + realtime ----------

  useEffect(() => {
    if (!currentEvent) return;

    setLoading(true);
    setSelectedRosterIds(new Set());
    const supabase = createClient();

    // Initial fetch
    Promise.all([
      supabase
        .from("roster")
        .select("*")
        .eq("event_id", currentEvent.id)
        .order("name"),
      supabase
        .from("lenders")
        .select("*")
        .eq("event_id", currentEvent.id)
        .order("name"),
    ]).then(([rosterRes, lendersRes]) => {
      setRoster(rosterRes.data ?? []);
      setLenders(lendersRes.data ?? []);
      setLoading(false);
    });

    // Realtime: roster
    const rosterChannel = supabase
      .channel(`roster-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "roster",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setRoster((prev) => {
              const exists = prev.some(
                (m) => m.id === (payload.new as RosterMember).id,
              );
              if (exists) return prev;
              return [...prev, payload.new as RosterMember].sort((a, b) =>
                a.name.localeCompare(b.name),
              );
            });
          } else if (payload.eventType === "UPDATE") {
            setRoster((prev) =>
              prev.map((m) =>
                m.id === (payload.new as RosterMember).id
                  ? (payload.new as RosterMember)
                  : m,
              ),
            );
          } else if (payload.eventType === "DELETE") {
            setRoster((prev) =>
              prev.filter(
                (m) => m.id !== (payload.old as { id: string }).id,
              ),
            );
          }
        },
      )
      .subscribe();

    // Realtime: lenders
    const lenderChannel = supabase
      .channel(`lenders-${currentEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lenders",
          filter: `event_id=eq.${currentEvent.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setLenders((prev) => {
              const exists = prev.some(
                (l) => l.id === (payload.new as Lender).id,
              );
              if (exists) return prev;
              return [...prev, payload.new as Lender].sort((a, b) =>
                a.name.localeCompare(b.name),
              );
            });
          } else if (payload.eventType === "UPDATE") {
            setLenders((prev) =>
              prev.map((l) =>
                l.id === (payload.new as Lender).id
                  ? (payload.new as Lender)
                  : l,
              ),
            );
          } else if (payload.eventType === "DELETE") {
            setLenders((prev) =>
              prev.filter(
                (l) => l.id !== (payload.old as { id: string }).id,
              ),
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(rosterChannel);
      supabase.removeChannel(lenderChannel);
    };
  }, [currentEvent]);

  // ---------- Derived: other events for copy ----------

  const otherEvents = useMemo(
    () => availableEvents.filter((e) => e.id !== currentEvent?.id),
    [availableEvents, currentEvent],
  );

  // ---------- Stats ----------

  const stats = useMemo(() => {
    const total = roster.length;
    const confirmed = roster.filter((m) => m.confirmed).length;
    const active = roster.filter((m) => m.active).length;
    const byRole = Object.keys(ROLE_LABELS).reduce(
      (acc, role) => {
        acc[role as RosterRole] = roster.filter(
          (m) => m.role === role,
        ).length;
        return acc;
      },
      {} as Record<RosterRole, number>,
    );
    return { total, confirmed, active, byRole };
  }, [roster]);

  // Unique teams for bulk assign dropdown
  const uniqueTeams = useMemo(
    () =>
      Array.from(
        new Set(roster.map((m) => m.team).filter((t): t is string => !!t)),
      ).sort(),
    [roster],
  );

  // ---------- Selection helpers ----------

  const toggleRosterSelection = useCallback((id: string) => {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllRoster = useCallback(() => {
    setSelectedRosterIds((prev) => {
      if (prev.size === roster.length) return new Set();
      return new Set(roster.map((m) => m.id));
    });
  }, [roster]);

  const clearRosterSelection = useCallback(() => {
    setSelectedRosterIds(new Set());
  }, []);

  // ---------- Bulk action handlers ----------

  const handleBulkMarkConfirmed = useCallback(
    async (confirmed: boolean) => {
      if (!currentEvent || selectedRosterIds.size === 0) return;
      setBulkLoading(true);
      try {
        await bulkUpdateRosterStatus(
          Array.from(selectedRosterIds),
          currentEvent.id,
          { confirmed },
        );
        toast.success(
          `${selectedRosterIds.size} member${selectedRosterIds.size !== 1 ? "s" : ""} ${confirmed ? "confirmed" : "unconfirmed"}`,
        );

        // Fire-and-forget: update sheet rows
        const members = roster.filter((m) => selectedRosterIds.has(m.id));
        for (const member of members) {
          sheetPush(
            {
              action: "update_raw",
              sheetTitle: "Roster Push",
              matchColumnIndex: 0,
              matchValue: member.id,
              values: rosterMemberToRow({ ...member, confirmed }),
            },
            { successMessage: false, queuedMessage: false, onSuccess: () => setLastSyncedAt(new Date()) },
          );
        }

        clearRosterSelection();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update members",
        );
      } finally {
        setBulkLoading(false);
      }
    },
    [currentEvent, selectedRosterIds, roster, clearRosterSelection, sheetPush],
  );

  const handleBulkMarkActive = useCallback(
    async (active: boolean) => {
      if (!currentEvent || selectedRosterIds.size === 0) return;
      setBulkLoading(true);
      try {
        await bulkUpdateRosterStatus(
          Array.from(selectedRosterIds),
          currentEvent.id,
          { active },
        );
        toast.success(
          `${selectedRosterIds.size} member${selectedRosterIds.size !== 1 ? "s" : ""} ${active ? "activated" : "deactivated"}`,
        );

        // Fire-and-forget: update sheet rows
        const members = roster.filter((m) => selectedRosterIds.has(m.id));
        for (const member of members) {
          sheetPush(
            {
              action: "update_raw",
              sheetTitle: "Roster Push",
              matchColumnIndex: 0,
              matchValue: member.id,
              values: rosterMemberToRow({ ...member, active }),
            },
            { successMessage: false, queuedMessage: false, onSuccess: () => setLastSyncedAt(new Date()) },
          );
        }

        clearRosterSelection();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update members",
        );
      } finally {
        setBulkLoading(false);
      }
    },
    [currentEvent, selectedRosterIds, roster, clearRosterSelection, sheetPush],
  );

  const handleBulkAssignTeam = useCallback(
    async (team: string) => {
      if (!currentEvent || selectedRosterIds.size === 0) return;
      setBulkLoading(true);
      try {
        await bulkAssignTeam(
          Array.from(selectedRosterIds),
          currentEvent.id,
          team,
        );
        toast.success(
          `${selectedRosterIds.size} member${selectedRosterIds.size !== 1 ? "s" : ""} assigned to ${team}`,
        );

        // Fire-and-forget: update sheet rows
        const members = roster.filter((m) => selectedRosterIds.has(m.id));
        for (const member of members) {
          sheetPush(
            {
              action: "update_raw",
              sheetTitle: "Roster Push",
              matchColumnIndex: 0,
              matchValue: member.id,
              values: rosterMemberToRow({ ...member, team }),
            },
            { successMessage: false, queuedMessage: false, onSuccess: () => setLastSyncedAt(new Date()) },
          );
        }

        clearRosterSelection();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to assign team",
        );
      } finally {
        setBulkLoading(false);
      }
    },
    [currentEvent, selectedRosterIds, roster, clearRosterSelection, sheetPush],
  );

  const handleBulkDeleteRoster = useCallback(async () => {
    if (!currentEvent || selectedRosterIds.size === 0) return;
    setBulkLoading(true);
    try {
      await bulkDeleteRosterMembers(
        Array.from(selectedRosterIds),
        currentEvent.id,
      );
      toast.success(
        `${selectedRosterIds.size} member${selectedRosterIds.size !== 1 ? "s" : ""} removed`,
      );
      clearRosterSelection();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete members",
      );
    } finally {
      setBulkLoading(false);
    }
  }, [currentEvent, selectedRosterIds, clearRosterSelection]);

  // ---------- Handlers ----------

  const handleAddRosterMember = useCallback(async () => {
    if (!currentEvent) return;
    if (!rosterForm.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSubmittingRoster(true);
    try {
      const formData = {
        name: rosterForm.name.trim(),
        phone: rosterForm.phone.trim() || undefined,
        email: rosterForm.email.trim() || undefined,
        role: rosterForm.role,
        team: rosterForm.team.trim() || undefined,
        commission_pct: rosterForm.commission_pct
          ? parseFloat(rosterForm.commission_pct) / 100
          : undefined,
      };
      const result = await addRosterMember(currentEvent.id, formData);
      toast.success(`${formData.name} added to roster`);
      setRosterForm(EMPTY_ROSTER_FORM);
      setRosterDialogOpen(false);

      // Fire-and-forget: push to "Roster Push" sheet
      sheetPush(
        {
          action: "append_raw",
          sheetTitle: "Roster Push",
          values: rosterMemberToRow({
            id: result.memberId,
            name: formData.name,
            phone: formData.phone ?? null,
            email: formData.email ?? null,
            role: formData.role,
            team: formData.team ?? null,
            commission_pct: formData.commission_pct ?? null,
            confirmed: false,
            active: true,
            notes: null,
          }),
        },
        {
          successMessage: "Roster synced to sheet",
          onSuccess: () => setLastSyncedAt(new Date()),
        },
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add roster member",
      );
    } finally {
      setSubmittingRoster(false);
    }
  }, [currentEvent, rosterForm, sheetPush]);

  const handleToggleConfirmed = useCallback(
    async (member: RosterMember) => {
      if (!currentEvent) return;
      setTogglingIds((prev) => new Set(prev).add(member.id));
      try {
        const newConfirmed = !member.confirmed;
        await updateRosterMember(member.id, currentEvent.id, {
          confirmed: newConfirmed,
        });
        toast.success(
          `${member.name} ${newConfirmed ? "confirmed" : "unconfirmed"}`,
        );

        // Fire-and-forget: update sheet row
        sheetPush(
          {
            action: "update_raw",
            sheetTitle: "Roster Push",
            matchColumnIndex: 0,
            matchValue: member.id,
            values: rosterMemberToRow({ ...member, confirmed: newConfirmed }),
          },
          {
            successMessage: "Sheet updated",
            onSuccess: () => setLastSyncedAt(new Date()),
          },
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update member",
        );
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(member.id);
          return next;
        });
      }
    },
    [currentEvent, sheetPush],
  );

  const handleToggleActive = useCallback(
    async (member: RosterMember) => {
      if (!currentEvent) return;
      setTogglingIds((prev) => new Set(prev).add(`active-${member.id}`));
      try {
        const newActive = !member.active;
        await updateRosterMember(member.id, currentEvent.id, {
          active: newActive,
        });
        toast.success(
          `${member.name} ${newActive ? "activated" : "deactivated"}`,
        );

        // Fire-and-forget: update sheet row
        sheetPush(
          {
            action: "update_raw",
            sheetTitle: "Roster Push",
            matchColumnIndex: 0,
            matchValue: member.id,
            values: rosterMemberToRow({ ...member, active: newActive }),
          },
          {
            successMessage: "Sheet updated",
            onSuccess: () => setLastSyncedAt(new Date()),
          },
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update member",
        );
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(`active-${member.id}`);
          return next;
        });
      }
    },
    [currentEvent, sheetPush],
  );

  const handleDeleteRosterMember = useCallback(
    async (member: RosterMember) => {
      if (!currentEvent) return;
      setDeletingIds((prev) => new Set(prev).add(member.id));
      try {
        await deleteRosterMember(member.id, currentEvent.id);
        toast.success(`${member.name} removed from roster`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete member",
        );
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(member.id);
          return next;
        });
      }
    },
    [currentEvent],
  );

  const handleAddLender = useCallback(async () => {
    if (!currentEvent) return;
    if (!lenderForm.name.trim()) {
      toast.error("Lender name is required");
      return;
    }

    setSubmittingLender(true);
    try {
      await addLender(currentEvent.id, {
        name: lenderForm.name.trim(),
        buy_rate_pct: lenderForm.buy_rate_pct
          ? parseFloat(lenderForm.buy_rate_pct)
          : undefined,
        max_advance: lenderForm.max_advance
          ? parseFloat(lenderForm.max_advance)
          : undefined,
      });
      toast.success(`${lenderForm.name.trim()} added as lender`);
      setLenderForm(EMPTY_LENDER_FORM);
      setLenderDialogOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add lender",
      );
    } finally {
      setSubmittingLender(false);
    }
  }, [currentEvent, lenderForm]);

  const handleDeleteLender = useCallback(
    async (lender: Lender) => {
      if (!currentEvent) return;
      setDeletingIds((prev) => new Set(prev).add(`lender-${lender.id}`));
      try {
        await deleteLender(lender.id, currentEvent.id);
        toast.success(`${lender.name} removed`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete lender",
        );
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(`lender-${lender.id}`);
          return next;
        });
      }
    },
    [currentEvent],
  );

  // ---------- Copy from event handlers ----------

  const handleSourceEventChange = useCallback(
    async (eventId: string) => {
      setSelectedSourceEventId(eventId);
      setSourceRoster([]);
      setSelectedMemberIds(new Set());
      if (!eventId) return;

      setLoadingSource(true);
      try {
        const members = await fetchRosterForEvent(eventId);
        setSourceRoster(members);
        setSelectedMemberIds(new Set(members.map((m) => m.id)));
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load roster",
        );
      } finally {
        setLoadingSource(false);
      }
    },
    [],
  );

  const toggleMember = useCallback((memberId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedMemberIds((prev) => {
      if (prev.size === sourceRoster.length) return new Set();
      return new Set(sourceRoster.map((m) => m.id));
    });
  }, [sourceRoster]);

  const handleCopyRoster = useCallback(async () => {
    if (!currentEvent || !selectedSourceEventId || selectedMemberIds.size === 0)
      return;

    setCopying(true);
    try {
      const { inserted, skippedCount } = await copyRosterFromEvent(
        selectedSourceEventId,
        currentEvent.id,
        Array.from(selectedMemberIds),
      );

      const parts: string[] = [];
      if (inserted.length > 0)
        parts.push(
          `${inserted.length} member${inserted.length !== 1 ? "s" : ""} copied`,
        );
      if (skippedCount > 0)
        parts.push(
          `${skippedCount} duplicate${skippedCount !== 1 ? "s" : ""} skipped`,
        );
      toast.success(parts.join(", "));

      // Fire-and-forget: push each inserted member to "Roster Push" sheet
      for (const member of inserted) {
        sheetPush(
          {
            action: "append_raw",
            sheetTitle: "Roster Push",
            values: rosterMemberToRow(member),
          },
          { successMessage: false },
        );
      }

      // Close dialog and reset
      setCopyDialogOpen(false);
      setSelectedSourceEventId("");
      setSourceRoster([]);
      setSelectedMemberIds(new Set());
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to copy roster",
      );
    } finally {
      setCopying(false);
    }
  }, [currentEvent, selectedSourceEventId, selectedMemberIds, sheetPush]);

  // ---------- Import from Sheet ----------

  const handleImportFromSheet = useCallback(async () => {
    if (!currentEvent) return;
    setImportingFromSheet(true);
    try {
      // 1. Read raw data from "Roster Push" sheet
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read_raw", sheetTitle: "Roster Push", spreadsheetId: currentEvent?.sheet_id, eventId: currentEvent?.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to read sheet");
      }
      const { values } = (await res.json()) as { values: string[][] };

      if (!values || values.length === 0) {
        toast.info("No data found in the Roster Push sheet");
        return;
      }

      // 2. Parse rows → member objects
      //    Columns: A=ID, B=NAME, C=PHONE, D=EMAIL, E=ROLE, F=TEAM,
      //             G=COMM %, H=CONFIRMED, I=ACTIVE, J=NOTES
      //    Skip header row (first row where col 0 = "ID" or col 1 = "NAME")
      const dataRows = values.filter((row, idx) => {
        if (idx === 0 && (row[0]?.toUpperCase() === "ID" || row[1]?.toUpperCase() === "NAME")) {
          return false; // skip header
        }
        return true;
      });

      const members = dataRows
        .filter((row) => row[1]?.trim()) // must have a name
        .map((row) => {
          const roleLabel = (row[4] ?? "").toLowerCase().trim();
          const role = ROLE_FROM_LABEL[roleLabel] ?? "sales";
          const commPctStr = (row[6] ?? "").replace("%", "").trim();
          const commPct = commPctStr ? parseFloat(commPctStr) / 100 : null;
          return {
            id: row[0]?.trim() || undefined,
            name: row[1].trim(),
            phone: row[2]?.trim() || null,
            email: row[3]?.trim() || null,
            role,
            team: row[5]?.trim() || null,
            commission_pct: commPct,
            confirmed: (row[7] ?? "").toUpperCase() === "YES",
            active: (row[8] ?? "").toUpperCase() !== "NO", // default true
            notes: row[9]?.trim() || null,
          };
        });

      if (members.length === 0) {
        toast.info("No valid roster members found in the sheet");
        return;
      }

      // 3. Upsert into Supabase via server action
      const result = await importRosterMembers(currentEvent.id, members);

      const parts: string[] = [];
      if (result.insertedCount > 0)
        parts.push(`${result.insertedCount} imported`);
      if (result.updatedCount > 0)
        parts.push(`${result.updatedCount} updated`);
      if (result.skippedCount > 0)
        parts.push(`${result.skippedCount} duplicates skipped`);
      toast.success(
        parts.length > 0 ? parts.join(", ") : "Roster is already up to date",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import from sheet",
      );
    } finally {
      setImportingFromSheet(false);
    }
  }, [currentEvent]);

  // ---------- Push Roster to Sheet ----------

  const handlePushRosterToSheet = useCallback(async () => {
    if (!currentEvent || roster.length === 0) return;
    setPushingToSheet(true);
    try {
      // Build header + data rows
      const header = [
        "ID",
        "NAME",
        "PHONE",
        "EMAIL",
        "ROLE",
        "TEAM",
        "COMM %",
        "CONFIRMED",
        "ACTIVE",
        "NOTES",
      ];
      const dataRows = roster.map((m) => rosterMemberToRow(m));

      // Write to sheet (clear + replace)
      const result = await sheetPush(
        {
          action: "write_raw",
          sheetTitle: "Roster Push",
          values: [header, ...dataRows],
        },
        {
          successMessage: `${roster.length} roster members pushed to sheet`,
          onSuccess: () => setLastSyncedAt(new Date()),
        },
      );
      if (!result.success && !result.queued && result.error) {
        throw new Error(result.error);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to push roster to sheet",
      );
    } finally {
      setPushingToSheet(false);
    }
  }, [currentEvent, roster, sheetPush]);

  // ---------- No event selected ----------

  if (!currentEvent) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">
          Select an event to manage the roster
        </p>
      </div>
    );
  }

  // ---------- Loading ----------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Roster &amp; Lenders
          </h1>
          <p className="text-sm text-muted-foreground">
            {currentEvent.dealer_name ?? currentEvent.name} &mdash; Sales team
            and lender configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Add Roster Member Dialog */}
          <Dialog open={rosterDialogOpen} onOpenChange={setRosterDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="mr-1.5 h-4 w-4" />
                Add Member
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Team Member</DialogTitle>
                <DialogDescription>
                  Add a new salesperson or team member to this event&apos;s
                  roster.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="roster-name">Name *</Label>
                  <Input
                    id="roster-name"
                    placeholder="John Smith"
                    value={rosterForm.name}
                    onChange={(e) =>
                      setRosterForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="roster-phone">Phone</Label>
                    <Input
                      id="roster-phone"
                      placeholder="(555) 123-4567"
                      value={rosterForm.phone}
                      onChange={(e) =>
                        setRosterForm((f) => ({ ...f, phone: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="roster-email">Email</Label>
                    <Input
                      id="roster-email"
                      type="email"
                      placeholder="john@example.com"
                      value={rosterForm.email}
                      onChange={(e) =>
                        setRosterForm((f) => ({ ...f, email: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="roster-role">Role</Label>
                    <Select
                      value={rosterForm.role}
                      onValueChange={(v) =>
                        setRosterForm((f) => ({
                          ...f,
                          role: v as RosterRole,
                        }))
                      }
                    >
                      <SelectTrigger id="roster-role">
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
                    <Label htmlFor="roster-team">Team</Label>
                    <Input
                      id="roster-team"
                      placeholder="Team A"
                      value={rosterForm.team}
                      onChange={(e) =>
                        setRosterForm((f) => ({ ...f, team: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="roster-commission">Commission %</Label>
                  <Input
                    id="roster-commission"
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    placeholder="25"
                    value={rosterForm.commission_pct}
                    onChange={(e) =>
                      setRosterForm((f) => ({
                        ...f,
                        commission_pct: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setRosterDialogOpen(false)}
                  disabled={submittingRoster}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddRosterMember}
                  disabled={submittingRoster}
                >
                  {submittingRoster && (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  )}
                  Add Member
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Copy from Event Dialog */}
          <Dialog
            open={copyDialogOpen}
            onOpenChange={(open) => {
              setCopyDialogOpen(open);
              if (!open) {
                setSelectedSourceEventId("");
                setSourceRoster([]);
                setSelectedMemberIds(new Set());
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={otherEvents.length === 0}
              >
                <Copy className="mr-1.5 h-4 w-4" />
                Copy from Event
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Copy Roster from Previous Event</DialogTitle>
                <DialogDescription>
                  Select a previous event to copy team members into the current
                  roster. Duplicates (by name) will be skipped automatically.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                {/* Event selector */}
                <div className="grid gap-2">
                  <Label>Source Event</Label>
                  <Select
                    value={selectedSourceEventId}
                    onValueChange={handleSourceEventChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an event..." />
                    </SelectTrigger>
                    <SelectContent>
                      {otherEvents.map((event) => (
                        <SelectItem key={event.id} value={event.id}>
                          {event.dealer_name ?? event.name}
                          {event.start_date ? ` (${event.start_date})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Loading state */}
                {loadingSource && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Preview table */}
                {!loadingSource && sourceRoster.length > 0 && (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label>
                        Team Members ({selectedMemberIds.size} of{" "}
                        {sourceRoster.length} selected)
                      </Label>
                      <Button variant="ghost" size="sm" onClick={toggleAll}>
                        {selectedMemberIds.size === sourceRoster.length
                          ? "Deselect All"
                          : "Select All"}
                      </Button>
                    </div>
                    <ScrollArea className="h-[300px] rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <Checkbox
                                checked={
                                  selectedMemberIds.size ===
                                  sourceRoster.length
                                }
                                onCheckedChange={toggleAll}
                              />
                            </TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead className="hidden sm:table-cell">
                              Team
                            </TableHead>
                            <TableHead className="text-right">
                              Comm %
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sourceRoster.map((member) => (
                            <TableRow key={member.id}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedMemberIds.has(member.id)}
                                  onCheckedChange={() =>
                                    toggleMember(member.id)
                                  }
                                />
                              </TableCell>
                              <TableCell className="font-medium">
                                {member.name}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className={
                                    ROLE_COLORS[member.role as RosterRole]
                                  }
                                >
                                  {ROLE_LABELS[member.role as RosterRole] ??
                                    member.role}
                                </Badge>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-muted-foreground">
                                {member.team ?? "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {member.commission_pct != null
                                  ? `${(member.commission_pct * 100).toFixed(0)}%`
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>
                )}

                {/* Empty state */}
                {!loadingSource &&
                  selectedSourceEventId &&
                  sourceRoster.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No team members found in the selected event.
                    </p>
                  )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCopyDialogOpen(false)}
                  disabled={copying}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCopyRoster}
                  disabled={copying || selectedMemberIds.size === 0}
                >
                  {copying && (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  )}
                  Copy {selectedMemberIds.size} Member
                  {selectedMemberIds.size !== 1 ? "s" : ""}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Import from Google Sheet */}
          <Button
            size="sm"
            variant="outline"
            disabled={importingFromSheet}
            onClick={handleImportFromSheet}
          >
            {importingFromSheet ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Import from Sheet
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCSVImportOpen(true)}
          >
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            CSV Import
          </Button>

          {/* Push Roster to Sheet */}
          <Button
            size="sm"
            variant="outline"
            disabled={pushingToSheet || roster.length === 0}
            onClick={handlePushRosterToSheet}
          >
            {pushingToSheet ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            Push to Sheet
          </Button>

          <LastSyncedIndicator syncedAt={lastSyncedAt} />

          {/* Add Lender Dialog */}
          <Dialog open={lenderDialogOpen} onOpenChange={setLenderDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Building2 className="mr-1.5 h-4 w-4" />
                Add Lender
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add Lender</DialogTitle>
                <DialogDescription>
                  Add a new lender / finance source for this event.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="lender-name">Lender Name *</Label>
                  <Input
                    id="lender-name"
                    placeholder="Capital One Auto Finance"
                    value={lenderForm.name}
                    onChange={(e) =>
                      setLenderForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="lender-rate">Buy Rate %</Label>
                    <Input
                      id="lender-rate"
                      type="number"
                      step="0.25"
                      min="0"
                      placeholder="3.5"
                      value={lenderForm.buy_rate_pct}
                      onChange={(e) =>
                        setLenderForm((f) => ({
                          ...f,
                          buy_rate_pct: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="lender-advance">Max Advance</Label>
                    <Input
                      id="lender-advance"
                      type="number"
                      step="500"
                      min="0"
                      placeholder="45000"
                      value={lenderForm.max_advance}
                      onChange={(e) =>
                        setLenderForm((f) => ({
                          ...f,
                          max_advance: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setLenderDialogOpen(false)}
                  disabled={submittingLender}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddLender}
                  disabled={submittingLender}
                >
                  {submittingLender && (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  )}
                  Add Lender
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Total Team
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Confirmed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {stats.confirmed}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sales</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-700">
              {stats.byRole.sales}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Team Leaders</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-purple-700">
              {stats.byRole.team_leader}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>F&amp;I Managers</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {stats.byRole.fi_manager}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Closers</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-700">
              {stats.byRole.closer}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Roster Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team Roster
            <Badge variant="secondary" className="ml-auto">
              {roster.length} member{roster.length !== 1 ? "s" : ""}
            </Badge>
          </CardTitle>
          <CardDescription>
            Manage your sales team for this event. Toggle confirmed status and
            active/inactive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Bulk actions toolbar */}
          <BulkActionsToolbar
            selectedCount={selectedRosterIds.size}
            onClearSelection={clearRosterSelection}
            isLoading={bulkLoading}
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkLoading}
              onClick={() => handleBulkMarkConfirmed(true)}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Mark Confirmed
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkLoading}
              onClick={() => handleBulkMarkActive(true)}
            >
              Mark Active
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkLoading}
              onClick={() => handleBulkMarkActive(false)}
            >
              Mark Inactive
            </Button>
            {uniqueTeams.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkLoading}
                  >
                    Assign Team
                    <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {uniqueTeams.map((team) => (
                    <DropdownMenuItem
                      key={team}
                      onClick={() => handleBulkAssignTeam(team)}
                    >
                      {team}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              size="sm"
              variant="destructive"
              disabled={bulkLoading}
              onClick={handleBulkDeleteRoster}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          </BulkActionsToolbar>

          {roster.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <h3 className="text-lg font-semibold">No team members yet</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                Get started by adding your sales team, closers, F&amp;I managers,
                and team leaders.
              </p>
              <Button size="sm" onClick={() => setRosterDialogOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add First Member
              </Button>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          roster.length > 0 &&
                          selectedRosterIds.size === roster.length
                        }
                        onCheckedChange={toggleAllRoster}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden sm:table-cell">Team</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden lg:table-cell">Email</TableHead>
                    <TableHead className="text-right">Comm %</TableHead>
                    <TableHead className="text-center">Confirmed</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.map((member) => (
                    <TableRow
                      key={member.id}
                      className={!member.active ? "opacity-50" : undefined}
                      data-state={
                        selectedRosterIds.has(member.id) ? "selected" : undefined
                      }
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedRosterIds.has(member.id)}
                          onCheckedChange={() =>
                            toggleRosterSelection(member.id)
                          }
                          aria-label={`Select ${member.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {member.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={ROLE_COLORS[member.role]}
                        >
                          {ROLE_LABELS[member.role]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {member.team ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground whitespace-nowrap">
                        {member.phone ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">
                        {member.email ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {member.commission_pct != null
                          ? `${(member.commission_pct * 100).toFixed(0)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={togglingIds.has(member.id)}
                          onClick={() => handleToggleConfirmed(member)}
                          title={
                            member.confirmed
                              ? "Mark unconfirmed"
                              : "Mark confirmed"
                          }
                        >
                          {togglingIds.has(member.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : member.confirmed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={togglingIds.has(`active-${member.id}`)}
                          onClick={() => handleToggleActive(member)}
                          title={
                            member.active ? "Deactivate" : "Activate"
                          }
                        >
                          {togglingIds.has(`active-${member.id}`) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : member.active ? (
                            <Badge
                              variant="secondary"
                              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-[10px] px-1.5"
                            >
                              ON
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 text-[10px] px-1.5"
                            >
                              OFF
                            </Badge>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setEditingMember(member)}
                            title={`Edit ${member.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            disabled={deletingIds.has(member.id)}
                            onClick={() => handleDeleteRosterMember(member)}
                            title={`Remove ${member.name}`}
                          >
                            {deletingIds.has(member.id) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lenders Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Lenders
            <Badge variant="secondary" className="ml-auto">
              {lenders.length} lender{lenders.length !== 1 ? "s" : ""}
            </Badge>
          </CardTitle>
          <CardDescription>
            Finance sources and lender configurations for this event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lenders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <h3 className="text-lg font-semibold">No lenders configured</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                Add lenders to track buy rates and max advance amounts for deals.
              </p>
              <Button size="sm" onClick={() => setLenderDialogOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add First Lender
              </Button>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lender Name</TableHead>
                    <TableHead className="text-right">Buy Rate %</TableHead>
                    <TableHead className="text-right">Max Advance</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lenders.map((lender) => (
                    <TableRow
                      key={lender.id}
                      className={!lender.active ? "opacity-50" : undefined}
                    >
                      <TableCell className="font-medium whitespace-nowrap">
                        {lender.name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lender.buy_rate_pct != null
                          ? `${lender.buy_rate_pct}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lender.max_advance != null
                          ? formatCurrency(lender.max_advance)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {lender.active ? (
                          <Badge
                            variant="secondary"
                            className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          >
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setEditingLender(lender)}
                            title={`Edit ${lender.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            disabled={deletingIds.has(`lender-${lender.id}`)}
                            onClick={() => handleDeleteLender(lender)}
                            title={`Remove ${lender.name}`}
                          >
                            {deletingIds.has(`lender-${lender.id}`) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Roster Member Dialog */}
      <Dialog
        open={editingMember !== null}
        onOpenChange={(open) => {
          if (!open) setEditingMember(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              Update details for {editingMember?.name ?? "this team member"}.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            {editingMember && currentEvent && (
              <EditRosterMemberForm
                key={editingMember.id}
                member={editingMember}
                eventId={currentEvent.id}
                sheetId={currentEvent.sheet_id}
                onSuccess={() => setEditingMember(null)}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Edit Lender Dialog */}
      <Dialog
        open={editingLender !== null}
        onOpenChange={(open) => {
          if (!open) setEditingLender(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Lender</DialogTitle>
            <DialogDescription>
              Update details for {editingLender?.name ?? "this lender"}.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            {editingLender && currentEvent && (
              <EditLenderForm
                key={editingLender.id}
                lender={editingLender}
                eventId={currentEvent.id}
                onSuccess={() => setEditingLender(null)}
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* CSV Import Dialog */}
      {currentEvent && (
        <CSVImportDialog
          open={csvImportOpen}
          onOpenChange={setCSVImportOpen}
          eventId={currentEvent.id}
          onImport={async (members) => {
            const result = await importRosterMembers(
              currentEvent.id,
              members,
            );
            return result;
          }}
        />
      )}
    </div>
  );
}
