"use client";

import { useActionState } from "react";
import { createEvent } from "@/app/(dashboard)/dashboard/events/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

async function formAction(
  _prevState: string | null,
  formData: FormData,
): Promise<string | null> {
  try {
    await createEvent(formData);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Something went wrong";
  }
}

export function CreateEventForm() {
  const [error, action, isPending] = useActionState(formAction, null);

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Create New Event</CardTitle>
        <CardDescription>
          Set up a new pop-up sale event for a dealership.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-6">
          {/* Event Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Event Name *</Label>
            <Input
              id="name"
              name="name"
              placeholder="Lincoln CDJR Feb/March 2026"
              required
              autoFocus
            />
          </div>

          {/* Dealer Info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dealer_name">Dealer Name</Label>
              <Input
                id="dealer_name"
                name="dealer_name"
                placeholder="Lincoln CDJR"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="franchise">Franchise</Label>
              <Input
                id="franchise"
                name="franchise"
                placeholder="Chrysler/Dodge/Jeep/Ram"
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              name="address"
              placeholder="123 Main St"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" placeholder="Lincoln" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" placeholder="NE" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">Zip</Label>
              <Input id="zip" name="zip" placeholder="68501" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input id="start_date" name="start_date" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input id="end_date" name="end_date" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sale_days">Sale Days</Label>
              <Input
                id="sale_days"
                name="sale_days"
                type="number"
                min="1"
                placeholder="12"
              />
            </div>
          </div>

          {/* Budget & Status */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="budget">Budget ($)</Label>
              <Input
                id="budget"
                name="budget"
                type="number"
                step="0.01"
                min="0"
                placeholder="10000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select name="status" defaultValue="draft">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Any additional details about this event..."
              rows={4}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Event"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
