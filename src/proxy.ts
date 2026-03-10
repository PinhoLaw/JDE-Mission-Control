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

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
