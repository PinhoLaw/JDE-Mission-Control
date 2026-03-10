import { createServerClient } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import type { Database } from "@/types/database";

export async function createClient() {
  // IMPORTANT: call cookies() FIRST, before any env-var checks.
  // During Vercel's build-time prerender probe, cookies() throws
  // DYNAMIC_SERVER_USAGE which tells Next.js to skip static generation
  // and render this route dynamically at request time. If we throw
  // before cookies(), Next.js never gets that signal and the build fails.
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error(
      "[createClient] Missing Supabase env vars at RUNTIME:",
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    throw new Error(
      "Supabase configuration missing. Check Vercel environment variables and redeploy.",
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The `setAll` method is called from a Server Component.
          // This can be ignored if you have proxy refreshing sessions.
        }
      },
    },
  });
}

// ─── TEMPORARY PREVIEW BYPASS — DELETE AFTER REVIEW ───
// Returns true when the request carries the x-preview-bypass header
// (set by the middleware for ?preview=caveman2026 requests).
export async function isPreviewMode(): Promise<boolean> {
  const h = await headers();
  return h.get("x-preview-bypass") === "true";
}

// Service-role client that bypasses RLS. Used ONLY for the preview
// bypass so unauthenticated visitors can see dashboard data.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createJsClient<Database>(url, serviceKey);
}
// ─── END TEMPORARY PREVIEW BYPASS ───
