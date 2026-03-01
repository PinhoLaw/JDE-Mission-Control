import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  CalendarDays,
  DollarSign,
  MapPin,
  Car,
  TrendingUp,
  Users,
  Package,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { LegacyUploadButton } from "@/components/events/legacy-spreadsheet-upload";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

export default async function EventDetailPage({
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
  const [inventoryRes, dealsRes, metricsRes, rosterRes] = await Promise.all([
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
      .from("daily_metrics")
      .select("*")
      .eq("event_id", eventId)
      .order("sale_day", { ascending: true }),
    supabase
      .from("roster")
      .select("*")
      .eq("event_id", eventId),
  ]);

  const vehicles = inventoryRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const metrics = metricsRes.data ?? [];
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

  const statusColor: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    active: "bg-green-100 text-green-800",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-red-100 text-red-800",
  };

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
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/dashboard/events">
            <ArrowLeft className="h-4 w-4" />
            Back to Events
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                {event.name}
              </h1>
              <Badge
                variant="secondary"
                className={statusColor[event.status]}
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
                  {new Date(event.start_date).toLocaleDateString()}
                  {event.end_date &&
                    ` — ${new Date(event.end_date).toLocaleDateString()}`}
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
          <LegacyUploadButton eventId={eventId} sheetId={event.sheet_id} />
        </div>
      </div>

      <Separator />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Deals</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalDeals}</p>
            <p className="text-xs text-muted-foreground">
              {fundedDeals} funded
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Gross</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(totalGross)}</p>
            <p className="text-xs text-muted-foreground">
              Front: {formatCurrency(totalFrontGross)} · Back:{" "}
              {formatCurrency(totalBackGross)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg PVR</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(avgPvr)}</p>
            <p className="text-xs text-muted-foreground">per vehicle retailed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Inventory</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalVehicles}</p>
            <p className="text-xs text-muted-foreground">
              {availableVehicles} available · {soldVehicles} sold
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Deals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Recent Deals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals logged yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Salesperson</TableHead>
                  <TableHead className="text-right">Front</TableHead>
                  <TableHead className="text-right">Back</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.slice(0, 10).map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell className="font-medium">
                      {deal.deal_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      {deal.vehicle_year} {deal.vehicle_make}{" "}
                      {deal.vehicle_model}
                    </TableCell>
                    <TableCell>{deal.customer_name ?? "—"}</TableCell>
                    <TableCell>{deal.salesperson ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(deal.front_gross ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(deal.back_gross ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {formatCurrency(deal.total_gross ?? 0)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          deal.status === "funded"
                            ? "bg-green-100 text-green-800"
                            : deal.status === "pending"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-red-100 text-red-800"
                        }
                      >
                        {deal.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Inventory Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Inventory ({totalVehicles})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No vehicles in inventory yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hat#</TableHead>
                  <TableHead>Stock#</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Ask 120%</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.slice(0, 15).map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      {v.hat_number ?? "—"}
                    </TableCell>
                    <TableCell>{v.stock_number ?? "—"}</TableCell>
                    <TableCell>
                      {v.year} {v.make} {v.model}
                      {v.trim ? ` ${v.trim}` : ""}
                    </TableCell>
                    <TableCell>{v.color ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(v.acquisition_cost ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(v.asking_price_120 ?? 0)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          v.status === "available"
                            ? "bg-green-100 text-green-800"
                            : v.status === "sold"
                              ? "bg-blue-100 text-blue-800"
                              : v.status === "hold"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-gray-100 text-gray-800"
                        }
                      >
                        {v.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
