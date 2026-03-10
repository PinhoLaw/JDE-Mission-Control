import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopSalesperson {
  name: string;
  deals: number;
  gross: number;
}

export interface TopLender {
  name: string;
  count: number;
}

interface DealsInsightsRowProps {
  topSalespeople: TopSalesperson[];
  newCount: number;
  newAvgPvr: number;
  usedCount: number;
  usedAvgPvr: number;
  warrantyCount: number;
  gapCount: number;
  count: number;
  topLenders: TopLender[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DealsInsightsRow({
  topSalespeople,
  newCount,
  newAvgPvr,
  usedCount,
  usedAvgPvr,
  warrantyCount,
  gapCount,
  count,
  topLenders,
}: DealsInsightsRowProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Top Salespeople</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {topSalespeople.slice(0, 3).map((sp, i) => (
              <div key={sp.name} className="flex justify-between text-sm">
                <span className="truncate">{i + 1}. {sp.name}</span>
                <span className="font-semibold">{sp.deals} deals</span>
              </div>
            ))}
            {topSalespeople.length === 0 && (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>New vs Used</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>New: {newCount}</span>
              <span className="text-muted-foreground">Avg {formatCurrency(newAvgPvr)}</span>
            </div>
            <div className="flex justify-between">
              <span>Used: {usedCount}</span>
              <span className="text-muted-foreground">Avg {formatCurrency(usedAvgPvr)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Warranty Sold</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {warrantyCount}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              / {count} ({count > 0 ? Math.round((warrantyCount / count) * 100) : 0}%)
            </span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>GAP Penetration</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {gapCount}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              / {count} ({count > 0 ? Math.round((gapCount / count) * 100) : 0}%)
            </span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Top Lenders</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {topLenders.slice(0, 3).map((l, i) => (
              <div key={l.name} className="flex justify-between text-sm">
                <span className="truncate">{i + 1}. {l.name}</span>
                <span className="font-semibold">{l.count}</span>
              </div>
            ))}
            {topLenders.length === 0 && (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
