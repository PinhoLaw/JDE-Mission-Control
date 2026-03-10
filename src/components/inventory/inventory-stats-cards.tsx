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

interface InventoryStatsCardsProps {
  total: number;
  available: number;
  sold: number;
  avgCost: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InventoryStatsCards({
  total,
  available,
  sold,
  avgCost,
}: InventoryStatsCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Vehicles</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{total}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Available</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-green-700 dark:text-green-400">{available}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Sold</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{sold}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Avg Cost</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(avgCost)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
