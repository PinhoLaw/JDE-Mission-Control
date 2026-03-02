import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Handshake,
  DollarSign,
  Target,
  Package,
  MapPin,
  CalendarDays,
  Percent,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const statusColors: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export async function EventScoreCards() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // 1. Get user's event memberships
  const { data: memberships } = await supabase
    .from("event_members")
    .select("event_id")
    .eq("user_id", user.id);

  const eventIds = memberships?.map((m) => m.event_id) ?? [];
  if (eventIds.length === 0) return null;

  // 2. Fetch events + KPIs + ups data in parallel
  const [eventsRes, kpisRes, upsRes] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .in("id", eventIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("v_event_kpis")
      .select("*")
      .in("event_id", eventIds),
    supabase
      .from("sales_deals")
      .select("event_id, ups_count")
      .in("event_id", eventIds)
      .not("status", "eq", "cancelled"),
  ]);

  const events = eventsRes.data ?? [];
  const kpis = kpisRes.data ?? [];
  const upsData = upsRes.data ?? [];

  // 3. Build a KPI lookup by event_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kpiMap = new Map<string, any>();
  for (const k of kpis) {
    kpiMap.set(k.event_id as string, k);
  }

  // 4. Build ups-per-event lookup
  const upsMap = new Map<string, number>();
  for (const d of upsData) {
    const eid = d.event_id as string;
    upsMap.set(eid, (upsMap.get(eid) ?? 0) + ((d.ups_count as number) ?? 1));
  }

  if (events.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Your Sales</h2>
        <span className="text-xs text-muted-foreground">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => {
          const k = kpiMap.get(event.id);
          const totalDeals = (k?.total_deals as number) ?? 0;
          const fundedDeals = (k?.funded_deals as number) ?? 0;
          const totalGross = (k?.total_gross as number) ?? 0;
          const avgPvr = (k?.avg_pvr as number) ?? 0;
          const totalVehicles = (k?.total_vehicles as number) ?? 0;
          const availableVehicles = (k?.available_vehicles as number) ?? 0;
          const totalUps = upsMap.get(event.id) ?? 0;
          const closingRatio = totalUps > 0 ? ((totalDeals / totalUps) * 100).toFixed(0) : "—";

          const location = [event.city, event.state]
            .filter(Boolean)
            .join(", ");

          const dateRange = event.start_date
            ? event.end_date
              ? `${new Date(event.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(event.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : new Date(event.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : null;

          return (
            <Link
              key={event.id}
              href={`/dashboard/events/${event.id}`}
              className="block"
            >
              <Card className="transition-all hover:shadow-md hover:border-primary/40 cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-base truncate">
                        {event.dealer_name ?? event.name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                        {location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {location}
                          </span>
                        )}
                        {dateRange && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {dateRange}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`shrink-0 text-[10px] ${statusColors[event.status] ?? ""}`}
                    >
                      {event.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Units Sold */}
                    <div className="flex items-center gap-2">
                      <div className="rounded-md p-1.5 bg-blue-50 dark:bg-blue-950">
                        <Handshake className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-lg font-bold leading-tight">{totalDeals}</p>
                        <p className="text-[10px] text-muted-foreground">
                          units · {fundedDeals} funded
                        </p>
                      </div>
                    </div>

                    {/* Total Gross */}
                    <div className="flex items-center gap-2">
                      <div className="rounded-md p-1.5 bg-green-50 dark:bg-green-950">
                        <DollarSign className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <p className="text-lg font-bold leading-tight">
                          {formatCurrency(totalGross)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">total gross</p>
                      </div>
                    </div>

                    {/* Avg PVR */}
                    <div className="flex items-center gap-2">
                      <div className="rounded-md p-1.5 bg-indigo-50 dark:bg-indigo-950">
                        <Target className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div>
                        <p className="text-lg font-bold leading-tight">
                          {formatCurrency(avgPvr)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">avg PVR</p>
                      </div>
                    </div>

                    {/* Closing Ratio */}
                    <div className="flex items-center gap-2">
                      <div className="rounded-md p-1.5 bg-teal-50 dark:bg-teal-950">
                        <Percent className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                      </div>
                      <div>
                        <p className="text-lg font-bold leading-tight">
                          {closingRatio}{closingRatio !== "—" ? "%" : ""}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          close rate · {totalUps} ups
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
