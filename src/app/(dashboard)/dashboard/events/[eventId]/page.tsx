import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  CalendarDays,
  DollarSign,
  MapPin,
  Package,
  Handshake,
  Megaphone,
  Users,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Database } from "@/types/database";

type Event = Database["public"]["Tables"]["events"]["Row"];

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error || !data) {
    notFound();
  }

  const event: Event = data;

  // Fetch counts for each module
  const [inventory, deals, campaigns, roster] = await Promise.all([
    supabase
      .from("inventory")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId),
    supabase
      .from("roster")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId),
  ]);

  const statusColor: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    active: "bg-green-100 text-green-800",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-red-100 text-red-800",
  };

  const modules = [
    {
      name: "Inventory",
      count: inventory.count ?? 0,
      icon: Package,
      description: "Vehicles, equipment, and swag",
    },
    {
      name: "Deals",
      count: deals.count ?? 0,
      icon: Handshake,
      description: "Sponsorships and partnerships",
    },
    {
      name: "Campaigns",
      count: campaigns.count ?? 0,
      icon: Megaphone,
      description: "Marketing campaigns",
    },
    {
      name: "Roster",
      count: roster.count ?? 0,
      icon: Users,
      description: "Staff and volunteer schedule",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/dashboard/events">
            <ArrowLeft className="h-4 w-4" />
            Back to Events
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                {event.name}
              </h1>
              <Badge
                variant="secondary"
                className={statusColor[event.status]}
              >
                {event.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {event.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {event.location}
                </span>
              )}
              {event.start_date && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {new Date(event.start_date).toLocaleDateString()}
                  {event.end_date &&
                    ` — ${new Date(event.end_date).toLocaleDateString()}`}
                </span>
              )}
              {event.budget != null && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {formatCurrency(event.budget)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Notes */}
      {event.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {event.notes}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Modules Grid */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Event Modules</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((mod) => (
            <Card key={mod.name}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <mod.icon className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{mod.name}</CardTitle>
                </div>
                <CardDescription>{mod.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{mod.count}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
