import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  DollarSign,
  TrendingUp,
  Target,
  Package,
  Mail,
  Users,
  Handshake,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

interface KpiCardsProps {
  eventId: string;
}

export async function KpiCards({ eventId }: KpiCardsProps) {
  const supabase = await createClient();

  // Parallel fetches for KPI data
  const [kpiRes, configRes, rosterRes] = await Promise.all([
    supabase
      .from("v_event_kpis")
      .select("*")
      .eq("event_id", eventId)
      .single(),
    supabase
      .from("event_config")
      .select("target_units, target_gross, target_pvr")
      .eq("event_id", eventId)
      .single(),
    supabase
      .from("roster")
      .select("id")
      .eq("event_id", eventId)
      .eq("active", true),
  ]);

  const kpi = kpiRes.data;
  const config = configRes.data;
  const teamSize = rosterRes.data?.length ?? 0;

  // Fallback to zero if view has no data
  const totalDeals = kpi?.total_deals ?? 0;
  const totalGross = kpi?.total_gross ?? 0;
  const avgFront = kpi?.avg_front_gross ?? 0;
  const avgBack = kpi?.avg_back_gross ?? 0;
  const avgPvr = kpi?.avg_pvr ?? 0;
  const totalVehicles = kpi?.total_vehicles ?? 0;
  const availableVehicles = kpi?.available_vehicles ?? 0;
  const mailPieces = kpi?.mail_pieces_sent ?? 0;
  const mailResponses = kpi?.mail_total_responses ?? 0;
  const mailPct = kpi?.mail_response_pct ?? 0;

  const cards = [
    {
      label: "Total Units Sold",
      value: totalDeals.toString(),
      target: config?.target_units ? `/ ${config.target_units}` : "",
      icon: Handshake,
      color: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-950",
    },
    {
      label: "Total Gross",
      value: formatCurrency(totalGross),
      target: config?.target_gross
        ? `/ ${formatCurrency(Number(config.target_gross))}`
        : "",
      icon: DollarSign,
      color: "text-green-600",
      bg: "bg-green-50 dark:bg-green-950",
    },
    {
      label: "Avg Front Gross",
      value: formatCurrency(avgFront),
      icon: TrendingUp,
      color: "text-purple-600",
      bg: "bg-purple-50 dark:bg-purple-950",
    },
    {
      label: "Avg Back Gross",
      value: formatCurrency(avgBack),
      icon: TrendingUp,
      color: "text-orange-600",
      bg: "bg-orange-50 dark:bg-orange-950",
    },
    {
      label: "Avg Total PVR",
      value: formatCurrency(avgPvr),
      target: config?.target_pvr
        ? `/ ${formatCurrency(Number(config.target_pvr))}`
        : "",
      icon: Target,
      color: "text-indigo-600",
      bg: "bg-indigo-50 dark:bg-indigo-950",
    },
    {
      label: "Inventory",
      value: `${availableVehicles} avail`,
      target: `/ ${totalVehicles} total`,
      icon: Package,
      color: "text-teal-600",
      bg: "bg-teal-50 dark:bg-teal-950",
    },
    {
      label: "Mail Response",
      value: `${mailPct}%`,
      target: `${mailResponses} of ${mailPieces.toLocaleString()}`,
      icon: Mail,
      color: "text-pink-600",
      bg: "bg-pink-50 dark:bg-pink-950",
    },
    {
      label: "Sales Team",
      value: teamSize.toString(),
      target: "confirmed",
      icon: Users,
      color: "text-amber-600",
      bg: "bg-amber-50 dark:bg-amber-950",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((kpi) => (
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
  );
}
