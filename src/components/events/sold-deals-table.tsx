import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { Database } from "@/types/database";

type Deal = Database["public"]["Tables"]["deals"]["Row"];

interface SoldDealsTableProps {
  deals: Deal[];
}

export function SoldDealsTable({ deals }: SoldDealsTableProps) {
  if (deals.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No sold deals yet. Mark vehicles as sold to see them here.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vehicle</TableHead>
            <TableHead>Buyer</TableHead>
            <TableHead>Sale Price</TableHead>
            <TableHead>Sold</TableHead>
            <TableHead>Stage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((deal) => (
            <TableRow key={deal.id}>
              <TableCell className="font-medium">
                {deal.company_name}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {deal.contact_name || "—"}
              </TableCell>
              <TableCell className="font-medium text-green-700">
                {deal.value != null ? formatCurrency(deal.value) : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {deal.closed_at
                  ? new Date(deal.closed_at).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-800"
                >
                  {deal.stage}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
