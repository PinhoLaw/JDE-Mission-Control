import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ClipboardList, BarChart3 } from "lucide-react";

interface EventSubNavProps {
  eventId: string;
  current: "overview" | "recap";
}

/**
 * Navigation bar shared between Overview and Recap pages.
 * Shows a back link to Events list + cross-link to the sibling page.
 */
export function EventSubNav({ eventId, current }: EventSubNavProps) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/events">
          <ArrowLeft className="h-4 w-4" />
          {current === "overview" ? "Back to Events" : "Events"}
        </Link>
      </Button>
      {current === "overview" ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/events/${eventId}/recap`}>
            <ClipboardList className="h-4 w-4" />
            Event Recap
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/events/${eventId}/overview`}>
            <BarChart3 className="h-4 w-4" />
            Overview
          </Link>
        </Button>
      )}
    </div>
  );
}
