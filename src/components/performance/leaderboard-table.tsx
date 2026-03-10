"use client";

import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BadgeIcon } from "@/components/gamification/badge-icon";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SalespersonRow {
  rosterId: string;
  name: string;
  role: string;
  deals: number;
  ups: number;
  closePct: number;
  frontGross: number;
  backGross: number;
  totalGross: number;
  avgPvr: number;
}

interface LeaderboardTableProps {
  leaderboard: SalespersonRow[];
  achievementsByRoster: Map<string, { name: string; icon: string }[]>;
  roleBadgeClasses: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LeaderboardTable({
  leaderboard,
  achievementsByRoster,
  roleBadgeClasses,
}: LeaderboardTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leaderboard</CardTitle>
        <CardDescription>
          Salesperson performance ranked by total gross production
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Salesperson</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-center">Deals</TableHead>
              <TableHead className="text-center">Ups</TableHead>
              <TableHead className="text-center">Close %</TableHead>
              <TableHead className="text-right">Front Gross</TableHead>
              <TableHead className="text-right">Back Gross</TableHead>
              <TableHead className="text-right">Total Gross</TableHead>
              <TableHead className="text-right">Avg PVR</TableHead>
              <TableHead className="text-center">Badges</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboard.map((row, idx) => (
              <TableRow key={row.rosterId}>
                <TableCell className="font-bold text-muted-foreground">
                  {idx + 1}
                </TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={
                      roleBadgeClasses[row.role] ?? roleBadgeClasses.sales
                    }
                  >
                    {row.role.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">{row.deals}</TableCell>
                <TableCell className="text-center">{row.ups || "—"}</TableCell>
                <TableCell className="text-center">
                  {row.ups > 0 ? (
                    <span
                      className={`font-medium ${
                        row.closePct >= 30
                          ? "text-green-600 dark:text-green-400"
                          : row.closePct >= 15
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {row.closePct.toFixed(0)}%
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(row.frontGross)}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(row.backGross)}
                </TableCell>
                <TableCell className="text-right font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(row.totalGross)}
                </TableCell>
                <TableCell className="text-right">
                  {row.deals > 0 ? formatCurrency(row.avgPvr) : "\u2014"}
                </TableCell>
                <TableCell className="text-center">
                  {(() => {
                    const badges = achievementsByRoster.get(row.rosterId) ?? [];
                    if (badges.length === 0) return <span className="text-muted-foreground">—</span>;
                    const shown = badges.slice(0, 4);
                    const overflow = badges.length - shown.length;
                    return (
                      <div className="flex items-center justify-center gap-1">
                        {shown.map((b) => (
                          <span key={b.name} title={b.name}>
                            <BadgeIcon name={b.icon} className="h-4 w-4 text-yellow-500" />
                          </span>
                        ))}
                        {overflow > 0 && (
                          <span className="text-xs text-muted-foreground font-medium">
                            +{overflow}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </TableCell>
              </TableRow>
            ))}
            {leaderboard.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="h-24 text-center text-muted-foreground"
                >
                  No salesperson data available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
