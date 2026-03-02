"use client";

import { icons } from "lucide-react";
import { cn } from "@/lib/utils";

interface BadgeIconProps {
  name: string; // lucide icon name in kebab-case, e.g. "trending-up"
  className?: string;
  size?: number;
}

/**
 * Dynamically render a lucide-react icon from its string name.
 * Badge definitions store icon names as kebab-case strings in the database.
 */
export function BadgeIcon({ name, className, size = 20 }: BadgeIconProps) {
  // Convert kebab-case to PascalCase for lucide lookup
  const pascalName = name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") as keyof typeof icons;

  const Icon = icons[pascalName] ?? icons.Award;

  return <Icon className={cn(className)} size={size} />;
}
