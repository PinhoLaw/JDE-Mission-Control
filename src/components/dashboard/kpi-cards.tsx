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
  let kpi: Record<string, unknown> | null = null;
  let config: Record<string, unknown> | null = null;
  let teamSize = 0;

  console.log("[KpiCards] RENDER — eventId:", eventId);

  try {
    const supabase = await createClient();

    // Verify auth first
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    console.log(
      "[KpiCards] AUTH:",
      user ? `${user.email} (${user.id})` : `NO USER: ${authErr?.message}`,
    );

    // Parallel fetches for KPI data
    const [kpiRes, configRes, rosterRes] = await Promise.all([
      supabase
        .from("v_event_kpis")
        .select("*")
        .eq("event_id", eventId)
        .maybeSingle(),
      supabase
        .from("event_config")
        .select("target_units, target_gross, target_pvr")
        .eq("event_id", eventId)
        .maybeSingle(),
      supabase
        .from("roster")
        .select("id")
        .eq("event_id", eventId)
        .eq("active", true),
    ]);

    kpi = kpiRes.data;
    config = configRes.data;
    teamSize = rosterRes.data?.length ?? 0;
  } catch (error) {
    console.error("[KpiCards] CRASH:", error);
    // Render with zero values — better than crashing the page
  }

  // Fallback to zero if view has no data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const k = kpi as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = config as any;
  const totalDeals = k?.total_deals ?? 0;
  const totalGross = k?.total_gross ?? 0;
  const avgFront = k?.avg_front_gross ?? 0;
  const avgBack = k?.avg_back_gross ?? 0;
  const avgPvr = k?.avg_pvr ?? 0;
  const totalVehicles = k?.total_vehicles ?? 0;
  const availableVehicles = k?.available_vehicles ?? 0;
  const mailPieces = k?.mail_pieces_sent ?? 0;
  const mailResponses = k?.mail_total_responses ?? 0;
  const mailPct = k?.mail_response_pct ?? 0;

  const cards = [
    {
      label: "Total Units Sold",
      value: totalDeals.toString(),
      target: c?.target_units ? `/ ${c.target_units}` : "",
      icon: Handshake,
      color: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-950",
    },
    {
      label: "Total Gross",
      value: formatCurrency(totalGross),
      target: c?.target_gross
        ? `/ ${formatCurrency(Number(c.target_gross))}`
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
      target: c?.target_pvr
        ? `/ ${formatCurrency(Number(c.target_pvr))}`
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
