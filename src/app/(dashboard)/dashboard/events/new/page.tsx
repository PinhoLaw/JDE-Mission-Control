"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateEventForm } from "@/components/events/create-event-form";
import { ArrowLeft, FileSpreadsheet, PenLine } from "lucide-react";
import { ImportEventFlow } from "@/components/events/import-event-flow";

type Mode = "choose" | "manual" | "import";

export default function NewEventPage() {
  const [mode, setMode] = useState<Mode>("choose");

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2"
          {...(mode === "choose"
            ? { asChild: true }
            : { onClick: () => setMode("choose") })}
        >
          {mode === "choose" ? (
            <Link href="/dashboard/events">
              <ArrowLeft className="h-4 w-4" />
              Back to Events
            </Link>
          ) : (
            <>
              <ArrowLeft className="h-4 w-4" />
              Back
            </>
          )}
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">New Event</h1>
        {mode === "choose" && (
          <p className="text-muted-foreground mt-1">
            How would you like to set up your event?
          </p>
        )}
      </div>

      {/* ── Choice screen ── */}
      {mode === "choose" && (
        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
          <button onClick={() => setMode("import")} className="text-left">
            <Card className="h-full transition-shadow hover:shadow-md hover:border-primary/50 cursor-pointer">
              <CardHeader>
                <FileSpreadsheet className="h-8 w-8 text-primary mb-2" />
                <CardTitle className="text-lg">Import Spreadsheet</CardTitle>
                <CardDescription>
                  Upload your JDE event spreadsheet to auto-create the event and
                  import inventory, deals, roster, and campaign data all at once.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Supports .xlsx files with Deal Log, Inventory, Campaign
                  Tracking, and Roster sheets.
                </p>
              </CardContent>
            </Card>
          </button>

          <button onClick={() => setMode("manual")} className="text-left">
            <Card className="h-full transition-shadow hover:shadow-md hover:border-primary/50 cursor-pointer">
              <CardHeader>
                <PenLine className="h-8 w-8 text-primary mb-2" />
                <CardTitle className="text-lg">Create from Scratch</CardTitle>
                <CardDescription>
                  Manually fill in event details — dealer name, dates, location,
                  budget — and add data later.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Best for new events where you don&apos;t have a spreadsheet yet.
                </p>
              </CardContent>
            </Card>
          </button>
        </div>
      )}

      {/* ── Manual creation (existing form) ── */}
      {mode === "manual" && <CreateEventForm />}

      {/* ── Import from spreadsheet ── */}
      {mode === "import" && <ImportEventFlow />}
    </div>
  );
}
