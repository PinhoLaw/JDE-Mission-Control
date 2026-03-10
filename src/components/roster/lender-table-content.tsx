import type { Lender } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LenderTableContentProps {
  lenders: Lender[];
  deletingIds: Set<string>;
  onEdit: (lender: Lender) => void;
  onDelete: (lender: Lender) => void;
  onAddClick: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LenderTableContent({
  lenders,
  deletingIds,
  onEdit,
  onDelete,
  onAddClick,
}: LenderTableContentProps) {
  if (lenders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Building2 className="h-12 w-12 text-muted-foreground/50 mb-3" />
        <h3 className="text-lg font-semibold">No lenders configured</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">
          Add lenders to track buy rates and max advance amounts for deals.
        </p>
        <Button size="sm" onClick={onAddClick}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add First Lender
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lender Name</TableHead>
            <TableHead className="text-right">Buy Rate %</TableHead>
            <TableHead className="text-right">Max Advance</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lenders.map((lender) => (
            <TableRow
              key={lender.id}
              className={!lender.active ? "opacity-50" : undefined}
            >
              <TableCell className="font-medium whitespace-nowrap">
                {lender.name}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {lender.buy_rate_pct != null
                  ? `${lender.buy_rate_pct}%`
                  : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {lender.max_advance != null
                  ? formatCurrency(lender.max_advance)
                  : "—"}
              </TableCell>
              <TableCell className="text-center">
                {lender.active ? (
                  <Badge
                    variant="secondary"
                    className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  >
                    Inactive
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => onEdit(lender)}
                    title={`Edit ${lender.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    disabled={deletingIds.has(`lender-${lender.id}`)}
                    onClick={() => onDelete(lender)}
                    title={`Remove ${lender.name}`}
                  >
                    {deletingIds.has(`lender-${lender.id}`) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
