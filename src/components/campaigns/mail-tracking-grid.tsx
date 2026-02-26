"use client";

import { useMemo } from "react";
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

interface MailEntry {
  id: string;
  zip_code: string | null;
  town: string | null;
  pieces_sent: number | null;
  day_1: number;
  day_2: number;
  day_3: number;
  day_4: number;
  day_5: number;
  day_6: number;
  day_7: number;
  total_responses: number;
  response_rate: number | null;
  sold_from_mail: number;
}

interface MailTrackingGridProps {
  data: MailEntry[];
}

export function MailTrackingGrid({ data }: MailTrackingGridProps) {
  const stats = useMemo(() => {
    const totalPieces = data.reduce((s, d) => s + (d.pieces_sent ?? 0), 0);
    const totalResponses = data.reduce((s, d) => s + d.total_responses, 0);
    const totalSoldFromMail = data.reduce((s, d) => s + (d.sold_from_mail ?? 0), 0);
    const rate = totalPieces > 0 ? (totalResponses / totalPieces) * 100 : 0;
    const topZips = [...data]
      .sort((a, b) => b.total_responses - a.total_responses)
      .slice(0, 5);
    return { totalPieces, totalResponses, totalSoldFromMail, rate, topZips };
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Pieces Sent</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {stats.totalPieces.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Responses</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalResponses}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sold from Mail</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-700">
              {stats.totalSoldFromMail}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Response Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {stats.rate.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Zip Codes</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Performing Zips */}
      <Card>
        <CardHeader>
          <CardTitle>Top Performing Zip Codes</CardTitle>
          <CardDescription>Highest response counts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {stats.topZips.map((z) => (
              <div
                key={z.id}
                className="rounded-lg border p-3 space-y-1 min-w-[140px]"
              >
                <p className="text-sm font-medium">{z.town}</p>
                <p className="text-xs text-muted-foreground">{z.zip_code}</p>
                <p className="text-lg font-bold text-green-700">
                  {z.total_responses} responses
                </p>
                <p className="text-xs text-muted-foreground">
                  {z.pieces_sent?.toLocaleString()} sent •{" "}
                  {z.response_rate != null
                    ? `${(z.response_rate * 100).toFixed(1)}%`
                    : "—"}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Full Table */}
      <Card>
        <CardHeader>
          <CardTitle>Response by Zip Code</CardTitle>
          <CardDescription>Daily breakdown per zip</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zip</TableHead>
                  <TableHead>Town</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-center">Day 1</TableHead>
                  <TableHead className="text-center">Day 2</TableHead>
                  <TableHead className="text-center">Day 3</TableHead>
                  <TableHead className="text-center">Day 4</TableHead>
                  <TableHead className="text-center">Day 5</TableHead>
                  <TableHead className="text-center">Day 6</TableHead>
                  <TableHead className="text-center">Day 7</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">
                      {row.zip_code}
                    </TableCell>
                    <TableCell className="font-medium">{row.town}</TableCell>
                    <TableCell className="text-right">
                      {row.pieces_sent?.toLocaleString()}
                    </TableCell>
                    {[
                      row.day_1,
                      row.day_2,
                      row.day_3,
                      row.day_4,
                      row.day_5,
                      row.day_6,
                      row.day_7,
                    ].map((val, idx) => (
                      <TableCell key={idx} className="text-center">
                        {val > 0 ? (
                          <Badge
                            variant="secondary"
                            className="bg-blue-50 text-blue-700"
                          >
                            {val}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-bold">
                      {row.total_responses}
                    </TableCell>
                    <TableCell className="text-right font-medium text-blue-700">
                      {row.sold_from_mail}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.response_rate != null
                        ? `${(row.response_rate * 100).toFixed(1)}%`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
