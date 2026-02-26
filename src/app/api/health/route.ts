import { NextResponse } from "next/server";

/**
 * GET /api/health — Diagnostic endpoint for Vercel deployment.
 * Tests: serverless function execution, env var availability, Supabase connectivity.
 * Visit this URL on Vercel to confirm the runtime is working.
 */
export async function GET() {
  const checks: Record<string, string> = {
    runtime: "ok",
    node_version: process.version,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `✓ (${process.env.NEXT_PUBLIC_SUPABASE_URL.substring(0, 30)}...)`
      : "✗ MISSING",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? `✓ (${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.substring(0, 20)}...)`
      : "✗ MISSING",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? "⚠ PRESENT (should NOT be on Vercel)"
      : "✓ absent (correct)",
    VERCEL_URL: process.env.VERCEL_URL ?? "not set",
    VERCEL_ENV: process.env.VERCEL_ENV ?? "not set",
  };

  // Test Supabase connectivity if env vars are present
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
        {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
        },
      );
      checks.supabase_connectivity = res.ok
        ? `✓ (${res.status})`
        : `✗ (${res.status} ${res.statusText})`;
    } catch (err) {
      checks.supabase_connectivity = `✗ FAILED: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    checks.supabase_connectivity = "⏭ skipped (missing env vars)";
  }

  console.log("[health] check:", JSON.stringify(checks, null, 2));

  return NextResponse.json(checks, {
    headers: { "Cache-Control": "no-store" },
  });
}
