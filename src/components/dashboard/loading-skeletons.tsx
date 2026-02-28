import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-32 mb-1" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function RecentDealsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right space-y-1">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function AnalyticsOverviewSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <Skeleton className="h-9 w-9 rounded-md" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-64 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <KpiCardsSkeleton />
      <RecentDealsSkeleton />
    </div>
  );
}
