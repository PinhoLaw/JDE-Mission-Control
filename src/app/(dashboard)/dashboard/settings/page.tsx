"use client";

import { useEffect, useState, useCallback } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type { EventConfig } from "@/types/database";
import { updateEventConfig, updateEventDetails } from "@/lib/actions/settings";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { Save, Settings2, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Event Details form state
// ---------------------------------------------------------------------------
interface EventDetailsForm {
  dealer_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  franchise: string;
  sale_days: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "completed" | "cancelled";
}

function emptyEventDetails(): EventDetailsForm {
  return {
    dealer_name: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    franchise: "",
    sale_days: "",
    start_date: "",
    end_date: "",
    status: "draft",
  };
}

// ---------------------------------------------------------------------------
// Event Config form state
// Percentage fields are stored as display values (e.g. 8.5 for 8.5%)
// ---------------------------------------------------------------------------
interface EventConfigForm {
  doc_fee: string;
  tax_rate: string;
  pack: string;
  jde_commission_pct: string;
  rep_commission_pct: string;
  target_units: string;
  target_gross: string;
  target_pvr: string;
  washout_threshold: string;
  mail_campaign_name: string;
  mail_pieces_sent: string;
}

function emptyConfigForm(): EventConfigForm {
  return {
    doc_fee: "",
    tax_rate: "",
    pack: "",
    jde_commission_pct: "",
    rep_commission_pct: "",
    target_units: "",
    target_gross: "",
    target_pvr: "",
    washout_threshold: "",
    mail_campaign_name: "",
    mail_pieces_sent: "",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a string to a number, returning null for empty / invalid values. */
function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

/** Convert a stored decimal (e.g. 0.085) to a display percentage (8.5). */
function decimalToDisplay(value: number | null | undefined): string {
  if (value == null) return "";
  return String(+(value * 100).toFixed(4));
}

/** Convert a display percentage (8.5) to a stored decimal (0.085). */
function displayToDecimal(value: string): number | null {
  const n = toNumberOrNull(value);
  if (n == null) return null;
  return +(n / 100).toFixed(6);
}

const STATUS_OPTIONS: { value: EventDetailsForm["status"]; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function statusColor(status: string) {
  switch (status) {
    case "active":
      return "default";
    case "draft":
      return "secondary";
    case "completed":
      return "outline";
    case "cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

// ===========================================================================
// Page Component
// ===========================================================================
export default function SettingsPage() {
  const { currentEvent, isLoading: eventLoading } = useEvent();

  // Loading / saving state
  const [configLoading, setConfigLoading] = useState(true);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Form state
  const [details, setDetails] = useState<EventDetailsForm>(emptyEventDetails());
  const [config, setConfig] = useState<EventConfigForm>(emptyConfigForm());

  // ------------------------------------------------------------------
  // Populate event details form when currentEvent changes
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!currentEvent) return;
    setDetails({
      dealer_name: currentEvent.dealer_name ?? "",
      address: currentEvent.address ?? "",
      city: currentEvent.city ?? "",
      state: currentEvent.state ?? "",
      zip: currentEvent.zip ?? "",
      franchise: currentEvent.franchise ?? "",
      sale_days: currentEvent.sale_days != null ? String(currentEvent.sale_days) : "",
      start_date: currentEvent.start_date ?? "",
      end_date: currentEvent.end_date ?? "",
      status: currentEvent.status,
    });
  }, [currentEvent]);

  // ------------------------------------------------------------------
  // Load event_config from Supabase when currentEvent changes
  // ------------------------------------------------------------------
  const loadConfig = useCallback(async () => {
    if (!currentEvent) return;
    setConfigLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("event_config")
        .select("*")
        .eq("event_id", currentEvent.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to load event config:", error.message);
        toast.error("Failed to load event configuration");
        setConfig(emptyConfigForm());
        return;
      }

      if (data) {
        setConfig({
          doc_fee: data.doc_fee != null ? String(data.doc_fee) : "",
          tax_rate: decimalToDisplay(data.tax_rate),
          pack: data.pack != null ? String(data.pack) : "",
          jde_commission_pct: decimalToDisplay(data.jde_commission_pct),
          rep_commission_pct: decimalToDisplay(data.rep_commission_pct),
          target_units: data.target_units != null ? String(data.target_units) : "",
          target_gross: data.target_gross != null ? String(data.target_gross) : "",
          target_pvr: data.target_pvr != null ? String(data.target_pvr) : "",
          washout_threshold:
            data.washout_threshold != null ? String(data.washout_threshold) : "",
          mail_campaign_name: data.mail_campaign_name ?? "",
          mail_pieces_sent:
            data.mail_pieces_sent != null ? String(data.mail_pieces_sent) : "",
        });
      } else {
        setConfig(emptyConfigForm());
      }
    } catch (err) {
      console.error("Unexpected error loading config:", err);
      toast.error("Unexpected error loading configuration");
      setConfig(emptyConfigForm());
    } finally {
      setConfigLoading(false);
    }
  }, [currentEvent]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // ------------------------------------------------------------------
  // Save Event Details
  // ------------------------------------------------------------------
  async function handleSaveDetails() {
    if (!currentEvent) return;
    setSavingDetails(true);
    try {
      await updateEventDetails(currentEvent.id, {
        dealer_name: details.dealer_name || null,
        address: details.address || null,
        city: details.city || null,
        state: details.state || null,
        zip: details.zip || null,
        franchise: details.franchise || null,
        sale_days: toNumberOrNull(details.sale_days),
        start_date: details.start_date || null,
        end_date: details.end_date || null,
        status: details.status,
      });
      toast.success("Event details saved successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save event details";
      toast.error(message);
    } finally {
      setSavingDetails(false);
    }
  }

  // ------------------------------------------------------------------
  // Save Event Configuration
  // ------------------------------------------------------------------
  async function handleSaveConfig() {
    if (!currentEvent) return;
    setSavingConfig(true);
    try {
      await updateEventConfig(currentEvent.id, {
        doc_fee: toNumberOrNull(config.doc_fee),
        tax_rate: displayToDecimal(config.tax_rate),
        pack: toNumberOrNull(config.pack),
        jde_commission_pct: displayToDecimal(config.jde_commission_pct),
        rep_commission_pct: displayToDecimal(config.rep_commission_pct),
        target_units: toNumberOrNull(config.target_units),
        target_gross: toNumberOrNull(config.target_gross),
        target_pvr: toNumberOrNull(config.target_pvr),
        washout_threshold: toNumberOrNull(config.washout_threshold),
        mail_campaign_name: config.mail_campaign_name || null,
        mail_pieces_sent: toNumberOrNull(config.mail_pieces_sent),
      });
      toast.success("Event configuration saved successfully");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save event configuration";
      toast.error(message);
    } finally {
      setSavingConfig(false);
    }
  }

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  if (eventLoading || configLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentEvent) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">No event selected</p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <Settings2 className="h-7 w-7 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Configure{" "}
            <span className="font-medium text-foreground">
              {currentEvent.name}
            </span>
          </p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Event Details Card                                           */}
      {/* ============================================================ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Event Details</CardTitle>
              <CardDescription>
                Dealer information, event dates, and status
              </CardDescription>
            </div>
            <Badge variant={statusColor(details.status) as any}>
              {details.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Dealer Info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dealer_name">Dealer Name</Label>
              <Input
                id="dealer_name"
                value={details.dealer_name}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, dealer_name: e.target.value }))
                }
                placeholder="Lincoln CDJR"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="franchise">Franchise</Label>
              <Input
                id="franchise"
                value={details.franchise}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, franchise: e.target.value }))
                }
                placeholder="CDJR"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={details.address}
              onChange={(e) =>
                setDetails((prev) => ({ ...prev, address: e.target.value }))
              }
              placeholder="123 Main St"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={details.city}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, city: e.target.value }))
                }
                placeholder="Springfield"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={details.state}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, state: e.target.value }))
                }
                placeholder="IL"
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">ZIP Code</Label>
              <Input
                id="zip"
                value={details.zip}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, zip: e.target.value }))
                }
                placeholder="62701"
                maxLength={10}
              />
            </div>
          </div>

          <Separator />

          {/* Dates & Status */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                type="date"
                value={details.start_date}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, start_date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                type="date"
                value={details.end_date}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, end_date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale_days">Sale Days</Label>
              <Input
                id="sale_days"
                type="number"
                min={0}
                value={details.sale_days}
                onChange={(e) =>
                  setDetails((prev) => ({ ...prev, sale_days: e.target.value }))
                }
                placeholder="12"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={details.status}
                onValueChange={(value) =>
                  setDetails((prev) => ({
                    ...prev,
                    status: value as EventDetailsForm["status"],
                  }))
                }
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSaveDetails} disabled={savingDetails}>
              {savingDetails ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Details
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* Event Configuration Card                                     */}
      {/* ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle>Event Configuration</CardTitle>
          <CardDescription>
            Financial settings, targets, and mail campaign info
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Financial Settings */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Financial Settings
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="doc_fee">Doc Fee ($)</Label>
                <Input
                  id="doc_fee"
                  type="number"
                  min={0}
                  step="0.01"
                  value={config.doc_fee}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, doc_fee: e.target.value }))
                  }
                  placeholder="799"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tax_rate">Tax Rate (%)</Label>
                <Input
                  id="tax_rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={config.tax_rate}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, tax_rate: e.target.value }))
                  }
                  placeholder="8.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pack">Pack ($)</Label>
                <Input
                  id="pack"
                  type="number"
                  min={0}
                  step="0.01"
                  value={config.pack}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, pack: e.target.value }))
                  }
                  placeholder="1200"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Commission Rates */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Commission Rates
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="jde_commission_pct">JDE Commission (%)</Label>
                <Input
                  id="jde_commission_pct"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={config.jde_commission_pct}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      jde_commission_pct: e.target.value,
                    }))
                  }
                  placeholder="35"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rep_commission_pct">Rep Commission (%)</Label>
                <Input
                  id="rep_commission_pct"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={config.rep_commission_pct}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      rep_commission_pct: e.target.value,
                    }))
                  }
                  placeholder="25"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Targets */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Targets
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="target_units">Target Units</Label>
                <Input
                  id="target_units"
                  type="number"
                  min={0}
                  value={config.target_units}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, target_units: e.target.value }))
                  }
                  placeholder="120"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="target_gross">Target Gross ($)</Label>
                <Input
                  id="target_gross"
                  type="number"
                  min={0}
                  step="0.01"
                  value={config.target_gross}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, target_gross: e.target.value }))
                  }
                  placeholder="500000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="target_pvr">Target PVR ($)</Label>
                <Input
                  id="target_pvr"
                  type="number"
                  min={0}
                  step="0.01"
                  value={config.target_pvr}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, target_pvr: e.target.value }))
                  }
                  placeholder="4200"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="washout_threshold">Washout Threshold ($)</Label>
                <Input
                  id="washout_threshold"
                  type="number"
                  min={0}
                  step="0.01"
                  value={config.washout_threshold}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      washout_threshold: e.target.value,
                    }))
                  }
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Mail Campaign */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Mail Campaign
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mail_campaign_name">Campaign Name</Label>
                <Input
                  id="mail_campaign_name"
                  value={config.mail_campaign_name}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      mail_campaign_name: e.target.value,
                    }))
                  }
                  placeholder="Spring Blowout Mailer"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mail_pieces_sent">Mail Pieces Sent</Label>
                <Input
                  id="mail_pieces_sent"
                  type="number"
                  min={0}
                  value={config.mail_pieces_sent}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      mail_pieces_sent: e.target.value,
                    }))
                  }
                  placeholder="25000"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSaveConfig} disabled={savingConfig}>
              {savingConfig ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
