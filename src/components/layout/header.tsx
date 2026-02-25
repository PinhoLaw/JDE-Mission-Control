import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "./user-menu";

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { full_name: string | null; avatar_url: string | null } | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-6">
      <div />
      <UserMenu
        email={user?.email ?? "Guest"}
        name={profile?.full_name ?? "Guest User"}
        avatarUrl={profile?.avatar_url ?? ""}
      />
    </header>
  );
}
