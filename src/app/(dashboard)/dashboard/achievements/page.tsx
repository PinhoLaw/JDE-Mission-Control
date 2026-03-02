"use client";

import { useEffect, useState, useMemo } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";
import type {
  BadgeDef,
  UserAchievement,
  Streak,
  RosterMember,
} from "@/types/database";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BadgeCard } from "@/components/gamification/badge-card";
import { BadgeIcon } from "@/components/gamification/badge-icon";
import { StreakIndicator } from "@/components/gamification/streak-indicator";
import { Loader2, Trophy, Star, Flame } from "lucide-react";

// ─── Category display config ──────────────────────────
const CATEGORIES = [
  { key: "sales", label: "Sales", color: "text-blue-700 dark:text-blue-300" },
  { key: "gross", label: "Gross", color: "text-green-700 dark:text-green-300" },
  {
    key: "closing",
    label: "Closing",
    color: "text-purple-700 dark:text-purple-300",
  },
  {
    key: "streak",
    label: "Streak",
    color: "text-orange-700 dark:text-orange-300",
  },
  { key: "team", label: "Team", color: "text-red-700 dark:text-red-300" },
];

const ROLE_BADGE_CLASSES: Record<string, string> = {
  sales: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  team_leader:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  fi_manager:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  closer:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  manager:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// ─── Page Component ───────────────────────────────────
export default function AchievementsPage() {
  const { currentEvent, isLoading: eventLoading } = useEvent();
  const [badges, setBadges] = useState<BadgeDef[]>([]);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Data fetching ────────────────────────────────────
  useEffect(() => {
    if (eventLoading) return;
    if (!currentEvent) {
      setIsLoading(false);
      return;
    }

    async function load() {
      setIsLoading(true);
      const supabase = createClient();

      const [b, a, s, r] = await Promise.all([
        supabase
          .from("badges")
          .select("*")
          .order("category")
          .order("condition_value"),
        supabase
          .from("user_achievements")
          .select("*")
          .eq("event_id", currentEvent!.id),
        supabase
          .from("streaks")
          .select("*")
          .eq("event_id", currentEvent!.id),
        supabase
          .from("roster")
          .select("*")
          .eq("event_id", currentEvent!.id)
          .eq("active", true)
          .order("name"),
      ]);

      setBadges(b.data ?? []);
      setAchievements(a.data ?? []);
      setStreaks(s.data ?? []);
      setRoster(r.data ?? []);
      setIsLoading(false);
    }

    load();
  }, [currentEvent, eventLoading]);

  // ── Derived data ─────────────────────────────────────

  // Map: roster_id → Map<badge_id, earned_at>
  const achievementMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const a of achievements) {
      if (!map.has(a.roster_id)) map.set(a.roster_id, new Map());
      map.get(a.roster_id)!.set(a.badge_id, a.earned_at);
    }
    return map;
  }, [achievements]);

  // Map: roster_id → streak
  const streakMap = useMemo(() => {
    const map = new Map<string, Streak>();
    for (const s of streaks) {
      map.set(s.roster_id, s);
    }
    return map;
  }, [streaks]);

  // Badge points map
  const badgePoints = useMemo(
    () => new Map(badges.map((b) => [b.id, b.points])),
    [badges],
  );

  // Badge name map
  const badgeMap = useMemo(
    () => new Map(badges.map((b) => [b.id, b])),
    [badges],
  );

  // All earned badge IDs for the event (used for "Badges" tab)
  const allEarnedIds = useMemo(
    () => new Set(achievements.map((a) => a.badge_id)),
    [achievements],
  );

  // Per-member stats for team table and leaderboard
  const memberStats = useMemo(() => {
    return roster
      .map((r) => {
        const memberAch = achievementMap.get(r.id);
        let points = 0;
        let badgeCount = 0;
        let recentBadge: BadgeDef | null = null;
        let recentDate = "";

        if (memberAch) {
          for (const [badgeId, earnedAt] of memberAch) {
            points += badgePoints.get(badgeId) ?? 0;
            badgeCount++;
            if (earnedAt > recentDate) {
              recentDate = earnedAt;
              recentBadge = badgeMap.get(badgeId) ?? null;
            }
          }
        }

        const streak = streakMap.get(r.id);

        return {
          id: r.id,
          name: r.name,
          role: r.role,
          points,
          badgeCount,
          recentBadge,
          recentDate,
          currentStreak: streak?.current_streak ?? 0,
          longestStreak: streak?.longest_streak ?? 0,
        };
      })
      .sort((a, b) => b.points - a.points);
  }, [roster, achievementMap, badgePoints, badgeMap, streakMap]);

  // Total points across all members
  const totalEventPoints = memberStats.reduce((s, m) => s + m.points, 0);
  const totalEventBadges = achievements.length;

  // ── Render ───────────────────────────────────────────

  if (!currentEvent && !eventLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Event Selected</h2>
        <p className="text-muted-foreground max-w-md">
          Select an event to view achievements and badges.
        </p>
      </div>
    );
  }

  if (isLoading || eventLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Achievements
        </h1>
        <p className="text-sm text-muted-foreground">
          {currentEvent?.dealer_name ?? currentEvent?.name} — Badges, streaks,
          and points leaderboard
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Trophy className="h-3 w-3" /> Total Badges Earned
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalEventBadges}</p>
            <p className="text-xs text-muted-foreground">
              of {badges.length * roster.length} possible
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Star className="h-3 w-3" /> Total Points
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700">
              {totalEventPoints.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Flame className="h-3 w-3" /> Active Streaks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600">
              {streaks.filter((s) => s.current_streak > 0).length}
            </p>
            <p className="text-xs text-muted-foreground">
              of {roster.length} members
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unique Badges Unlocked</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-700">
              {allEarnedIds.size}
            </p>
            <p className="text-xs text-muted-foreground">
              of {badges.length} badges
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="badges" className="space-y-4">
        <TabsList>
          <TabsTrigger value="badges">Badges</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="leaderboard">Points Leaderboard</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Badges ────────────────────────────── */}
        <TabsContent value="badges" className="space-y-6">
          {CATEGORIES.map((cat) => {
            const catBadges = badges.filter((b) => b.category === cat.key);
            if (catBadges.length === 0) return null;

            return (
              <div key={cat.key}>
                <h3
                  className={`text-sm font-semibold uppercase tracking-wider mb-3 ${cat.color}`}
                >
                  {cat.label}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {catBadges.map((badge) => (
                    <BadgeCard
                      key={badge.id}
                      name={badge.name}
                      description={badge.description}
                      icon={badge.icon}
                      category={badge.category}
                      points={badge.points}
                      earned={allEarnedIds.has(badge.id)}
                      earnedAt={
                        achievements.find((a) => a.badge_id === badge.id)
                          ?.earned_at
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {badges.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No badges configured yet. Run the badge seed migration to get
                started.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: Team ──────────────────────────────── */}
        <TabsContent value="team">
          <Card>
            <CardHeader>
              <CardTitle>Team Achievements</CardTitle>
              <CardDescription>
                Badge and streak stats for each team member
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-center">Badges</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-center">Streak</TableHead>
                    <TableHead>Recent Badge</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberStats.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            ROLE_BADGE_CLASSES[m.role] ??
                            ROLE_BADGE_CLASSES.sales
                          }
                        >
                          {m.role.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {m.badgeCount}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {m.points}
                      </TableCell>
                      <TableCell className="text-center">
                        <StreakIndicator
                          currentStreak={m.currentStreak}
                          longestStreak={m.longestStreak}
                        />
                      </TableCell>
                      <TableCell>
                        {m.recentBadge ? (
                          <div className="flex items-center gap-1.5">
                            <BadgeIcon
                              name={m.recentBadge.icon}
                              size={14}
                              className="text-muted-foreground"
                            />
                            <span className="text-sm">
                              {m.recentBadge.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {memberStats.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No team members found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Points Leaderboard ────────────────── */}
        <TabsContent value="leaderboard">
          <Card>
            <CardHeader>
              <CardTitle>Points Leaderboard</CardTitle>
              <CardDescription>
                Ranked by total badge points earned this event
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-center">Badges</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-center">Streak</TableHead>
                    <TableHead>Recent Badge</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberStats.map((m, idx) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-bold text-muted-foreground">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center gap-1">
                          <Trophy className="h-3 w-3 text-yellow-500" />
                          {m.badgeCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold text-green-700 dark:text-green-400">
                          {m.points}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <StreakIndicator
                          currentStreak={m.currentStreak}
                          longestStreak={m.longestStreak}
                        />
                      </TableCell>
                      <TableCell>
                        {m.recentBadge ? (
                          <div className="flex items-center gap-1.5">
                            <BadgeIcon
                              name={m.recentBadge.icon}
                              size={14}
                              className="text-muted-foreground"
                            />
                            <span className="text-sm">
                              {m.recentBadge.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {memberStats.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No team members found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
