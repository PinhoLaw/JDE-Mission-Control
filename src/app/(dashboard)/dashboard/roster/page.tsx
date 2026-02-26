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
  deleteLender,
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
import {
  Plus,
  Users,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  UserPlus,
  Building2,
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
// Page Component
// ---------------------------------------------------------------------------

export default function RosterPage() {
  const { currentEvent } = useEvent();

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

  // ---------- Data fetching + realtime ----------

  useEffect(() => {
    if (!currentEvent) return;

    setLoading(true);
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

  // ---------- Handlers ----------

  const handleAddRosterMember = useCallback(async () => {
    if (!currentEvent) return;
    if (!rosterForm.name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSubmittingRoster(true);
    try {
      await addRosterMember(currentEvent.id, {
        name: rosterForm.name.trim(),
        phone: rosterForm.phone.trim() || undefined,
        email: rosterForm.email.trim() || undefined,
        role: rosterForm.role,
        team: rosterForm.team.trim() || undefined,
        commission_pct: rosterForm.commission_pct
          ? parseFloat(rosterForm.commission_pct)
          : undefined,
      });
      toast.success(`${rosterForm.name.trim()} added to roster`);
      setRosterForm(EMPTY_ROSTER_FORM);
      setRosterDialogOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add roster member",
      );
    } finally {
      setSubmittingRoster(false);
    }
  }, [currentEvent, rosterForm]);

  const handleToggleConfirmed = useCallback(
    async (member: RosterMember) => {
      if (!currentEvent) return;
      setTogglingIds((prev) => new Set(prev).add(member.id));
      try {
        await updateRosterMember(member.id, currentEvent.id, {
          confirmed: !member.confirmed,
        });
        toast.success(
          `${member.name} ${!member.confirmed ? "confirmed" : "unconfirmed"}`,
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
    [currentEvent],
  );

  const handleToggleActive = useCallback(
    async (member: RosterMember) => {
      if (!currentEvent) return;
      setTogglingIds((prev) => new Set(prev).add(`active-${member.id}`));
      try {
        await updateRosterMember(member.id, currentEvent.id, {
          active: !member.active,
        });
        toast.success(
          `${member.name} ${!member.active ? "activated" : "deactivated"}`,
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
    [currentEvent],
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
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden sm:table-cell">Team</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden lg:table-cell">Email</TableHead>
                    <TableHead className="text-right">Comm %</TableHead>
                    <TableHead className="text-center">Confirmed</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.map((member) => (
                    <TableRow
                      key={member.id}
                      className={!member.active ? "opacity-50" : undefined}
                    >
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
                          ? `${member.commission_pct}%`
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
                    <TableHead className="w-10" />
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
