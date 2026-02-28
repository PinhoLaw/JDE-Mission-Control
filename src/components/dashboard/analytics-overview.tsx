import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarDays, BarChart3, DollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

interface AnalyticsOverviewProps {
  userId: string;
}

export async function AnalyticsOverview({ userId }: AnalyticsOverviewProps) {
  let totalEvents = 0;
  let avgDeals = 0;
  let totalGross = 0;

  try {
    const supabase = await createClient();

    // Get all event IDs the user is a member of
    const { data: memberships } = await supabase
      .from("event_members")
      .select("event_id")
      .eq("user_id", userId);

    const eventIds = memberships?.map((m) => m.event_id) ?? [];
    totalEvents = eventIds.length;

    if (eventIds.length > 0) {
      // Get KPIs across all events
      const { data: kpis } = await supabase
        .from("v_event_kpis")
        .select("total_deals, total_gross")
        .in("event_id", eventIds);

      if (kpis && kpis.length > 0) {
        const sumDeals = kpis.reduce(
          (s, k) => s + ((k.total_deals as number) ?? 0),
          0,
        );
        totalGross = kpis.reduce(
          (s, k) => s + ((k.total_gross as number) ?? 0),
          0,
        );
        avgDeals =
          kpis.length > 0 ? Math.round(sumDeals / kpis.length) : 0;
      }
    }
  } catch (error) {
    console.error("[AnalyticsOverview] error:", error);
    // Render with zeros — better than crashing
  }

  const cards = [
    {
      label: "Your Events",
      value: String(totalEvents),
      description: "Events you're a member of",
      icon: CalendarDays,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950",
    },
    {
      label: "Avg Deals / Event",
      value: String(avgDeals),
      description: "Average across all events",
      icon: BarChart3,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950",
    },
    {
      label: "Total Gross (All Events)",
      value: formatCurrency(totalGross),
      description: "Combined gross across events",
      icon: DollarSign,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-50 dark:bg-green-950",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Analytics Overview</CardTitle>
        <CardDescription>
          Cross-event metrics at a glance
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.label}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <div className={`rounded-md p-2 ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </p>
                <p className="text-xl font-bold">{card.value}</p>
                <p className="text-xs text-muted-foreground">
                  {card.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
