"use client";

import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PodiumEntry {
  name: string;
  totalGross: number;
  deals: number;
  avgPvr: number;
}

interface GrossPodiumProps {
  entries: PodiumEntry[];
}

// ---------------------------------------------------------------------------
// Shimmer keyframes (injected once via style tag)
// ---------------------------------------------------------------------------

const SHIMMER_STYLE_ID = "podium-shimmer-style";

function ensureShimmerStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(SHIMMER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SHIMMER_STYLE_ID;
  style.textContent = `
    @keyframes gold-shimmer {
      0% { box-shadow: 0 0 15px 2px rgba(245,158,11,0.4), 0 8px 30px -4px rgba(245,158,11,0.25); }
      50% { box-shadow: 0 0 25px 6px rgba(245,158,11,0.6), 0 8px 30px -4px rgba(245,158,11,0.4); }
      100% { box-shadow: 0 0 15px 2px rgba(245,158,11,0.4), 0 8px 30px -4px rgba(245,158,11,0.25); }
    }
    @keyframes gold-border-pulse {
      0% { border-color: rgba(251,191,36,0.6); }
      50% { border-color: rgba(251,191,36,1); }
      100% { border-color: rgba(251,191,36,0.6); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Podium card configs
// ---------------------------------------------------------------------------

const PLACE_CONFIG = [
  {
    // 1st — Gold
    emoji: "👑",
    medal: "🥇",
    badge: "🔥 Leading the Board",
    gradient: "from-amber-400 via-yellow-500 to-amber-600",
    borderClass: "border-2 border-yellow-400",
    textColor: "text-yellow-950",
    subTextColor: "text-yellow-900/70",
    badgeBg: "bg-yellow-900/20 text-yellow-950",
    scale: "scale-100 lg:scale-[1.08]",
    animClass: "gold-shimmer-card",
    shadow: "shadow-2xl",
    minH: "min-h-[260px]",
    nameSize: "text-xl",
    grossSize: "text-3xl",
    dealSize: "text-sm",
    showTrophy: true,
    order: "sm:order-2",    // center on desktop
    mobileOrder: "order-1",
    selfAlign: "self-end lg:self-center",
  },
  {
    // 2nd — Silver
    emoji: "🥈",
    medal: "🥈",
    badge: "⚡ Chasing #1",
    gradient: "from-gray-300 via-slate-400 to-gray-500",
    borderClass: "border border-gray-400/60",
    textColor: "text-gray-900",
    subTextColor: "text-gray-700/70",
    badgeBg: "bg-gray-900/10 text-gray-900",
    scale: "scale-100 lg:scale-[1.03]",
    animClass: "",
    shadow: "shadow-xl",
    minH: "min-h-[220px]",
    nameSize: "text-lg",
    grossSize: "text-2xl",
    dealSize: "text-sm",
    showTrophy: false,
    order: "sm:order-1",    // left on desktop
    mobileOrder: "order-2",
    selfAlign: "self-end",
  },
  {
    // 3rd — Bronze
    emoji: "🥉",
    medal: "🥉",
    badge: "💪 On the Board",
    gradient: "from-orange-700 via-amber-700 to-yellow-900",
    borderClass: "border border-orange-800/50",
    textColor: "text-orange-50",
    subTextColor: "text-orange-200/70",
    badgeBg: "bg-orange-950/20 text-orange-100",
    scale: "scale-100 lg:scale-[1.01]",
    animClass: "",
    shadow: "shadow-lg",
    minH: "min-h-[200px]",
    nameSize: "text-lg",
    grossSize: "text-2xl",
    dealSize: "text-sm",
    showTrophy: false,
    order: "sm:order-3",    // right on desktop
    mobileOrder: "order-3",
    selfAlign: "self-end",
  },
] as const;

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 120, damping: 14 },
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GrossPodium({ entries }: GrossPodiumProps) {
  ensureShimmerStyles();

  if (entries.length === 0) return null;

  // We only podium up to 3
  const top3 = entries.slice(0, 3);

  return (
    <motion.div
      className="flex flex-col sm:flex-row items-end justify-center gap-4 sm:gap-5 lg:gap-6 py-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {top3.map((entry, idx) => {
        const cfg = PLACE_CONFIG[idx];
        return (
          <motion.div
            key={entry.name}
            variants={cardVariants}
            className={`
              relative w-full sm:w-1/3 sm:max-w-[280px]
              ${cfg.mobileOrder} ${cfg.order}
              ${cfg.selfAlign}
            `}
          >
            <div
              className={`
                relative rounded-2xl ${cfg.borderClass} bg-gradient-to-br ${cfg.gradient}
                ${cfg.shadow} ${cfg.scale} ${cfg.minH}
                flex flex-col items-center justify-center gap-2 px-5 py-6
                transition-transform duration-300 hover:scale-[1.04]
              `}
              style={
                idx === 0
                  ? { animation: "gold-shimmer 3s ease-in-out infinite, gold-border-pulse 3s ease-in-out infinite" }
                  : undefined
              }
            >
              {/* Medal / Crown */}
              <div className="flex flex-col items-center gap-0.5">
                {idx === 0 && (
                  <span className="text-3xl leading-none">{cfg.emoji}</span>
                )}
                <span className="text-4xl leading-none">{cfg.medal}</span>
              </div>

              {/* Trophy for 1st */}
              {cfg.showTrophy && (
                <Trophy className="h-5 w-5 text-yellow-300 drop-shadow" />
              )}

              {/* Name */}
              <p className={`${cfg.nameSize} font-bold ${cfg.textColor} text-center leading-tight mt-1`}>
                {entry.name}
              </p>

              {/* Badge */}
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.badgeBg}`}>
                {cfg.badge}
              </span>

              {/* Gross */}
              <p className={`${cfg.grossSize} font-extrabold ${cfg.textColor} tabular-nums mt-1`}>
                {formatCurrency(entry.totalGross)}
              </p>

              {/* Deals + PVR */}
              <p className={`${cfg.dealSize} ${cfg.subTextColor} font-medium`}>
                {entry.deals} deal{entry.deals !== 1 ? "s" : ""} &bull; {formatCurrency(entry.avgPvr)} PVR
              </p>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
