import { createClient } from "@/lib/supabase/server";
import { DealLogGrid } from "@/components/deals/deal-log-grid";

export default async function DealsPage() {
  const supabase = await createClient();

  const { data: deals } = await supabase
    .from("deals_v2")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Deal Log</h1>
        <p className="text-muted-foreground">
          All completed deals with front/back gross and F&I breakdown
        </p>
      </div>
      <DealLogGrid deals={deals ?? []} />
    </div>
  );
}
