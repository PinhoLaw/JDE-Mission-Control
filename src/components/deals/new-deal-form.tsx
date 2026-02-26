"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEvent } from "@/providers/event-provider";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { createDeal, lookupVehicle } from "@/lib/actions/deals";
import { formatCurrency } from "@/lib/utils";

// Helper: coerce string to number, treat empty string as undefined
const optNum = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
  z.number().optional(),
);

const dealFormSchema = z.object({
  deal_number: optNum,
  sale_day: optNum,
  sale_date: z.string().optional(),
  customer_name: z.string().min(1, "Customer name is required"),
  customer_zip: z.string().optional(),
  customer_phone: z.string().optional(),
  stock_number: z.string().optional(),
  vehicle_year: optNum,
  vehicle_make: z.string().optional(),
  vehicle_model: z.string().optional(),
  vehicle_type: z.string().optional(),
  vehicle_cost: optNum,
  new_used: z.enum(["New", "Used", "Certified"]),
  trade_year: optNum,
  trade_make: z.string().optional(),
  trade_model: z.string().optional(),
  trade_acv: optNum,
  trade_payoff: optNum,
  salesperson: z.string().optional(),
  second_salesperson: z.string().optional(),
  selling_price: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
    z.number().min(0, "Selling price is required"),
  ),
  lender: z.string().optional(),
  rate: optNum,
  finance_type: z.enum(["retail", "lease", "cash"]),
  reserve: optNum,
  warranty: optNum,
  gap: optNum,
  aftermarket_1: optNum,
  aftermarket_2: optNum,
  doc_fee: optNum,
  source: z.string().optional(),
  notes: z.string().optional(),
});

type DealFormValues = z.infer<typeof dealFormSchema>;

interface NewDealFormProps {
  initialStockNumber?: string;
  initialVehicleId?: string;
  onSuccess?: () => void;
}

export function NewDealForm({
  initialStockNumber,
  initialVehicleId,
  onSuccess,
}: NewDealFormProps) {
  const { currentEvent } = useEvent();
  const [vehicleId, setVehicleId] = useState<string | null>(
    initialVehicleId ?? null,
  );
  const [lookingUp, setLookingUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DealFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(dealFormSchema) as any,
    defaultValues: {
      new_used: "Used",
      finance_type: "retail",
      stock_number: initialStockNumber ?? "",
      sale_date: new Date().toISOString().split("T")[0],
    },
  });

  // Watch for auto-calculations
  const sellingPrice = watch("selling_price");
  const vehicleCost = watch("vehicle_cost");
  const reserve = watch("reserve");
  const warranty = watch("warranty");
  const gap = watch("gap");
  const aftermarket1 = watch("aftermarket_1");
  const aftermarket2 = watch("aftermarket_2");
  const docFee = watch("doc_fee");

  // Auto-calculations
  const frontGross =
    (Number(sellingPrice) || 0) - (Number(vehicleCost) || 0);
  const fiTotal =
    (Number(reserve) || 0) +
    (Number(warranty) || 0) +
    (Number(gap) || 0) +
    (Number(aftermarket1) || 0) +
    (Number(aftermarket2) || 0);
  const backGross = fiTotal + (Number(docFee) || 0);
  const totalGross = frontGross + backGross;
  const isWashout = frontGross < 0;

  // Lookup vehicle by stock number
  const handleLookup = useCallback(async () => {
    const stockNumber = watch("stock_number");
    if (!stockNumber || !currentEvent) return;

    setLookingUp(true);
    try {
      const vehicle = await lookupVehicle(stockNumber, currentEvent.id);
      if (vehicle) {
        setVehicleId(vehicle.id);
        setValue("vehicle_year", vehicle.year ?? undefined);
        setValue("vehicle_make", vehicle.make ?? "");
        setValue("vehicle_model", vehicle.model ?? "");
        setValue("vehicle_type", vehicle.body_style ?? "");
        setValue("vehicle_cost", vehicle.acquisition_cost ?? undefined);
        toast.success(
          `Found: ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        );
      } else {
        setVehicleId(null);
        toast.info("No available vehicle found with that stock number");
      }
    } catch {
      toast.error("Lookup failed");
    } finally {
      setLookingUp(false);
    }
  }, [currentEvent, setValue, watch]);

  // Auto-lookup on mount if initial stock number is provided
  useEffect(() => {
    if (initialStockNumber && currentEvent && !initialVehicleId) {
      handleLookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEvent]);

  const onSubmit = async (data: DealFormValues) => {
    if (!currentEvent) return;
    setSubmitting(true);
    try {
      await createDeal({
        event_id: currentEvent.id,
        vehicle_id: vehicleId,
        deal_number: data.deal_number ? Number(data.deal_number) : null,
        sale_day: data.sale_day ? Number(data.sale_day) : null,
        sale_date: data.sale_date || null,
        customer_name: data.customer_name,
        customer_zip: data.customer_zip || null,
        customer_phone: data.customer_phone || null,
        stock_number: data.stock_number || null,
        vehicle_year: data.vehicle_year ? Number(data.vehicle_year) : null,
        vehicle_make: data.vehicle_make || null,
        vehicle_model: data.vehicle_model || null,
        vehicle_type: data.vehicle_type || null,
        vehicle_cost: data.vehicle_cost ? Number(data.vehicle_cost) : null,
        new_used: data.new_used,
        trade_year: data.trade_year ? Number(data.trade_year) : null,
        trade_make: data.trade_make || null,
        trade_model: data.trade_model || null,
        trade_acv: data.trade_acv ? Number(data.trade_acv) : null,
        trade_payoff: data.trade_payoff ? Number(data.trade_payoff) : null,
        salesperson: data.salesperson || null,
        second_salesperson: data.second_salesperson || null,
        selling_price: Number(data.selling_price),
        front_gross: frontGross,
        lender: data.lender || null,
        rate: data.rate ? Number(data.rate) : null,
        finance_type: data.finance_type,
        reserve: data.reserve ? Number(data.reserve) : null,
        warranty: data.warranty ? Number(data.warranty) : null,
        gap: data.gap ? Number(data.gap) : null,
        aftermarket_1: data.aftermarket_1 ? Number(data.aftermarket_1) : null,
        aftermarket_2: data.aftermarket_2 ? Number(data.aftermarket_2) : null,
        doc_fee: data.doc_fee ? Number(data.doc_fee) : null,
        source: data.source || null,
        notes: data.notes || null,
      });
      toast.success("Deal created successfully!");
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Deal Info */}
      <Card>
        <CardHeader>
          <CardTitle>Deal Information</CardTitle>
          <CardDescription>Basic deal details</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="deal_number">Deal #</Label>
            <Input
              id="deal_number"
              type="number"
              {...register("deal_number")}
            />
          </div>
          <div>
            <Label htmlFor="sale_day">Sale Day</Label>
            <Input id="sale_day" type="number" {...register("sale_day")} />
          </div>
          <div>
            <Label htmlFor="sale_date">Sale Date</Label>
            <Input id="sale_date" type="date" {...register("sale_date")} />
          </div>
        </CardContent>
      </Card>

      {/* Customer */}
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="customer_name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input id="customer_name" {...register("customer_name")} />
            {errors.customer_name && (
              <p className="text-xs text-red-500 mt-1">
                {errors.customer_name.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="customer_zip">Zip Code</Label>
            <Input id="customer_zip" {...register("customer_zip")} />
          </div>
          <div>
            <Label htmlFor="customer_phone">Phone</Label>
            <Input id="customer_phone" {...register("customer_phone")} />
          </div>
        </CardContent>
      </Card>

      {/* Vehicle */}
      <Card>
        <CardHeader>
          <CardTitle>Vehicle</CardTitle>
          <CardDescription>
            Look up by stock number or enter manually
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="stock_number">Stock #</Label>
              <div className="flex gap-2">
                <Input id="stock_number" {...register("stock_number")} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLookup}
                  disabled={lookingUp}
                >
                  {lookingUp ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div>
              <Label>New/Used</Label>
              <Select
                defaultValue="Used"
                onValueChange={(v) =>
                  setValue("new_used", v as "New" | "Used" | "Certified")
                }
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Used">Used</SelectItem>
                  <SelectItem value="Certified">Certified</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="vehicle_year">Year</Label>
              <Input
                id="vehicle_year"
                type="number"
                {...register("vehicle_year")}
              />
            </div>
            <div>
              <Label htmlFor="vehicle_make">Make</Label>
              <Input id="vehicle_make" {...register("vehicle_make")} />
            </div>
            <div>
              <Label htmlFor="vehicle_model">Model</Label>
              <Input id="vehicle_model" {...register("vehicle_model")} />
            </div>
            <div>
              <Label htmlFor="vehicle_cost">Acquisition Cost</Label>
              <Input
                id="vehicle_cost"
                type="number"
                step="0.01"
                {...register("vehicle_cost")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle>Pricing & Gross</CardTitle>
          <CardDescription>
            Front gross auto-calculates from selling price − cost
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="selling_price">
                Selling Price <span className="text-red-500">*</span>
              </Label>
              <Input
                id="selling_price"
                type="number"
                step="0.01"
                {...register("selling_price")}
              />
              {errors.selling_price && (
                <p className="text-xs text-red-500 mt-1">
                  {errors.selling_price.message}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="salesperson">Salesperson</Label>
              <Input id="salesperson" {...register("salesperson")} />
            </div>
            <div>
              <Label htmlFor="second_salesperson">2nd Salesperson</Label>
              <Input
                id="second_salesperson"
                {...register("second_salesperson")}
              />
            </div>
          </div>

          {/* Auto-calculated summary */}
          <div className="rounded-lg bg-muted/50 p-4 grid gap-2 sm:grid-cols-4 text-sm">
            <div>
              <p className="text-muted-foreground">Front Gross</p>
              <p
                className={`text-lg font-bold ${frontGross >= 0 ? "text-green-700" : "text-red-600"}`}
              >
                {formatCurrency(frontGross)}
              </p>
              {isWashout && (
                <p className="text-xs text-red-500 font-medium">WASHOUT</p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">F&I Total</p>
              <p className="text-lg font-bold text-blue-700">
                {formatCurrency(fiTotal)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Back Gross</p>
              <p className="text-lg font-bold">{formatCurrency(backGross)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total Gross</p>
              <p
                className={`text-xl font-bold ${totalGross >= 0 ? "text-green-700" : "text-red-600"}`}
              >
                {formatCurrency(totalGross)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* F&I Products */}
      <Card>
        <CardHeader>
          <CardTitle>F&I Products</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Finance Type</Label>
              <Select
                defaultValue="retail"
                onValueChange={(v) =>
                  setValue("finance_type", v as "retail" | "lease" | "cash")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="lease">Lease</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="lender">Lender</Label>
              <Input id="lender" {...register("lender")} />
            </div>
            <div>
              <Label htmlFor="rate">Rate %</Label>
              <Input
                id="rate"
                type="number"
                step="0.01"
                {...register("rate")}
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="reserve">Reserve</Label>
              <Input
                id="reserve"
                type="number"
                step="0.01"
                {...register("reserve")}
              />
            </div>
            <div>
              <Label htmlFor="warranty">Warranty</Label>
              <Input
                id="warranty"
                type="number"
                step="0.01"
                {...register("warranty")}
              />
            </div>
            <div>
              <Label htmlFor="gap">GAP</Label>
              <Input
                id="gap"
                type="number"
                step="0.01"
                {...register("gap")}
              />
            </div>
            <div>
              <Label htmlFor="aftermarket_1">Aftermarket 1</Label>
              <Input
                id="aftermarket_1"
                type="number"
                step="0.01"
                {...register("aftermarket_1")}
              />
            </div>
            <div>
              <Label htmlFor="aftermarket_2">Aftermarket 2</Label>
              <Input
                id="aftermarket_2"
                type="number"
                step="0.01"
                {...register("aftermarket_2")}
              />
            </div>
            <div>
              <Label htmlFor="doc_fee">Doc Fee</Label>
              <Input
                id="doc_fee"
                type="number"
                step="0.01"
                {...register("doc_fee")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trade-in */}
      <Card>
        <CardHeader>
          <CardTitle>Trade-In</CardTitle>
          <CardDescription>Optional — fill if customer has a trade</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="trade_year">Year</Label>
            <Input
              id="trade_year"
              type="number"
              {...register("trade_year")}
            />
          </div>
          <div>
            <Label htmlFor="trade_make">Make</Label>
            <Input id="trade_make" {...register("trade_make")} />
          </div>
          <div>
            <Label htmlFor="trade_model">Model</Label>
            <Input id="trade_model" {...register("trade_model")} />
          </div>
          <div>
            <Label htmlFor="trade_acv">ACV</Label>
            <Input
              id="trade_acv"
              type="number"
              step="0.01"
              {...register("trade_acv")}
            />
          </div>
          <div>
            <Label htmlFor="trade_payoff">Payoff</Label>
            <Input
              id="trade_payoff"
              type="number"
              step="0.01"
              {...register("trade_payoff")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Source & Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Additional Info</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="source">Source</Label>
            <Select onValueChange={(v) => setValue("source", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walk-in">Walk-in</SelectItem>
                <SelectItem value="mail">Mail Response</SelectItem>
                <SelectItem value="phone">Phone Up</SelectItem>
                <SelectItem value="internet">Internet</SelectItem>
                <SelectItem value="referral">Referral</SelectItem>
                <SelectItem value="be-back">Be-Back</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" {...register("notes")} />
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <Button type="submit" disabled={submitting} size="lg">
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating Deal...
            </>
          ) : (
            "Create Deal"
          )}
        </Button>
      </div>
    </form>
  );
}
