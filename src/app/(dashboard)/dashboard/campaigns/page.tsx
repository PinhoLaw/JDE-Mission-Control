import { createClient } from "@/lib/supabase/server";
import { MailTrackingGrid } from "@/components/campaigns/mail-tracking-grid";

export default async function CampaignsPage() {
  const supabase = await createClient();

  const { data: mail } = await supabase
    .from("mail_tracking")
    .select("*")
    .order("pieces_sent", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Mail Campaigns
        </h1>
        <p className="text-muted-foreground">
          Direct mail response tracking by zip code and day
        </p>
      </div>
      <MailTrackingGrid data={mail ?? []} />
    </div>
  );
}
