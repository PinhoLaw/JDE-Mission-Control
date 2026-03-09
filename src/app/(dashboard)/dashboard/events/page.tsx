import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Plus, FileSpreadsheet, ExternalLink } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { CreateFromTemplateDialog } from "@/components/events/create-from-template-dialog";

export default async function EventsPage() {
  const supabase = await createClient();

  const { data: eventsRaw } = await supabase
    .from("events")
    .select("*");

  // Sort by most recent event date: end_date desc, falling back to start_date
  const events = (eventsRaw ?? []).sort((a, b) => {
    const dateA = a.end_date || a.start_date || "";
    const dateB = b.end_date || b.start_date || "";
    return dateB.localeCompare(dateA);
  });

  const statusColor: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    active: "bg-green-100 text-green-800",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            Manage all your events in one place
          </p>
        </div>
        <div className="flex gap-2">
          <CreateFromTemplateDialog />
          <Button asChild>
            <Link href="/dashboard/events/new">
              <Plus className="h-4 w-4" />
              New Event
            </Link>
          </Button>
        </div>
      </div>

      {!events || events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold">No events yet</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Create your first event to get started.
            </p>
            <Button asChild>
              <Link href="/dashboard/events/new">
                <Plus className="h-4 w-4" />
                Create Event
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <Link key={event.id} href={`/dashboard/events/${event.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{event.name}</CardTitle>
                    <Badge
                      variant="secondary"
                      className={statusColor[event.status]}
                    >
                      {event.status}
                    </Badge>
                  </div>
                  {(event.dealer_name || event.address) && (
                    <CardDescription className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {event.dealer_name ?? event.address}
                      {event.city && `, ${event.city}`}
                      {event.state && `, ${event.state}`}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      {event.start_date
                        ? new Date(event.start_date + "T12:00:00").toLocaleDateString()
                        : "No date set"}
                    </span>
                    <div className="flex items-center gap-2">
                      {/* Google Sheets auto-creation — replaces Excel upload flow (March 2026) */}
                      {(event.sheet_url || event.sheet_id) && (
                        <a
                          href={
                            event.sheet_url ||
                            `https://docs.google.com/spreadsheets/d/${event.sheet_id}/edit`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          title="Open Google Sheet"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {event.budget != null && (
                        <span className="font-medium text-foreground">
                          {formatCurrency(event.budget)}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
