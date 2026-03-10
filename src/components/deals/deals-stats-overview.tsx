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

interface DealsStatsOverviewProps {
  count: number;
  totalGross: number;
  totalFront: number;
  totalBack: number;
  avgPVR: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DealsStatsOverview({
  count,
  totalGross,
  totalFront,
  totalBack,
  avgPVR,
}: DealsStatsOverviewProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-5">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Deals</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{count}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Gross</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-green-700">
            {formatCurrency(totalGross)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Front Gross</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(totalFront)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Back Gross</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-blue-700">
            {formatCurrency(totalBack)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Avg PVR</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(avgPVR)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
