"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

interface UserMenuProps {
  email: string;
  name: string;
  avatarUrl: string;
}

export function UserMenu({ email, name, avatarUrl }: UserMenuProps) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : email.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium">{name || email}</p>
        {name && (
          <p className="text-xs text-muted-foreground">{email}</p>
        )}
      </div>
      <Avatar className="h-8 w-8">
        <AvatarImage src={avatarUrl} alt={name || email} />
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
