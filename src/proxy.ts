import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  // Log every request — shows in Vercel Runtime Logs
  console.log(
    "[proxy]",
    request.method,
    request.nextUrl.pathname,
    "| ENV:",
    process.env.NEXT_PUBLIC_SUPABASE_URL ? "URL✓" : "URL✗",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "KEY✓" : "KEY✗",
  );

  // Fail-safe: if Supabase env vars are missing, let the request through
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    console.error(
      "[proxy] FATAL — Missing env vars:",
      !process.env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    return NextResponse.next();
  }

  try {
    const response = await updateSession(request);
    console.log("[proxy] OK:", request.nextUrl.pathname, "→", response.status);
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
