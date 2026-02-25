import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";

export default async function PerformancePage() {
  const supabase = await createClient();

  const [dealsRes, rosterRes] = await Promise.all([
    supabase.from("deals_v2").select("*"),
    supabase.from("roster").select("*"),
  ]);

  const deals = dealsRes.data ?? [];
  const roster = rosterRes.data ?? [];

  // Compute per-salesperson stats
  const stats: Record<
    string,
    {
      deals: number;
      totalGross: number;
      frontGross: number;
      backGross: number;
      role: string;
    }
  > = {};

  for (const r of roster) {
    stats[r.name] = {
      deals: 0,
      totalGross: 0,
      frontGross: 0,
      backGross: 0,
      role: r.role ?? "sales",
    };
  }

  for (const deal of deals) {
    const sp = deal.salesperson;
    if (!sp) continue;
    if (!stats[sp])
      stats[sp] = {
        deals: 0,
        totalGross: 0,
        frontGross: 0,
        backGross: 0,
        role: "sales",
      };
    stats[sp].deals += 1;
    stats[sp].totalGross += deal.total_gross ?? 0;
    stats[sp].frontGross += deal.front_gross ?? 0;
    stats[sp].backGross += deal.fi_total ?? 0;
  }

  const sorted = Object.entries(stats).sort(
    (a, b) => b[1].totalGross - a[1].totalGross,
  );

  const roleColors: Record<string, string> = {
    sales: "bg-blue-100 text-blue-800",
    team_leader: "bg-purple-100 text-purple-800",
    fi_manager: "bg-green-100 text-green-800",
    closer: "bg-orange-100 text-orange-800",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Performance</h1>
        <p className="text-muted-foreground">
          Salesperson performance breakdown
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
          <CardDescription>Ranked by total gross production</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-center">Deals</TableHead>
                <TableHead className="text-right">Front Gross</TableHead>
                <TableHead className="text-right">Back Gross</TableHead>
                <TableHead className="text-right">Total Gross</TableHead>
                <TableHead className="text-right">Avg PVR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(([name, data], idx) => (
                <TableRow key={name}>
                  <TableCell className="font-bold text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={roleColors[data.role] ?? roleColors.sales}
                    >
                      {data.role.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{data.deals}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(data.frontGross)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(data.backGross)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-green-700">
                    {formatCurrency(data.totalGross)}
                  </TableCell>
                  <TableCell className="text-right">
                    {data.deals > 0
                      ? formatCurrency(data.totalGross / data.deals)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
