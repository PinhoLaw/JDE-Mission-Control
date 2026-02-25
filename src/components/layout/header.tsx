import { createClient } from "@/lib/supabase/server";
import { UserMenu } from "./user-menu";

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user!.id)
    .single();

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-6">
      <div />
      <UserMenu
        email={user?.email ?? ""}
        name={profile?.full_name ?? ""}
        avatarUrl={profile?.avatar_url ?? ""}
      />
    </header>
  );
}
