import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Log every request — shows in Vercel Runtime Logs
  console.log(
    "[proxy]",
    request.method,
    pathname,
    "| ENV:",
    process.env.NEXT_PUBLIC_SUPABASE_URL ? "URL✓" : "URL✗",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "KEY✓" : "KEY✗",
  );

  // Let API routes through without auth — they handle their own auth
  if (pathname.startsWith("/api/")) {
    console.log("[proxy] API route — pass through:", pathname);
    return NextResponse.next();
  }

  // ─── TEMPORARY PREVIEW BYPASS — DELETE AFTER REVIEW ───
  // Allow unauthenticated access to /dashboard?preview=caveman2026
  // for external AI review. Sets a header so server components know
  // to use the service-role client (bypasses RLS). Remove this block when done.
  if (
    pathname === "/dashboard" &&
    request.nextUrl.searchParams.get("preview") === "caveman2026"
  ) {
    console.log("[proxy] Preview bypass — allowing public access:", pathname);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-preview-bypass", "true");
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }
  // ─── END TEMPORARY PREVIEW BYPASS ───

  // Fail-safe: if Supabase env vars are missing, let the request through
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    console.error(
      "[proxy] FATAL — Missing env vars:",
      !process.env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    return NextResponse.next();
  }

  try {
    const response = await updateSession(request);
    console.log("[proxy] OK:", pathname, "→", response.status);
    return response;
  } catch (error) {
    console.error("[proxy] CRASH:", error);
    return NextResponse.next();
  }
}

// ─── TEMPORARY PREVIEW BYPASS — DELETE AFTER REVIEW ───
// Re-export as "middleware" so Next.js definitely picks up this function.
// The original "proxy" export may not be recognised by all Next.js versions.
export { proxy as middleware };
// ─── END TEMPORARY PREVIEW BYPASS ───

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
