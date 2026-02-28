"use client";

import { useState, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Copy, Loader2 } from "lucide-react";
import {
  createEventFromTemplate,
  fetchEventsForTemplateSelection,
} from "@/app/(dashboard)/dashboard/events/actions";

type TemplateEvent = {
  id: string;
  name: string;
  dealer_name: string | null;
  status: string;
  sheet_id: string | null;
};

export function CreateFromTemplateDialog() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TemplateEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [name, setName] = useState("");
  const [dealerName, setDealerName] = useState("");
  const [franchise, setFranchise] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saleDays, setSaleDays] = useState("");
  const [budget, setBudget] = useState("");

  const [copyRoster, setCopyRoster] = useState(true);
  const [copyLenders, setCopyLenders] = useState(true);
  const [copySettings, setCopySettings] = useState(true);
  const [createSheet, setCreateSheet] = useState(true);

  // Load events when dialog opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchEventsForTemplateSelection()
      .then((data) => setEvents(data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [open]);

  const selectedTemplate = events.find((e) => e.id === selectedTemplateId);

  function handleSubmit() {
    if (!selectedTemplateId || !name.trim()) {
      setError("Please select a template and enter an event name");
      return;
    }

    setError(null);

    const formData = new FormData();
    formData.set("name", name.trim());
    formData.set("dealer_name", dealerName.trim());
    formData.set("franchise", franchise.trim());
    formData.set("city", city.trim());
    formData.set("state", state.trim());
    formData.set("zip", zip.trim());
    formData.set("start_date", startDate);
    formData.set("end_date", endDate);
    formData.set("sale_days", saleDays);
    formData.set("budget", budget);
    formData.set("copy_roster", copyRoster ? "true" : "false");
    formData.set("copy_lenders", copyLenders ? "true" : "false");
    formData.set("copy_settings", copySettings ? "true" : "false");
    formData.set("create_sheet", createSheet ? "true" : "false");

    startTransition(async () => {
      try {
        await createEventFromTemplate(selectedTemplateId, formData);
        // redirect happens inside the action
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Copy className="h-4 w-4" />
          Create from Template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Event from Template</DialogTitle>
          <DialogDescription>
            Copy roster, lenders, settings, and Google Sheet from an existing
            event.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Template selector */}
          <div className="space-y-2">
            <Label>Template Event *</Label>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading events...
              </div>
            ) : (
              <Select
                value={selectedTemplateId}
                onValueChange={setSelectedTemplateId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an event to use as template" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      <div className="flex items-center gap-2">
                        <span>{event.name}</span>
                        {event.sheet_id && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Sheet
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* New event name */}
          <div className="space-y-2">
            <Label htmlFor="tpl-name">New Event Name *</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lincoln CDJR March 2026"
            />
          </div>

          {/* Dealer info */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tpl-dealer">Dealer Name</Label>
              <Input
                id="tpl-dealer"
                value={dealerName}
                onChange={(e) => setDealerName(e.target.value)}
                placeholder="From template if empty"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-franchise">Franchise</Label>
              <Input
                id="tpl-franchise"
                value={franchise}
                onChange={(e) => setFranchise(e.target.value)}
                placeholder="From template if empty"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="tpl-city">City</Label>
              <Input
                id="tpl-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-state">State</Label>
              <Input
                id="tpl-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-zip">Zip</Label>
              <Input
                id="tpl-zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="tpl-start">Start Date</Label>
              <Input
                id="tpl-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-end">End Date</Label>
              <Input
                id="tpl-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-days">Sale Days</Label>
              <Input
                id="tpl-days"
                type="number"
                min="1"
                value={saleDays}
                onChange={(e) => setSaleDays(e.target.value)}
                placeholder="12"
              />
            </div>
          </div>

          {/* Budget */}
          <div className="space-y-2">
            <Label htmlFor="tpl-budget">Budget ($)</Label>
            <Input
              id="tpl-budget"
              type="number"
              step="0.01"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>

          {/* Copy options */}
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Copy from template</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={copyRoster}
                  onCheckedChange={(v) => setCopyRoster(v === true)}
                />
                Copy Roster
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={copyLenders}
                  onCheckedChange={(v) => setCopyLenders(v === true)}
                />
                Copy Lenders
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={copySettings}
                  onCheckedChange={(v) => setCopySettings(v === true)}
                />
                Copy Settings
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={createSheet}
                  onCheckedChange={(v) => setCreateSheet(v === true)}
                  disabled={!selectedTemplate?.sheet_id}
                />
                <span
                  className={
                    !selectedTemplate?.sheet_id ? "text-muted-foreground" : ""
                  }
                >
                  Create Google Sheet
                  {!selectedTemplate?.sheet_id && " (no source sheet)"}
                </span>
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3">
            <Button
              onClick={handleSubmit}
              disabled={isPending || !selectedTemplateId || !name.trim()}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Event"
              )}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
