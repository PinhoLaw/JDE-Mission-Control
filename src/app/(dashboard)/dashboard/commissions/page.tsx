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
import { formatCurrency } from "@/lib/utils";

export default async function CommissionsPage() {
  const supabase = await createClient();

  const { data: deals } = await supabase.from("deals_v2").select("*");

  // Compute commissions from deals (25% of front gross)
  const commByPerson: Record<
    string,
    { deals: number; splits: number; frontGross: number; commission: number }
  > = {};

  for (const deal of deals ?? []) {
    const sp = deal.salesperson;
    if (!sp) continue;
    if (!commByPerson[sp])
      commByPerson[sp] = { deals: 0, splits: 0, frontGross: 0, commission: 0 };

    const front = deal.front_gross ?? 0;
    const pct = deal.salesperson_pct ?? 1;

    if (deal.second_salesperson) {
      commByPerson[sp].splits += 1;
      commByPerson[sp].frontGross += front * pct;
      commByPerson[sp].commission += front * 0.25 * pct;
      // Second salesperson
      const sp2 = deal.second_salesperson;
      if (!commByPerson[sp2])
        commByPerson[sp2] = {
          deals: 0,
          splits: 0,
          frontGross: 0,
          commission: 0,
        };
      const pct2 = deal.second_salesperson_pct ?? 0.5;
      commByPerson[sp2].splits += 1;
      commByPerson[sp2].frontGross += front * pct2;
      commByPerson[sp2].commission += front * 0.25 * pct2;
    } else {
      commByPerson[sp].deals += 1;
      commByPerson[sp].frontGross += front;
      commByPerson[sp].commission += front * 0.25;
    }
  }

  const sorted = Object.entries(commByPerson).sort(
    (a, b) => b[1].commission - a[1].commission,
  );

  const totalComm = sorted.reduce((s, [, v]) => s + v.commission, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Commissions</h1>
        <p className="text-muted-foreground">
          25% front gross commission per salesperson
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Commissions</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {formatCurrency(totalComm)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Reps Paid</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{sorted.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Commission</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {sorted.length > 0
                ? formatCurrency(totalComm / sorted.length)
                : "$0"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commission Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Salesperson</TableHead>
                <TableHead className="text-center">Full Deals</TableHead>
                <TableHead className="text-center">Splits</TableHead>
                <TableHead className="text-right">Front Gross</TableHead>
                <TableHead className="text-right">Commission (25%)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(([name, data]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-center">{data.deals}</TableCell>
                  <TableCell className="text-center">{data.splits}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(data.frontGross)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-green-700">
                    {formatCurrency(data.commission)}
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
