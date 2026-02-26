import { createClient } from "@/lib/supabase/server";
import { RosterGrid } from "@/components/roster/roster-grid";

export default async function RosterPage() {
  const supabase = await createClient();

  const [rosterRes, lendersRes, configRes, eventRes] = await Promise.all([
    supabase.from("roster").select("*").order("name"),
    supabase.from("lenders").select("*").order("name"),
    supabase.from("event_config").select("*").limit(1).single(),
    supabase.from("events").select("*").limit(1).single(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Roster & Config</h1>
        <p className="text-muted-foreground">
          Sales team, lenders, and event configuration
        </p>
      </div>
      <RosterGrid
        roster={rosterRes.data ?? []}
        lenders={lendersRes.data ?? []}
        config={configRes.data}
        event={eventRes.data}
      />
    </div>
  );
}
