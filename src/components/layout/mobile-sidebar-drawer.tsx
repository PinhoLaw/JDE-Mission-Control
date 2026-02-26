"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Gauge,
  CalendarDays,
  Package,
  Handshake,
  Megaphone,
  Users,
  Settings,
  BarChart3,
  DollarSign,
  Menu,
} from "lucide-react";
import { useState } from "react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Gauge },
  { name: "Events", href: "/dashboard/events", icon: CalendarDays },
];

const moduleNav = [
  { name: "Inventory", href: "/dashboard/inventory", icon: Package },
  { name: "Deal Log", href: "/dashboard/deals", icon: Handshake },
  { name: "Roster", href: "/dashboard/roster", icon: Users },
  { name: "Campaigns", href: "/dashboard/campaigns", icon: Megaphone },
  { name: "Commissions", href: "/dashboard/commissions", icon: DollarSign },
  { name: "Performance", href: "/dashboard/performance", icon: BarChart3 },
];

export function MobileSidebarDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="px-6 py-4">
          <SheetTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Gauge className="h-4 w-4" />
            </div>
            JDE Mission Control
          </SheetTitle>
        </SheetHeader>

        <Separator />

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
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}

          <Separator className="my-4" />

          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Modules
          </p>
          {moduleNav.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="border-t px-3 py-4">
          <Link
            href="/dashboard/settings"
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/dashboard/settings"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
