"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type EventRow = Database["public"]["Tables"]["events"]["Row"];

interface EventContextValue {
  currentEvent: EventRow | null;
  availableEvents: EventRow[];
  isLoading: boolean;
  setCurrentEvent: (eventId: string) => void;
}

const EventContext = createContext<EventContextValue>({
  currentEvent: null,
  availableEvents: [],
  isLoading: true,
  setCurrentEvent: () => {},
});

export function useEvent() {
  return useContext(EventContext);
}

const STORAGE_KEY = "jde-current-event-id";

export function EventProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [currentEvent, setCurrentEventState] = useState<EventRow | null>(null);
  const [availableEvents, setAvailableEvents] = useState<EventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Track whether initial load has completed to avoid redundant fetches
  const hasLoadedRef = useRef(false);

  // Resolve which event should be active given a list of events
  const resolveCurrentEvent = useCallback(
    (events: EventRow[]) => {
      if (events.length === 0) return;

      // Priority: 1) URL param  2) localStorage  3) first active event  4) first event
      const urlEventId = searchParams.get("event");
      const storedEventId =
        typeof window !== "undefined"
          ? localStorage.getItem(STORAGE_KEY)
          : null;

      const targetId = urlEventId || storedEventId;

      if (targetId) {
        const found = events.find((e) => e.id === targetId);
        if (found) {
          setCurrentEventState(found);
          if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEY, found.id);
          }
          return;
        }
      }

      // Fallback to first active event, or first event overall
      const active = events.find((e) => e.status === "active");
      const fallback = active || events[0];
      setCurrentEventState(fallback);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, fallback.id);
      }
    },
    [searchParams],
  );

  // Load available events the user has access to
  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      const supabase = createClient();

      // Try getUser first, fall back to getSession for resilience
      let userId: string | null = null;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;

      if (!userId) {
        // Fallback: check session (handles edge cases with stale cookies)
        const {
          data: { session },
        } = await supabase.auth.getSession();
        userId = session?.user?.id ?? null;
      }

      if (!userId || cancelled) {
        setIsLoading(false);
        return;
      }

      // Fetch event_members for this user, then get the events
      const { data: memberships } = await supabase
        .from("event_members")
        .select("event_id")
        .eq("user_id", userId);

      if (!memberships || memberships.length === 0 || cancelled) {
        // Fallback: fetch all events (for superadmin or if no members yet)
        const { data: allEvents } = await supabase
          .from("events")
          .select("*");

        if (!cancelled) {
          // Sort by most recent event date: end_date desc, falling back to start_date
          const events = (allEvents ?? []).sort((a, b) => {
            const dateA = a.end_date || a.start_date || "";
            const dateB = b.end_date || b.start_date || "";
            return dateB.localeCompare(dateA);
          });
          setAvailableEvents(events);
          resolveCurrentEvent(events);
          setIsLoading(false);
          hasLoadedRef.current = true;
        }
        return;
      }

      const eventIds = memberships.map((m) => m.event_id);
      const { data: eventsRaw } = await supabase
        .from("events")
        .select("*")
        .in("id", eventIds);

      if (!cancelled) {
        // Sort by most recent event date: end_date desc, falling back to start_date
        const eventList = (eventsRaw ?? []).sort((a, b) => {
          const dateA = a.end_date || a.start_date || "";
          const dateB = b.end_date || b.start_date || "";
          return dateB.localeCompare(dateA);
        });
        setAvailableEvents(eventList);
        resolveCurrentEvent(eventList);
        setIsLoading(false);
        hasLoadedRef.current = true;
      }
    }

    loadEvents();

    return () => {
      cancelled = true;
    };
  }, [resolveCurrentEvent]);

  // On navigation, re-resolve current event from cached availableEvents.
  // This ensures the context is never stale when navigating between pages.
  useEffect(() => {
    if (!hasLoadedRef.current || availableEvents.length === 0) return;
    // Re-resolve: picks up any ?event= URL param changes on navigation
    resolveCurrentEvent(availableEvents);
  }, [pathname, availableEvents, resolveCurrentEvent]);

  const setCurrentEvent = useCallback(
    (eventId: string) => {
      const found = availableEvents.find((e) => e.id === eventId);
      if (!found) return;
      setCurrentEventState(found);
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, eventId);
      }
      // Update URL with the event param
      const params = new URLSearchParams(searchParams.toString());
      params.set("event", eventId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [availableEvents, router, searchParams],
  );

  return (
    <EventContext.Provider
      value={{ currentEvent, availableEvents, isLoading, setCurrentEvent }}
    >
      {children}
    </EventContext.Provider>
  );
}
