# JDE Mission Control

Internal dashboard for **Just Drive Events** — real-time inventory, deals, KPIs, commissions, roster, campaigns, and performance analytics for high-volume pop-up car sales events.

## Tech Stack

- **Next.js 15** (App Router, Server Actions, Turbopack)
- **Supabase** (PostgreSQL + RLS + Realtime + Storage + Auth)
- **@supabase/ssr** for cookie-based auth (server + browser)
- **TanStack React Table** with virtual scrolling (300+ rows)
- **Recharts** for analytics charts
- **Tailwind CSS** + **shadcn/ui** + **next-themes** (dark mode)
- **TypeScript** end-to-end

## Architecture & Security

| Layer | Pattern |
|-------|---------|
| **Client** | `createBrowserClient` + anon key + cookies |
| **Server Actions** | `createServerClient` + cookies + anon key + RLS |
| **Middleware** | Session refresh on every request via anon key |
| **RLS** | `is_event_member(event_id)` function gates every table |
| **Auth** | Magic link OTP via Supabase Auth |
| **Service Role** | Used ONLY in `scripts/seed-demo-data.ts` (local CLI) — never in runtime code |

All server actions use `requireMembership(eventId, roles?)` to verify auth + event access + role before any mutation.

---

## Local Development Setup

```bash
# 1. Clone and install
git clone https://github.com/PinhoLaw/JDE-Mission-Control.git
cd JDE-Mission-Control
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your Supabase project credentials

# 3. Run database migrations (Supabase SQL Editor)
# Apply: supabase/schema.sql, supabase/schema-v2.sql, supabase/migration-phase5.sql

# 4. Seed demo data (optional)
npm run db:seed

# 5. Start dev server
npm run dev
# Open http://localhost:3000
```

### Environment Variables (Local)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Seed only | Only for `npm run db:seed` — never used at runtime |

---

## Vercel Preview Deployment Setup

### Step 1: Connect Repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `PinhoLaw/JDE-Mission-Control` repository
3. Framework preset: **Next.js** (auto-detected)
4. Click **Deploy**

### Step 2: Add Environment Variables

Go to **Vercel Dashboard > Project Settings > Environment Variables** and add **only these two**:

| Variable | Value | Environments |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ayxsaylqhjfgwlchkeek.supabase.co` | Preview + Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(your anon key)* | Preview + Production |

> **WARNING: Do NOT add `SUPABASE_SERVICE_ROLE_KEY` to Vercel.**
> The service role key bypasses all Row Level Security. If added to Preview, any preview branch deployment could accidentally expose it. No runtime code needs it — all server actions authenticate through cookie-based sessions + RLS.

### Step 3: Configure Supabase Auth Redirects

In your Supabase Dashboard > Authentication > URL Configuration:

1. **Site URL**: Set to your Vercel Production URL (e.g., `https://jde-mission-control.vercel.app`)
2. **Redirect URLs**: Add patterns for Preview deployments:
   ```
   https://*.vercel.app/auth/callback
   http://localhost:3000/auth/callback
   ```

This allows magic link auth to work on any Vercel preview URL.

### Step 4: Deploy and Test

1. Push to any branch → Vercel auto-deploys a Preview
2. Open the preview URL
3. Sign in with your email (magic link)
4. Select the seeded event "Lincoln CDJR Feb/March 26"
5. Verify: Inventory (60 vehicles), Deals (30), Roster (8), Charts, etc.

---

## Project Structure

```
src/
├── app/
│   ├── auth/              # Login + callback
│   └── (dashboard)/
│       └── dashboard/
│           ├── page.tsx          # Main KPI dashboard
│           ├── inventory/        # Vehicle grid + import wizard
│           ├── deals/            # Deal log + new deal form
│           ├── roster/           # Team members + lenders
│           ├── campaigns/        # Mail tracking
│           ├── commissions/      # Commission calculator
│           ├── performance/      # Recharts analytics
│           ├── settings/         # Event config
│           ├── audit/            # Change audit log
│           └── events/           # Event CRUD
├── components/
│   ├── layout/            # Sidebar, mobile drawer
│   ├── ui/                # shadcn/ui primitives
│   └── deals/             # Deal form component
├── lib/
│   ├── supabase/          # client.ts, server.ts, middleware.ts
│   ├── actions/           # Server actions (inventory, deals, roster, etc.)
│   └── utils.ts           # Helpers (formatCurrency, slugify, getBaseUrl)
├── providers/             # EventProvider (React context)
└── types/                 # database.ts (full Supabase types)
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:seed` | Seed demo data (requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`) |
| `npm run db:types` | Regenerate TypeScript types from Supabase schema |

## Security Summary

- **Anon key only** in all runtime code (browser + server) — never service role
- **Cookie-based sessions** refreshed by middleware on every request
- **RLS enforced** on every table via `is_event_member()` PostgreSQL function
- **Server action auth**: Every mutation checks `requireMembership(eventId, roles?)`
- **Field allowlist** on `updateVehicleField()` prevents arbitrary field injection
- **Security headers**: X-Frame-Options DENY, nosniff, strict Referrer-Policy
- **Input validation**: Zod schemas on all form submissions
- **Service role isolation**: Only in local seed script, never deployed
