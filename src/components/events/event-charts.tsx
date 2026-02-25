"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Database } from "@/types/database";

type Deal = Database["public"]["Tables"]["deals"]["Row"];
type DailyLog = Database["public"]["Tables"]["daily_log"]["Row"];

interface EventChartsProps {
  deals: Deal[];
  dailyLogs: DailyLog[];
}

export function EventCharts({ deals, dailyLogs }: EventChartsProps) {
  // Build sales activity data (deals per day)
  const salesByDay = deals
    .filter((d) => d.closed_at)
    .reduce(
      (acc, deal) => {
        const day = new Date(deal.closed_at!).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        if (!acc[day]) acc[day] = { date: day, sales: 0, revenue: 0 };
        acc[day].sales += 1;
        acc[day].revenue += deal.value ?? 0;
        return acc;
      },
      {} as Record<string, { date: string; sales: number; revenue: number }>,
    );

  const activityData = Object.values(salesByDay).slice(-14);

  // Build gross profit by day from daily logs
  const profitData = dailyLogs
    .sort(
      (a, b) =>
        new Date(a.log_date).getTime() - new Date(b.log_date).getTime(),
    )
    .map((log) => ({
      date: new Date(log.log_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      revenue: log.revenue ?? 0,
      expenses: log.expenses ?? 0,
      profit: (log.revenue ?? 0) - (log.expenses ?? 0),
    }));

  const hasActivity = activityData.length > 0;
  const hasProfit = profitData.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Sales Activity Line Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sales Activity</CardTitle>
          <CardDescription>Vehicles sold per day</CardDescription>
        </CardHeader>
        <CardContent>
          {hasActivity ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={activityData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  className="text-xs"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="sales"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  name="Vehicles Sold"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
              No sales activity yet
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gross Profit Bar Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Gross Profit by Day</CardTitle>
          <CardDescription>Revenue minus expenses from daily logs</CardDescription>
        </CardHeader>
        <CardContent>
          {hasProfit ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={profitData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  className="text-xs"
                  tick={{ fontSize: 11 }}
                />
                <YAxis className="text-xs" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) =>
                    new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                    }).format(value)
                  }
                />
                <Bar
                  dataKey="revenue"
                  fill="hsl(142, 71%, 45%)"
                  radius={[4, 4, 0, 0]}
                  name="Revenue"
                />
                <Bar
                  dataKey="profit"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                  name="Profit"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
              No daily log data yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
