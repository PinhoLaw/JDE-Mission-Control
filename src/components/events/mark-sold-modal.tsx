"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { markAsSold } from "@/app/(dashboard)/dashboard/events/[eventId]/actions";
import type { Database } from "@/types/database";

type InventoryItem = Database["public"]["Tables"]["inventory"]["Row"];

interface MarkSoldModalProps {
  item: InventoryItem;
  eventId: string;
  open: boolean;
  onClose: () => void;
}

export function MarkSoldModal({
  item,
  eventId,
  open,
  onClose,
}: MarkSoldModalProps) {
  const [isPending, startTransition] = useTransition();
  const [salePrice, setSalePrice] = useState(
    item.unit_cost?.toString() ?? "",
  );
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [notes, setNotes] = useState("");

  const cost = item.unit_cost ?? 0;
  const price = parseFloat(salePrice) || 0;
  const profit = price - cost;
  const margin = price > 0 ? (profit / price) * 100 : 0;

  function handleSubmit() {
    const fd = new FormData();
    fd.set("event_id", eventId);
    fd.set("inventory_id", item.id);
    fd.set("vehicle_name", item.name);
    fd.set("sale_price", salePrice);
    fd.set("buyer_name", buyerName);
    fd.set("buyer_email", buyerEmail);
    fd.set("notes", notes);

    startTransition(async () => {
      await markAsSold(fd);
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Sold</DialogTitle>
          <DialogDescription>{item.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Pricing Engine */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <h4 className="text-sm font-semibold">Pricing</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Unit Cost
                </Label>
                <p className="text-sm font-medium">{formatCurrency(cost)}</p>
              </div>
              <div>
                <Label htmlFor="sale_price" className="text-xs">
                  Sale Price
                </Label>
                <Input
                  id="sale_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div>
                <Label className="text-xs text-muted-foreground">Profit</Label>
                <p
                  className={`text-sm font-bold ${profit >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {formatCurrency(profit)}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Margin</Label>
                <p
                  className={`text-sm font-bold ${margin >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {margin.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          {/* Buyer Info */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="buyer_name" className="text-xs">
                Buyer Name
              </Label>
              <Input
                id="buyer_name"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label htmlFor="buyer_email" className="text-xs">
                Buyer Email
              </Label>
              <Input
                id="buyer_email"
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label htmlFor="sale_notes" className="text-xs">
                Notes
              </Label>
              <Input
                id="sale_notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about the sale"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !salePrice}
            className="bg-green-600 hover:bg-green-700"
          >
            {isPending ? "Saving..." : "Confirm Sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
