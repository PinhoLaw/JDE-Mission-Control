"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addInventoryItem } from "@/app/(dashboard)/dashboard/events/[eventId]/actions";

interface AddInventoryModalProps {
  eventId: string;
  open: boolean;
  onClose: () => void;
}

export function AddInventoryModal({
  eventId,
  open,
  onClose,
}: AddInventoryModalProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("vehicle");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit() {
    const fd = new FormData();
    fd.set("event_id", eventId);
    fd.set("name", name);
    fd.set("category", category);
    fd.set("quantity", quantity);
    fd.set("unit_cost", unitCost);
    fd.set("description", description);

    startTransition(async () => {
      await addInventoryItem(fd);
      setName("");
      setCategory("vehicle");
      setQuantity("1");
      setUnitCost("");
      setDescription("");
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Inventory Item</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="inv_name">Name</Label>
            <Input
              id="inv_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., 2024 Toyota Camry SE"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="inv_category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="inv_category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vehicle">Vehicle</SelectItem>
                  <SelectItem value="equipment">Equipment</SelectItem>
                  <SelectItem value="swag">Swag</SelectItem>
                  <SelectItem value="signage">Signage</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="inv_qty">Quantity</Label>
              <Input
                id="inv_qty"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="inv_cost">Unit Cost ($)</Label>
            <Input
              id="inv_cost"
              type="number"
              step="0.01"
              min="0"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div>
            <Label htmlFor="inv_desc">Description</Label>
            <Input
              id="inv_desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="VIN, color, trim, etc."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !name}>
            {isPending ? "Adding..." : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
