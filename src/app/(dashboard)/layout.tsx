import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { EventProvider } from "@/providers/event-provider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense>
      <EventProvider>
        <div className="flex h-screen overflow-hidden">
          {/* Desktop sidebar — hidden on mobile */}
          <div className="hidden md:block">
            <Sidebar />
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto p-4 md:p-6">
              {children}
            </main>
          </div>
        </div>
      </EventProvider>
    </Suspense>
  );
}
