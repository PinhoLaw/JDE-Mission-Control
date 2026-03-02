"use client";

import { BadgeIcon } from "./badge-icon";
import { cn } from "@/lib/utils";

interface BadgeCardProps {
  name: string;
  description: string | null;
  icon: string;
  category: string;
  points: number;
  earned: boolean;
  earnedAt?: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  sales:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  gross:
    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  closing:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  streak:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  team:
    "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export function BadgeCard({
  name,
  description,
  icon,
  category,
  points,
  earned,
  earnedAt,
}: BadgeCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all",
        earned
          ? "border-primary/30 bg-card shadow-sm"
          : "border-muted bg-muted/30 opacity-50 grayscale",
      )}
    >
      {/* Points badge top-right */}
      <span className="absolute right-2 top-2 text-[10px] font-bold text-muted-foreground">
        {points} pts
      </span>

      {/* Icon */}
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full",
          earned ? (CATEGORY_COLORS[category] ?? "bg-muted") : "bg-muted",
        )}
      >
        <BadgeIcon name={icon} size={24} />
      </div>

      {/* Name */}
      <h4 className="text-sm font-semibold leading-tight">{name}</h4>

      {/* Description */}
      <p className="text-xs text-muted-foreground line-clamp-2">
        {description}
      </p>

      {/* Earned date */}
      {earned && earnedAt && (
        <p className="text-[10px] text-muted-foreground">
          Earned {new Date(earnedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
