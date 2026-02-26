import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
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
