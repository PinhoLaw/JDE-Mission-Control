"use client";

import { useEvent } from "@/providers/event-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function EventSelector() {
  const { currentEvent, availableEvents, isLoading, setCurrentEvent } =
    useEvent();

  if (isLoading) {
    return <Skeleton className="h-9 w-[240px]" />;
  }

  if (availableEvents.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        No events
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    completed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <Select
      value={currentEvent?.id ?? ""}
      onValueChange={setCurrentEvent}
    >
      <SelectTrigger className="w-[280px] border-none bg-transparent px-2 text-left shadow-none focus:ring-0">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
          <SelectValue placeholder="Select event" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {availableEvents.map((event) => (
          <SelectItem key={event.id} value={event.id}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{event.dealer_name ?? event.name}</span>
              {event.dealer_name && event.name !== event.dealer_name && (
                <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                  {event.name}
                </span>
              )}
              <Badge
                variant="secondary"
                className={`ml-auto text-[10px] px-1.5 py-0 ${statusColors[event.status]}`}
              >
                {event.status}
              </Badge>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
