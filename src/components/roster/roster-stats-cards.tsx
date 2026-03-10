import { Users, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleBreakdown {
  sales: number;
  team_leader: number;
  fi_manager: number;
  closer: number;
  manager: number;
}

interface RosterStatsCardsProps {
  total: number;
  confirmed: number;
  byRole: RoleBreakdown;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RosterStatsCards({
  total,
  confirmed,
  byRole,
}: RosterStatsCardsProps) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Total Team
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{total}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            Confirmed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-green-700">
            {confirmed}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Sales</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-blue-700">
            {byRole.sales}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Team Leaders</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-purple-700">
            {byRole.team_leader}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>F&amp;I Managers</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-green-700">
            {byRole.fi_manager}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Closers</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-orange-700">
            {byRole.closer}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
