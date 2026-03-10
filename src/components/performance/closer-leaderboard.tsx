"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { GrossPodium } from "@/components/performance/gross-podium";
import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloserEntry {
  name: string;
  totalGross: number;
  deals: number;
  avgPvr: number;
  role: string;
}

interface CloserLeaderboardProps {
  closerLeaderboard: CloserEntry[];
  closerBadgeClasses: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CloserLeaderboard({
  closerLeaderboard,
  closerBadgeClasses,
}: CloserLeaderboardProps) {
  if (closerLeaderboard.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Closes by Closer</CardTitle>
        <CardDescription>
          Ranked by number of deals closed
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Podium: top 3 closers */}
        <GrossPodium entries={closerLeaderboard} />

        {/* 4th place and below */}
        {closerLeaderboard.length > 3 && (
          <div className="mt-4 space-y-3 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
            {closerLeaderboard.slice(3).map((c, idx) => (
              <motion.div
                key={`closer-${c.name}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * idx }}
                className="flex items-center gap-3"
              >
                <span className="w-5 text-xs font-bold text-muted-foreground text-right shrink-0">
                  {idx + 4}
                </span>
                <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 shrink-0 ${closerBadgeClasses[c.role] ?? closerBadgeClasses.sales}`}
                    >
                      {c.role.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="flex items-baseline gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground">
                      {c.deals} close{c.deals !== 1 ? "s" : ""}
                    </span>
                    <span className="text-sm font-bold tabular-nums">
                      {formatCurrency(c.totalGross)}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
