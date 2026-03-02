"use client";

import { usePathname } from "next/navigation";
import { useEvent } from "@/providers/event-provider";
import { useMemo } from "react";

export interface ChatContext {
  page: string;
  eventName: string | null;
  eventId: string | null;
}

/** Builds the context payload sent with every chat message */
export function useChatContext(): ChatContext {
  const pathname = usePathname();
  const { currentEvent } = useEvent();

  return useMemo(
    () => ({
      page: pathname ?? "unknown",
      eventName: currentEvent?.name ?? null,
      eventId: currentEvent?.id ?? null,
    }),
    [pathname, currentEvent],
  );
}
