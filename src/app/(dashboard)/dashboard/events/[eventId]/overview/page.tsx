import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  CalendarDays,
  DollarSign,
  MapPin,
  Car,
  TrendingUp,
  Users,
  Package,
  FileSpreadsheet,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { eventStatusColor } from "@/lib/constants/status-colors";
import { OpenGoogleSheetButton } from "@/components/events/open-google-sheet-button";
import { LegacyUploadButton } from "@/components/events/legacy-spreadsheet-upload";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { EventSubNav } from "@/components/events/event-sub-nav";
import { StatCard } from "@/components/ui/stat-card";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

export default async function EventOverviewPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error || !data) {
    notFound();
  }

  const event: Event = data;

  // Fetch all data in parallel
  const [inventoryRes, dealsRes, rosterRes] = await Promise.all([
    supabase
      .from("vehicle_inventory")
      .select("*")
      .eq("event_id", eventId)
      .order("hat_number", { ascending: true }),
    supabase
      .from("sales_deals")
      .select("*")
      .eq("event_id", eventId)
      .order("deal_number", { ascending: true }),
    supabase
      .from("roster")
      .select("*")
      .eq("event_id", eventId),
  ]);

  const vehicles = inventoryRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const roster = rosterRes.data ?? [];

  // Compute KPIs
  const totalVehicles = vehicles.length;
  const availableVehicles = vehicles.filter(
    (v) => v.status === "available",
  ).length;
  const soldVehicles = vehicles.filter((v) => v.status === "sold").length;

  const totalDeals = deals.length;
  const fundedDeals = deals.filter((d) => d.status === "funded").length;
  const totalFrontGross = deals.reduce(
    (sum, d) => sum + (d.front_gross ?? 0),
    0,
  );
  const totalBackGross = deals.reduce(
    (sum, d) => sum + (d.back_gross ?? 0),
    0,
  );
  const totalGross = deals.reduce(
    (sum, d) => sum + (d.total_gross ?? 0),
    0,
  );
  const avgPvr =
    totalDeals > 0 ? totalGross / totalDeals : 0;

  const locationParts = [
    event.dealer_name,
    event.address,
    event.city && event.state
      ? `${event.city}, ${event.state} ${event.zip ?? ""}`
      : event.city || event.state,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <EventSubNav eventId={eventId} current="overview" />
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                {event.name}
              </h1>
              <Badge
                variant="secondary"
                className={eventStatusColor(event.status)}
              >
                {event.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {locationParts.length > 0 && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {locationParts.join(" · ")}
                </span>
              )}
              {event.start_date && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {new Date(event.start_date + "T12:00:00").toLocaleDateString()}
                  {event.end_date &&
                    ` — ${new Date(event.end_date + "T12:00:00").toLocaleDateString()}`}
                </span>
              )}
              {event.budget != null && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {formatCurrency(event.budget)}
                </span>
              )}
              {event.franchise && (
                <Badge variant="outline">{event.franchise}</Badge>
              )}
            </div>
          </div>
          {/* Google Sheets auto-creation — replaces Excel upload flow (March 2026) */}
          <div className="flex items-center gap-2">
            <OpenGoogleSheetButton
              sheetUrl={event.sheet_url}
              sheetId={event.sheet_id}
            />
            <LegacyUploadButton eventId={eventId} sheetId={event.sheet_id} />
            <DeleteEventButton eventId={eventId} eventName={event.name} />
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Google Sheet Prompt (shown when event has no data) ── */}
      {totalDeals === 0 && totalVehicles === 0 && (
        <Card className="border-dashed border-2 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <FileSpreadsheet className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              Open Your Google Sheet
            </h2>
            <p className="text-muted-foreground max-w-md mb-6">
              A Google Sheet was automatically created for this event. Open it to
              enter your Inventory, Deals, Roster, Lenders &amp; Campaign data,
              then import it back into the dashboard.
            </p>
            <div className="flex items-center gap-3">
              <OpenGoogleSheetButton
                sheetUrl={event.sheet_url}
                sheetId={event.sheet_id}
                size="default"
                variant="default"
                label="Open Google Sheet"
              />
              <LegacyUploadButton
                eventId={eventId}
                sheetId={event.sheet_id}
                size="default"
                variant="outline"
                label="Import Spreadsheet"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Deals"
          value={totalDeals}
          icon={TrendingUp}
          subtitle={`${fundedDeals} funded`}
        />
        <StatCard
          label="Total Gross"
          value={formatCurrency(totalGross)}
          icon={DollarSign}
          subtitle={`Front: ${formatCurrency(totalFrontGross)} · Back: ${formatCurrency(totalBackGross)}`}
        />
        <StatCard
          label="Avg PVR"
          value={formatCurrency(avgPvr)}
          icon={DollarSign}
          subtitle="per vehicle retailed"
        />
        <StatCard
          label="Inventory"
          value={totalVehicles}
          icon={Car}
          subtitle={`${availableVehicles} available · ${soldVehicles} sold`}
        />
      </div>

      {/* Quick-access link cards (replaces static preview tables) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href={`/dashboard/deals`}>
          <Card className="group cursor-pointer transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="rounded-lg bg-primary/10 p-3">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-lg font-semibold group-hover:text-primary transition-colors">
                  Deal Log
                </p>
                <p className="text-sm text-muted-foreground">
                  {totalDeals} deals · {fundedDeals} funded · {formatCurrency(totalGross)} gross
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href={`/dashboard/inventory`}>
          <Card className="group cursor-pointer transition-colors hover:border-primary/50">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="rounded-lg bg-primary/10 p-3">
                <Package className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-lg font-semibold group-hover:text-primary transition-colors">
                  Inventory
                </p>
                <p className="text-sm text-muted-foreground">
                  {totalVehicles} vehicles · {availableVehicles} available · {soldVehicles} sold
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Team */}
      {roster.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team ({roster.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {roster.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">{member.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {member.role.replace("_", " ")}
                    </p>
                  </div>
                  <Badge variant={member.confirmed ? "default" : "outline"}>
                    {member.confirmed ? "Confirmed" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
