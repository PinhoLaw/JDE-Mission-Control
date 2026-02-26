import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Car,
  DollarSign,
  TrendingUp,
  Users,
  Package,
  Mail,
  Target,
  Handshake,
  Plus,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch all data in parallel
  const [inventoryRes, dealsRes, rosterRes, mailRes, eventRes, configRes] =
    await Promise.all([
      supabase.from("vehicle_inventory").select("*"),
      supabase.from("sales_deals").select("*"),
      supabase.from("roster").select("*"),
      supabase.from("mail_tracking").select("*"),
      supabase.from("events").select("*").limit(1).single(),
      supabase.from("event_config").select("*").limit(1).single(),
    ]);

  const inventory = inventoryRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const roster = rosterRes.data ?? [];
  const mail = mailRes.data ?? [];
  const event = eventRes.data;
  const config = configRes.data;

  // Compute KPIs
  const totalVehicles = inventory.length;
  const availableVehicles = inventory.filter(
    (v) => v.status === "available",
  ).length;
  const soldVehicles = inventory.filter(
    (v) => v.status === "sold",
  ).length;

  const totalDeals = deals.length;
  const totalGross = deals.reduce(
    (sum, d) => sum + (d.total_gross ?? 0),
    0,
  );
  const totalFrontGross = deals.reduce(
    (sum, d) => sum + (d.front_gross ?? 0),
    0,
  );
  const totalBackGross = deals.reduce(
    (sum, d) => sum + (d.back_gross ?? 0),
    0,
  );
  const avgFrontGross =
    totalDeals > 0 ? totalFrontGross / totalDeals : 0;
  const avgBackGross =
    totalDeals > 0 ? totalBackGross / totalDeals : 0;
  const avgTotalGross =
    totalDeals > 0 ? totalGross / totalDeals : 0;

  const totalMailPieces = mail.reduce(
    (sum, m) => sum + (m.pieces_sent ?? 0),
    0,
  );
  const totalResponses = mail.reduce(
    (sum, m) => sum + (m.total_responses ?? 0),
    0,
  );
  const responseRate =
    totalMailPieces > 0
      ? ((totalResponses / totalMailPieces) * 100).toFixed(2)
      : "0";

  const kpis = [
    {
      label: "Total Units Sold",
      value: totalDeals.toString(),
      target: config?.target_units ? `/ ${config.target_units}` : "",
      icon: Handshake,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Total Gross",
      value: formatCurrency(totalGross),
      icon: DollarSign,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Avg Front Gross",
      value: formatCurrency(avgFrontGross),
      icon: TrendingUp,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      label: "Avg Back Gross",
      value: formatCurrency(avgBackGross),
      icon: TrendingUp,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      label: "Avg Total PVR",
      value: formatCurrency(avgTotalGross),
      icon: Target,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
    {
      label: "Inventory",
      value: `${availableVehicles} avail`,
      target: `/ ${totalVehicles} total`,
      icon: Package,
      color: "text-teal-600",
      bg: "bg-teal-50",
    },
    {
      label: "Mail Response",
      value: `${responseRate}%`,
      target: `${totalResponses} of ${totalMailPieces.toLocaleString()}`,
      icon: Mail,
      color: "text-pink-600",
      bg: "bg-pink-50",
    },
    {
      label: "Sales Team",
      value: roster.length.toString(),
      target: "confirmed",
      icon: Users,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
  ];

  // Recent deals
  const recentDeals = deals
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime(),
    )
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {event?.dealer_name ?? "Mission Control"}
          </h1>
          <p className="text-muted-foreground">
            {event?.city}, {event?.state} {event?.zip} •{" "}
            {event?.franchise} •{" "}
            {event?.sale_days} sale days
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/events/new">
            <Plus className="h-4 w-4" />
            New Event
          </Link>
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">
                {kpi.label}
              </CardDescription>
              <div className={`rounded-md p-1.5 ${kpi.bg}`}>
                <kpi.icon className={`h-3.5 w-3.5 ${kpi.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold">{kpi.value}</p>
                {kpi.target && (
                  <span className="text-xs text-muted-foreground">
                    {kpi.target}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Deals */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Deals</CardTitle>
            <CardDescription>Latest sales from the deal log</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/deals">View All</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recentDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Car className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <h3 className="text-lg font-semibold">No deals yet</h3>
              <p className="text-sm text-muted-foreground">
                Deals will appear here as they come in.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentDeals.map((deal) => (
                <div
                  key={deal.id}
                  className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {deal.vehicle_year} {deal.vehicle_make}{" "}
                      {deal.vehicle_model}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {deal.customer_name} • {deal.salesperson} •{" "}
                      {deal.lender}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <div>
                      <p className="font-bold text-green-700">
                        {deal.total_gross != null
                          ? formatCurrency(deal.total_gross)
                          : "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        F: {deal.front_gross != null ? formatCurrency(deal.front_gross) : "—"}{" "}
                        B: {deal.back_gross != null ? formatCurrency(deal.back_gross) : "—"}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-green-100 text-green-800"
                    >
                      {deal.new_used ?? "Used"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
