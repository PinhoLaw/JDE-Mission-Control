"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Gauge,
  CalendarDays,
  Package,
  Handshake,
  Megaphone,
  ClipboardList,
  Users,
  Settings,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Gauge },
  { name: "Events", href: "/dashboard/events", icon: CalendarDays },
];

const eventModules = [
  { name: "Inventory", icon: Package },
  { name: "Deals", icon: Handshake },
  { name: "Campaigns", icon: Megaphone },
  { name: "Daily Log", icon: ClipboardList },
  { name: "Roster", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  // Detect if we're inside an event detail page
  const eventMatch = pathname.match(
    /^\/dashboard\/events\/([a-f0-9-]+)/,
  );
  const activeEventId = eventMatch ? eventMatch[1] : null;

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Gauge className="h-4 w-4" />
        </div>
        <span className="text-lg font-semibold text-sidebar-foreground">
          JDE Mission Control
        </span>
      </div>

      <Separator />

      {/* Main nav */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          General
        </p>
        {navigation.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}

        <Separator className="my-4" />

        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Event Modules
        </p>
        {activeEventId ? (
          eventModules.map((item) => {
            const href = `/dashboard/events/${activeEventId}`;
            const isActive = pathname === href;
            return (
              <Link
                key={item.name}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })
        ) : (
          eventModules.map((item) => (
            <span
              key={item.name}
              className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/50"
              title="Select an event first"
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </span>
          ))
        )}
      </nav>

      {/* Footer */}
      <div className="border-t px-3 py-4">
        <Link
          href="/dashboard/settings"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/dashboard/settings"
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}
