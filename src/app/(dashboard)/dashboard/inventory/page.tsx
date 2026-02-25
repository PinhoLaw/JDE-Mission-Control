import { createClient } from "@/lib/supabase/server";
import { InventoryGrid } from "@/components/inventory/inventory-grid";

export default async function InventoryPage() {
  const supabase = await createClient();

  const { data: inventory } = await supabase
    .from("vehicle_inventory")
    .select("*")
    .order("hat_number", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
        <p className="text-muted-foreground">
          Vehicle inventory with pricing tiers and gross calculations
        </p>
      </div>
      <InventoryGrid items={inventory ?? []} />
    </div>
  );
}
