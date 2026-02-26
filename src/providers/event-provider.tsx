"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  const [currentEvent, setCurrentEventState] = useState<EventRow | null>(null);
  const [availableEvents, setAvailableEvents] = useState<EventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load available events the user has access to
  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      const supabase = createClient();

      // Get events this user is a member of
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || cancelled) {
        setIsLoading(false);
        return;
      }

      // Fetch event_members for this user, then get the events
      const { data: memberships } = await supabase
        .from("event_members")
        .select("event_id")
        .eq("user_id", user.id);

      if (!memberships || memberships.length === 0 || cancelled) {
        // Fallback: fetch all events (for superadmin or if no members yet)
        const { data: allEvents } = await supabase
          .from("events")
          .select("*")
          .order("created_at", { ascending: false });

        if (!cancelled) {
          const events = allEvents ?? [];
          setAvailableEvents(events);
          resolveCurrentEvent(events);
          setIsLoading(false);
        }
        return;
      }

      const eventIds = memberships.map((m) => m.event_id);
      const { data: events } = await supabase
        .from("events")
        .select("*")
        .in("id", eventIds)
        .order("created_at", { ascending: false });

      if (!cancelled) {
        const eventList = events ?? [];
        setAvailableEvents(eventList);
        resolveCurrentEvent(eventList);
        setIsLoading(false);
      }
    }

    function resolveCurrentEvent(events: EventRow[]) {
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
    }

    loadEvents();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
