// Google Sheets auto-creation — replaces Excel upload flow (March 2026)
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
          <button onClick={() => setMode("manual")} className="text-left">
            <Card className="h-full transition-shadow hover:shadow-md hover:border-primary/50 cursor-pointer border-primary/30">
              <CardHeader>
                <FileSpreadsheet className="h-8 w-8 text-primary mb-2" />
                <CardTitle className="text-lg">Create Event</CardTitle>
                <CardDescription>
                  Set up event details and a Google Sheet will be automatically
                  created from the master template — ready for your team to
                  start entering data immediately.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  A Google Sheet with Deal Log, Inventory, Mail Tracking,
                  Roster &amp; Lenders tabs will be auto-created and linked.
                </p>
              </CardContent>
            </Card>
          </button>

          <button onClick={() => setMode("import")} className="text-left">
            <Card className="h-full transition-shadow hover:shadow-md hover:border-primary/50 cursor-pointer">
              <CardHeader>
                <PenLine className="h-8 w-8 text-muted-foreground mb-2" />
                <CardTitle className="text-lg">Import Existing Spreadsheet</CardTitle>
                <CardDescription>
                  Already have a completed spreadsheet? Upload it to create the
                  event and import all data at once.
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
        </div>
      )}

      {/* ── Standard creation (form + auto Google Sheet) ── */}
      {mode === "manual" && <CreateEventForm />}

      {/* ── Import from existing spreadsheet ── */}
      {mode === "import" && <ImportEventFlow />}
    </div>
  );
}
