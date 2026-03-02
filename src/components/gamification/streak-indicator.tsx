"use client";

import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreakIndicatorProps {
  currentStreak: number;
  longestStreak: number;
  className?: string;
}

export function StreakIndicator({
  currentStreak,
  longestStreak,
  className,
}: StreakIndicatorProps) {
  if (currentStreak === 0 && longestStreak === 0) return null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Flame
        className={cn(
          "h-4 w-4",
          currentStreak >= 3
            ? "text-orange-500"
            : currentStreak >= 1
              ? "text-yellow-500"
              : "text-muted-foreground",
        )}
      />
      <span className="text-sm font-bold tabular-nums">{currentStreak}</span>
      {longestStreak > currentStreak && (
        <span className="text-[10px] text-muted-foreground">
          (best: {longestStreak})
        </span>
      )}
    </div>
  );
}
