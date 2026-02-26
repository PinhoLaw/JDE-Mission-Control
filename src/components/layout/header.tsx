import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "./user-menu";
import { EventSelector } from "@/components/dashboard/event-selector";
import { ThemeToggle } from "./theme-toggle";
import { MobileSidebarDrawer } from "./mobile-sidebar-drawer";

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { full_name: string | null; avatar_url: string | null } | null =
    null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .single();
    profile = data;
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
