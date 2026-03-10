import { Activity, MapPin } from "lucide-react";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZipBreakdownEntry {
  zip: string;
  town: string | null;
  ups: number;
  piecesSent: number;
  sold: number;
  responseRate: string;
}

export interface TrafficSummaryData {
  totalUps: number;
  totalSold: number;
  saleDays: number;
  closeRate: string | null;
  upsPerDay: string | null;
  zipBreakdown: ZipBreakdownEntry[];
  totalMailUps: number;
}

interface TrafficSummaryCardProps {
  trafficSummary: TrafficSummaryData;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TrafficSummaryCard({ trafficSummary }: TrafficSummaryCardProps) {
  if (trafficSummary.totalUps <= 0) return null;

  return (
    <>
      <div className="flex items-center gap-3 pt-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-tight">Traffic &amp; Campaigns</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-blue-500" />
            Traffic Summary
          </CardTitle>
          <CardDescription>
            Event-level ups, conversion, and zone breakdown
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* KPI row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Total Ups</p>
              <p className="text-2xl font-bold tabular-nums">{trafficSummary.totalUps.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Total Sold</p>
              <p className="text-2xl font-bold tabular-nums">{trafficSummary.totalSold.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Close Rate</p>
              <p className="text-2xl font-bold tabular-nums">
                {trafficSummary.closeRate ?? "N/A"}
                {trafficSummary.closeRate && <span className="text-sm font-normal text-muted-foreground">%</span>}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">Ups / Sale Day</p>
              <p className="text-2xl font-bold tabular-nums">{trafficSummary.upsPerDay ?? "N/A"}</p>
              <p className="text-[11px] text-muted-foreground">{trafficSummary.saleDays} sale day{trafficSummary.saleDays !== 1 ? "s" : ""}</p>
            </div>
          </div>

          {/* Zip / Mail Zone breakdown — collapsed by default */}
          {trafficSummary.zipBreakdown.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold select-none [&::-webkit-details-marker]:hidden">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                Ups by Zip / Mail Zone
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  ({trafficSummary.zipBreakdown.length} zones)
                </span>
                <svg className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 ml-auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </summary>
              <div className="overflow-x-auto mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zip</TableHead>
                      <TableHead>Town</TableHead>
                      <TableHead className="text-right">Pieces Sent</TableHead>
                      <TableHead className="text-right">Ups</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Response Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trafficSummary.zipBreakdown.map((z) => (
                      <TableRow key={z.zip}>
                        <TableCell className="font-mono text-sm">{z.zip}</TableCell>
                        <TableCell className="text-muted-foreground">{z.town || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{z.piecesSent.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{z.ups.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{z.sold}</TableCell>
                        <TableCell className="text-right tabular-nums">{z.responseRate}</TableCell>
                      </TableRow>
                    ))}
                    {/* Totals row */}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell colSpan={2}>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {trafficSummary.zipBreakdown.reduce((s, z) => s + z.piecesSent, 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {trafficSummary.totalMailUps.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {trafficSummary.zipBreakdown.reduce((s, z) => s + z.sold, 0)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </details>
          )}
        </CardContent>
      </Card>
    </>
  );
}
