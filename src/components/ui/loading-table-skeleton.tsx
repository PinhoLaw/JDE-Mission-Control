import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface LoadingTableSkeletonProps {
  /** Number of skeleton rows to render (default: 8) */
  rows?: number;
  /** Number of columns per row (default: 5) */
  columns?: number;
  /** Optional title skeleton width */
  showHeader?: boolean;
}

export function LoadingTableSkeleton({
  rows = 8,
  columns = 5,
  showHeader = true,
}: LoadingTableSkeletonProps) {
  // Vary the cell widths for a more natural look
  const widths = ["w-20", "w-28", "w-24", "w-16", "w-32", "w-20", "w-24"];

  return (
    <Card>
      {showHeader && (
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
      )}
      <CardContent className={showHeader ? "" : "pt-6"}>
        <div className="rounded-md border">
          {/* Header row */}
          <div className="flex items-center gap-4 border-b px-4 py-3 bg-muted/50">
            {Array.from({ length: columns }).map((_, i) => (
              <Skeleton
                key={`h-${i}`}
                className={`h-4 ${widths[i % widths.length]}`}
              />
            ))}
          </div>
          {/* Data rows */}
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <div
              key={rowIdx}
              className="flex items-center gap-4 border-b last:border-b-0 px-4 py-3"
            >
              {Array.from({ length: columns }).map((_, colIdx) => (
                <Skeleton
                  key={`${rowIdx}-${colIdx}`}
                  className={`h-4 ${widths[(colIdx + rowIdx) % widths.length]}`}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
