import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DealsFooterStats {
  avgFrontGross: number;
  topLender: string;
  avgRate: number;
  avgReserve: number;
  avgWarranty: number;
  avgAft1: number;
  avgGap: number;
  avgFiTotal: number;
  totalGross: number;
}

interface DealsFooterBarProps {
  footerStats: DealsFooterStats;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DealsFooterBar({ footerStats }: DealsFooterBarProps) {
  return (
    <div className="rounded-md border bg-muted/80 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">
          Averages
        </span>
        <span>
          Front Gross:{" "}
          <span className="font-semibold">{formatCurrency(footerStats.avgFrontGross)}</span>
        </span>
        <span>
          Lender:{" "}
          <span className="font-semibold">{footerStats.topLender}</span>
        </span>
        <span>
          Rate:{" "}
          <span className="font-semibold">{footerStats.avgRate.toFixed(1)}%</span>
        </span>
        <span>
          Reserve:{" "}
          <span className="font-semibold">{formatCurrency(footerStats.avgReserve)}</span>
        </span>
        <span>
          Warranty:{" "}
          <span className="font-semibold">{formatCurrency(footerStats.avgWarranty)}</span>
        </span>
        <span>
          Aft 1:{" "}
          <span className="font-semibold">{formatCurrency(footerStats.avgAft1)}</span>
        </span>
        <span>
          GAP:{" "}
          <span className="font-semibold">{formatCurrency(footerStats.avgGap)}</span>
        </span>
        <span>
          FI Total:{" "}
          <span className="font-semibold text-blue-700 dark:text-blue-400">
            {formatCurrency(footerStats.avgFiTotal)}
          </span>
        </span>
        <span className="border-l pl-5 border-border">
          Total Gross:{" "}
          <span className="font-bold text-green-700 dark:text-green-400">
            {formatCurrency(footerStats.totalGross)}
          </span>
        </span>
      </div>
    </div>
  );
}
