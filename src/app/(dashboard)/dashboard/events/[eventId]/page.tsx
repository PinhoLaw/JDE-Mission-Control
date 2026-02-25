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
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  CalendarDays,
  DollarSign,
  MapPin,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { KpiCards } from "@/components/events/kpi-cards";
import { InventoryTable } from "@/components/events/inventory-table";
import { SoldDealsTable } from "@/components/events/sold-deals-table";
import { EventCharts } from "@/components/events/event-charts";
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
  const [inventoryRes, dealsRes, dailyLogRes] = await Promise.all([
    supabase
      .from("inventory")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false }),
    supabase
      .from("deals")
      .select("*")
      .eq("event_id", eventId)
      .order("closed_at", { ascending: false }),
    supabase
      .from("daily_log")
      .select("*")
      .eq("event_id", eventId)
      .order("log_date", { ascending: true }),
  ]);

  const inventory = inventoryRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const dailyLogs = dailyLogRes.data ?? [];

  // Compute KPIs
  const vehicles = inventory.filter((i) => i.category === "vehicle");
  const totalVehicles = vehicles.length;
  const availableVehicles = vehicles.filter(
    (v) => v.status === "available",
  ).length;
  const soldVehicles = vehicles.filter((v) => v.status === "retired").length;

  const soldDeals = deals.filter((d) => d.stage === "paid");
  const totalRevenue = soldDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const avgSalePrice = soldDeals.length > 0 ? totalRevenue / soldDeals.length : 0;

  const totalCost = vehicles
    .filter((v) => v.status === "retired")
    .reduce((sum, v) => sum + (v.unit_cost ?? 0), 0);
  const grossProfit = totalRevenue - totalCost;

  const statusColor: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    active: "bg-green-100 text-green-800",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-red-100 text-red-800",
  };

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
              {event.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {event.location}
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
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* KPI Cards */}
      <KpiCards
        totalVehicles={totalVehicles}
        availableVehicles={availableVehicles}
        soldVehicles={soldVehicles}
        totalRevenue={totalRevenue}
        avgSalePrice={avgSalePrice}
        grossProfit={grossProfit}
      />

      {/* Inventory Grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <InventoryTable items={inventory} eventId={eventId} />
        </CardContent>
      </Card>

      {/* Sold Deals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Sold Deals</CardTitle>
        </CardHeader>
        <CardContent>
          <SoldDealsTable deals={soldDeals} />
        </CardContent>
      </Card>

      {/* Charts */}
      <EventCharts deals={deals} dailyLogs={dailyLogs} />
    </div>
  );
}
