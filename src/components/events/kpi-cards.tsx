import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { Car, CheckCircle2, DollarSign, TrendingUp, Tag, Package } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface KpiCardsProps {
  totalVehicles: number;
  availableVehicles: number;
  soldVehicles: number;
  totalRevenue: number;
  avgSalePrice: number;
  grossProfit: number;
}

export function KpiCards({
  totalVehicles,
  availableVehicles,
  soldVehicles,
  totalRevenue,
  avgSalePrice,
  grossProfit,
}: KpiCardsProps) {
  const kpis = [
    {
      label: "Total Vehicles",
      value: totalVehicles.toString(),
      icon: Car,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Available",
      value: availableVehicles.toString(),
      icon: Package,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Sold",
      value: soldVehicles.toString(),
      icon: CheckCircle2,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      label: "Total Revenue",
      value: formatCurrency(totalRevenue),
      icon: DollarSign,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Avg Sale Price",
      value: formatCurrency(avgSalePrice),
      icon: Tag,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
    {
      label: "Gross Profit",
      value: formatCurrency(grossProfit),
      icon: TrendingUp,
      color: grossProfit >= 0 ? "text-green-600" : "text-red-600",
      bg: grossProfit >= 0 ? "bg-green-50" : "bg-red-50",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
            <p className="text-2xl font-bold">{kpi.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
