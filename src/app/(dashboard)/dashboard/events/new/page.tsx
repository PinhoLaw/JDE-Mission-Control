import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CreateEventForm } from "@/components/events/create-event-form";
import { ArrowLeft } from "lucide-react";

export default function NewEventPage() {
  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href="/dashboard/events">
            <ArrowLeft className="h-4 w-4" />
            Back to Events
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">New Event</h1>
      </div>
      <CreateEventForm />
    </div>
  );
}
