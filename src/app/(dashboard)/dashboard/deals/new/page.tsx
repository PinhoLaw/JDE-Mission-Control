"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { NewDealForm } from "@/components/deals/new-deal-form";

export default function NewDealPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStock = searchParams.get("stock") ?? undefined;
  const initialVehicleId = searchParams.get("vehicleId") ?? undefined;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/dashboard/deals">
            <ArrowLeft className="h-4 w-4" />
            Back to Deal Log
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          New Sales Deal
        </h1>
        <p className="text-sm text-muted-foreground">
          Log a new deal with auto-calculated front/back gross and F&I
          breakdown
        </p>
      </div>

      <NewDealForm
        initialStockNumber={initialStock}
        initialVehicleId={initialVehicleId}
        onSuccess={() => router.push("/dashboard/deals")}
      />
    </div>
  );
}
