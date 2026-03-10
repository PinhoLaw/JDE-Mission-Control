import {
  Gauge,
  CalendarDays,
  Package,
  Handshake,
  Users,
  Settings,
  BarChart3,
  DollarSign,
  ScrollText,
  Activity,
  ClipboardList,
  Megaphone,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

export const GENERAL_NAV: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: Gauge },
  { name: "Events", href: "/dashboard/events", icon: CalendarDays },
];

export const MODULE_NAV: NavItem[] = [
  { name: "Inventory", href: "/dashboard/inventory", icon: Package },
  { name: "Deal Log", href: "/dashboard/deals", icon: Handshake },
  { name: "Roster", href: "/dashboard/roster", icon: Users },
  { name: "Daily Metrics", href: "/dashboard/daily-metrics", icon: ClipboardList },
  { name: "Campaigns", href: "/dashboard/campaigns", icon: Megaphone },
  { name: "Commissions", href: "/dashboard/commissions", icon: DollarSign },
  { name: "Performance", href: "/dashboard/performance", icon: BarChart3 },
  { name: "Achievements", href: "/dashboard/achievements", icon: Trophy },
  { name: "Audit Log", href: "/dashboard/audit", icon: ScrollText },
  { name: "Monitoring", href: "/dashboard/monitoring", icon: Activity },
];

export const SETTINGS_NAV: NavItem = {
  name: "Settings",
  href: "/dashboard/settings",
  icon: Settings,
};
