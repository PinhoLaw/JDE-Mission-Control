import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "./user-menu";
import { EventSelector } from "@/components/dashboard/event-selector";
import { ThemeToggle } from "./theme-toggle";
import { MobileSidebarDrawer } from "./mobile-sidebar-drawer";

export async function Header() {
  let user: { email?: string; id: string } | null = null;
  let profile: { full_name: string | null; avatar_url: string | null } | null =
    null;

  try {
    const supabase = await createClient();
    console.log("[Header] createClient OK, fetching user...");

    const { data, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.error("[Header] auth.getUser error:", authError.message);
    }
    user = data?.user ?? null;
    console.log("[Header] user:", user ? user.email : "null (not authenticated)");

    if (user) {
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .single();

      if (profileError) {
        // profiles table might not exist or user has no profile row — non-fatal
        console.warn("[Header] profiles query error (non-fatal):", profileError.message);
      }
      profile = profileData;
    }
  } catch (error) {
    console.error("[Header] CRASH:", error);
    // Render header anyway with fallback values
  }

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-2">
        <MobileSidebarDrawer />
        <EventSelector />
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu
          email={user?.email ?? "Guest"}
          name={profile?.full_name ?? "Guest User"}
          avatarUrl={profile?.avatar_url ?? ""}
        />
      </div>
    </header>
  );
}
