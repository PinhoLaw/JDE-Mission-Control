"use client";

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
import { Separator } from "@/components/ui/separator";

interface RosterMember {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  confirmed: boolean | null;
}

interface Lender {
  id: string;
  name: string;
  buy_rate_pct: number | null;
}

interface EventConfig {
  dealer_name: string | null;
  franchise: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sale_days: number | null;
  doc_fee: number | null;
  tax_rate: number | null;
  pack: number | null;
  mail_title: string | null;
  mail_pieces: number | null;
  jde_commission_pct: number | null;
  rep_commission_pct: number | null;
  target_units: number | null;
  target_avg_gross: number | null;
}

interface RosterGridProps {
  roster: RosterMember[];
  lenders: Lender[];
  config: EventConfig | null;
}

const roleColors: Record<string, string> = {
  sales: "bg-blue-100 text-blue-800",
  team_leader: "bg-purple-100 text-purple-800",
  fi_manager: "bg-green-100 text-green-800",
  closer: "bg-orange-100 text-orange-800",
};

export function RosterGrid({ roster, lenders, config }: RosterGridProps) {
  return (
    <div className="space-y-6">
      {/* Event Config */}
      {config && (
        <Card>
          <CardHeader>
            <CardTitle>Event Configuration</CardTitle>
            <CardDescription>
              {config.dealer_name} — {config.franchise}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="font-medium">
                  {config.city}, {config.state} {config.zip}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sale Days</p>
                <p className="font-medium">{config.sale_days}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Doc Fee</p>
                <p className="font-medium">
                  ${config.doc_fee?.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tax Rate</p>
                <p className="font-medium">
                  {((config.tax_rate ?? 0) * 100).toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pack</p>
                <p className="font-medium">${config.pack?.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  JDE Commission
                </p>
                <p className="font-medium">
                  {((config.jde_commission_pct ?? 0) * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Rep Commission
                </p>
                <p className="font-medium">
                  {((config.rep_commission_pct ?? 0) * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Mail Campaign
                </p>
                <p className="font-medium">
                  {config.mail_title} —{" "}
                  {config.mail_pieces?.toLocaleString()} pieces
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Target Units</p>
                <p className="font-medium">{config.target_units}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Target Avg Gross
                </p>
                <p className="font-medium">
                  ${config.target_avg_gross?.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sales Team */}
        <Card>
          <CardHeader>
            <CardTitle>Sales Team ({roster.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.phone ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={roleColors[r.role] ?? roleColors.sales}
                      >
                        {r.role.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.confirmed ? (
                        <Badge className="bg-green-100 text-green-800">
                          Confirmed
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Lenders */}
        <Card>
          <CardHeader>
            <CardTitle>Lenders ({lenders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lender</TableHead>
                  <TableHead className="text-right">Buy Rate %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lenders.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="text-right">
                      {l.buy_rate_pct != null
                        ? `${(l.buy_rate_pct * 100).toFixed(2)}%`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
