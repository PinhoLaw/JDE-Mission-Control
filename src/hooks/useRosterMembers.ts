"use client";

import { useState, useEffect } from "react";
import { useEvent } from "@/providers/event-provider";
import { createClient } from "@/lib/supabase/client";

export interface RosterMember {
  id: string;
  name: string;
  role: string;
  team: string | null;
  commission_pct: number | null;
}

/**
 * Fetches roster members for the current event.
 * Returns sorted list by name, plus loading state.
 */
export function useRosterMembers() {
  const { currentEvent } = useEvent();
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentEvent) {
      setRoster([]);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    supabase
      .from("roster")
      .select("id, name, role, team, commission_pct")
      .eq("event_id", currentEvent.id)
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        setRoster((data as RosterMember[]) ?? []);
        setLoading(false);
      });
  }, [currentEvent]);

  return { roster, loading };
}
