"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Target } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailySalesDataPoint {
  date: string;
  deals: number;
  ups: number;
  gross: number;
}

interface DailySalesChartProps {
  data: DailySalesDataPoint[];
  overallConversion: string | null;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function ComboTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const sold = payload.find((p) => p.dataKey === "deals")?.value ?? 0;
  const ups = payload.find((p) => p.dataKey === "ups")?.value ?? 0;
  const convRate = ups > 0 ? ((sold / ups) * 100).toFixed(1) : "—";

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md min-w-[160px]">
      <p className="mb-1.5 font-medium text-popover-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
        <span className="text-muted-foreground">Cars Sold:</span>
        <span className="font-medium text-popover-foreground">{sold}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#93c5fd" }} />
        <span className="text-muted-foreground">Visits:</span>
        <span className="font-medium text-popover-foreground">{ups}</span>
      </div>
      <div className="mt-1.5 border-t pt-1.5 flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Conversion:</span>
        <span className="font-semibold text-popover-foreground text-xs">{convRate}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DailySalesChart({ data, overallConversion }: DailySalesChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily Sales &amp; Traffic</CardTitle>
        <CardDescription>
          Units sold vs customer visits per sale day
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted"
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                allowDecimals={false}
                className="fill-muted-foreground"
                label={{
                  value: "Units Sold",
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                  style: { fontSize: 11, fill: "var(--muted-foreground)" },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                allowDecimals={false}
                className="fill-muted-foreground"
                label={{
                  value: "Visits",
                  angle: 90,
                  position: "insideRight",
                  offset: 10,
                  style: { fontSize: 11, fill: "var(--muted-foreground)" },
                }}
              />
              <Tooltip content={<ComboTooltipContent />} />
              <Legend
                verticalAlign="top"
                height={28}
                iconType="circle"
                wrapperStyle={{ fontSize: 12 }}
              />
              <Bar
                yAxisId="left"
                dataKey="deals"
                name="Cars Sold"
                fill="#3b82f6"
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                barSize={32}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="ups"
                name="Visits"
                stroke="#93c5fd"
                strokeWidth={2}
                dot={{ r: 4, fill: "#93c5fd", stroke: "#93c5fd" }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {overallConversion && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
            <Target className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{overallConversion}%</span> overall conversion rate
              {data.length >= 2 && (() => {
                const half = Math.ceil(data.length / 2);
                const first = data.slice(0, half);
                const second = data.slice(half);
                const firstUps = first.reduce((s, d) => s + d.ups, 0);
                const secondUps = second.reduce((s, d) => s + d.ups, 0);
                const firstSold = first.reduce((s, d) => s + d.deals, 0);
                const secondSold = second.reduce((s, d) => s + d.deals, 0);
                if (firstUps === 0 || secondUps === 0) return null;
                const earlyPct = ((firstSold / firstUps) * 100).toFixed(1);
                const latePct = ((secondSold / secondUps) * 100).toFixed(1);
                return (
                  <span className="ml-1">
                    — Early {earlyPct}% vs Late {latePct}%
                  </span>
                );
              })()}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
