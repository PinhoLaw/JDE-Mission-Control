import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session — important for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login
  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/auth");

  // ─── TEMPORARY PREVIEW BYPASS — DELETE AFTER REVIEW ───
  // Allows unauthenticated access to /dashboard when ?preview=caveman2026 is present.
  // This is for external AI review only. Remove this entire block when done.
  const isPreviewBypass =
    request.nextUrl.pathname === "/dashboard" &&
    request.nextUrl.searchParams.get("preview") === "caveman2026";
  // ─── END TEMPORARY PREVIEW BYPASS ───

  if (!user && !isAuthRoute && !isPreviewBypass) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname === "/auth/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
