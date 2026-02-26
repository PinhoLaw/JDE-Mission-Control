# JDE-Mission-Control — Vercel Production Deployment Guide

> **Last verified:** Commit `b9bcdbb` (Phase 6) — 19 routes, clean build, zero errors.
> **Stack:** Next.js 15.1.7 · @supabase/ssr 0.8.x · @supabase/supabase-js 2.97.x · Tailwind CSS 3.4 · TypeScript 5.7

---

## 1. Prerequisites Checklist

Complete **every item** before touching Vercel.

- [ ] **Git is clean** — `git status` shows no uncommitted changes
- [ ] **Latest commit pushed** — `git log --oneline -1` matches `origin/main`
- [ ] **Local build passes** — `npm run build` completes with zero errors (19 routes)
- [ ] **TypeScript clean** — `npx tsc --noEmit` shows zero errors
- [ ] **Supabase project exists** with:
  - [ ] `events`, `event_members`, `vehicle_inventory`, `sales_deals`, `event_roster`, `event_lenders`, `mail_tracking_zones`, `event_config`, `daily_metrics`, `audit_logs` tables created
  - [ ] `is_event_member()` PostgreSQL function deployed
  - [ ] RLS enabled and policies applied on every table
  - [ ] `vehicle-photos` Storage bucket created (public, 5MB limit)
  - [ ] At least one user invited via Supabase Auth
- [ ] **Supabase Auth configured:**
  - [ ] Email provider enabled (magic link / OTP)
  - [ ] Email templates working (test a magic link locally first)
- [ ] **You have these values ready (do NOT commit them):**
  - `NEXT_PUBLIC_SUPABASE_URL` — e.g., `https://ayxsaylqhjfgwlchkeek.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — starts with `eyJ...`, role = `anon`
- [ ] **You do NOT need:** `SUPABASE_SERVICE_ROLE_KEY` — it is never used at runtime

### Quick Local Verification

```bash
cd /path/to/JDE-Mission-Control

# Clean install
rm -rf node_modules .next
npm install

# Type check
npx tsc --noEmit

# Production build
npm run build

# Confirm 19 routes, 0 errors in output
```

---

## 2. Environment Variables Setup

### Variables Required on Vercel

| Variable | Type | Value | Vercel Environments |
|----------|------|-------|---------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (bundled into client JS) | `https://<project-ref>.supabase.co` | ✅ Preview · ✅ Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (bundled into client JS) | `eyJ...` (anon role JWT) | ✅ Preview · ✅ Production |

That's it. **Only two variables.**

### Variables That Must NOT Be on Vercel

| Variable | Why NOT |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses ALL Row Level Security.** No runtime code uses it — it exists only for `npm run db:seed` (local CLI). If a preview branch leaked it, an attacker could read/write every row in your database. |

> ⛔ **CRITICAL SECURITY WARNING**
>
> `SUPABASE_SERVICE_ROLE_KEY` must **never** be added to Vercel — not Preview, not Production. All server actions authenticate through cookie-based sessions + the anon key + RLS. The service role key is only used by the local seed script (`scripts/seed-demo-data.ts`), which is never deployed.

### Why Only `NEXT_PUBLIC_` Variables?

This project's architecture is cookie-based auth via `@supabase/ssr`:

| Layer | Auth Method | Key Used |
|-------|-------------|----------|
| Browser (`createBrowserClient`) | Anon key + cookies | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Server Actions (`createServerClient`) | Anon key + cookies + RLS | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Middleware (session refresh) | Anon key + cookies | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

Every query is gated by `is_event_member(event_id)` RLS — the anon key alone cannot bypass it.

### Optional Variables

| Variable | Purpose | When to Add |
|----------|---------|-------------|
| `NEXT_PUBLIC_SITE_URL` | Override base URL for auth redirects | Only if using a custom domain **and** magic link redirects break |

> **Note:** Vercel automatically sets `VERCEL_URL` on every deployment. The `getBaseUrl()` helper in `src/lib/utils.ts` uses this to construct auth redirect URLs. You generally don't need `NEXT_PUBLIC_SITE_URL` unless you have a custom domain and experience redirect issues.

---

## 3. Connecting the Repository to Vercel

### Step 1: Create Vercel Account / Sign In

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account (`PinhoLaw`)
2. If this is your first time, authorize Vercel to access your GitHub repos

### Step 2: Import Repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Under **Import Git Repository**, find `PinhoLaw/JDE-Mission-Control`
3. If the repo doesn't appear, click **Adjust GitHub App Permissions** and grant access to the repo
4. Click **Import**

### Step 3: Configure Project (on the import screen)

| Setting | Value |
|---------|-------|
| **Project Name** | `jde-mission-control` (auto-detected) |
| **Framework Preset** | `Next.js` (auto-detected — do not change) |
| **Root Directory** | `.` (leave default — don't change) |
| **Build Command** | `next build` (auto-detected — leave default) |
| **Output Directory** | `.next` (auto-detected — leave default) |
| **Install Command** | `npm install` (auto-detected — leave default) |
| **Node.js Version** | `20.x` (Vercel default — this is fine even though local is v25.x) |

### Step 4: Add Environment Variables (on the same screen)

Before clicking **Deploy**, expand the **Environment Variables** section:

**Variable 1:**
```
Name:  NEXT_PUBLIC_SUPABASE_URL
Value: https://ayxsaylqhjfgwlchkeek.supabase.co
```
Environments: ✅ Production · ✅ Preview · ✅ Development

**Variable 2:**
```
Name:  NEXT_PUBLIC_SUPABASE_ANON_KEY
Value: <your-anon-key-from-supabase-dashboard>
```
Environments: ✅ Production · ✅ Preview · ✅ Development

> **Triple-check:** You should see exactly **2** environment variables. If you see `SUPABASE_SERVICE_ROLE_KEY`, delete it immediately.

### Step 5: Deploy

Click **Deploy**. Vercel will:
1. Clone the repo
2. Run `npm install`
3. Run `next build`
4. Deploy to a `.vercel.app` URL

First deploy takes ~90 seconds. Watch the build log for errors.

---

## 4. Vercel Project Configuration (Post-Deploy Verification)

After the first deploy, verify these settings in **Vercel Dashboard → Your Project → Settings**:

### General Settings

| Setting | Expected Value |
|---------|----------------|
| Framework Preset | Next.js |
| Root Directory | `./` |
| Build Command | `next build` |
| Output Directory | `.next` |
| Node.js Version | 20.x |

### Environment Variables

Go to **Settings → Environment Variables** and confirm:

| Variable | Environments | Present? |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Preview + Production | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Preview + Production | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | — | ❌ Must NOT exist |

### Functions

Go to **Settings → Functions** and verify:
- **Region:** Choose the region closest to your Supabase project (e.g., `iad1` for US East if your Supabase is `us-east-1`)
- This reduces latency between Vercel serverless functions and Supabase

---

## 5. Supabase Auth Configuration for Vercel URLs

This is **critical** — magic link login will fail without this step.

### In Supabase Dashboard → Authentication → URL Configuration:

**Site URL:**
```
https://jde-mission-control.vercel.app
```
(Replace with your actual Vercel production URL — visible in the Vercel dashboard after first deploy)

**Redirect URLs — Add ALL of these:**
```
https://jde-mission-control.vercel.app/auth/callback
https://*.vercel.app/auth/callback
http://localhost:3000/auth/callback
```

> **Why the wildcard?** Vercel preview deployments have unique URLs like `jde-mission-control-abc123-pinholaws-projects.vercel.app`. The wildcard `https://*.vercel.app/auth/callback` covers all of them.

### Verify Email Template

In **Supabase Dashboard → Authentication → Email Templates → Magic Link**:

Ensure the `{{ .ConfirmationURL }}` variable is present in the template. This is what generates the clickable login link.

---

## 6. First Deployment — Preview Branch

### Trigger a Preview Deploy

A preview deploy is created automatically whenever you push to any branch **except** `main` (or whatever your production branch is). To test:

```bash
git checkout -b deploy/smoke-test
git commit --allow-empty -m "Trigger preview deploy for smoke testing"
git push origin deploy/smoke-test
```

### What to Expect

1. Go to **Vercel Dashboard → Deployments**
2. You'll see a new deployment building with a Preview label
3. Once complete (green checkmark), click the deployment URL
4. URL format: `https://jde-mission-control-<hash>-<scope>.vercel.app`

### If the Build Fails

Check the build log in Vercel. Common first-deploy issues:

| Error | Fix |
|-------|-----|
| `NEXT_PUBLIC_SUPABASE_URL is not defined` | Environment variable missing — add it in Vercel Settings |
| `Module not found` | Run `npm install` locally and verify `package-lock.json` is committed |
| `Type error` | Run `npx tsc --noEmit` locally — fix any type errors before pushing |

---

## 7. Smoke Test on Preview URL

Open the preview URL in a browser. Run through **every** checklist item. Do not skip any.

### Authentication

- [ ] **Login page renders** — `/auth/login` shows "JDE Mission Control" card with email input
- [ ] **Magic link sends** — Enter your email, click "Send magic link", see "Check your email" confirmation
- [ ] **Magic link works** — Click the link in your email, arrive at `/dashboard`
- [ ] **Session persists** — Refresh the page, still logged in (not redirected to login)
- [ ] **Unauthenticated redirect** — Open an incognito window, go to `/dashboard`, get redirected to `/auth/login`

### Event Selection

- [ ] **Events load** — Event selector in the header shows your seeded event(s)
- [ ] **Event switching** — If multiple events exist, switching updates all data on the page
- [ ] **Event persists** — Refresh the page, same event is still selected (stored in localStorage)

### Dashboard (KPI Cards)

- [ ] **KPI cards render** — Total Deals, Total Gross, Front Gross, Back Gross, Avg PVR visible
- [ ] **Numbers match** — Cards show correct aggregations for the selected event
- [ ] **Currency formatting** — Values display as `$12,345.67` (not raw numbers)

### Inventory

- [ ] **Table renders** — `/dashboard/inventory` shows the vehicle grid
- [ ] **Virtualized scrolling** — Scroll through 60+ rows smoothly (no pagination buttons)
- [ ] **Sticky header** — Column headers remain visible while scrolling
- [ ] **Inline editing** — Click a cell (e.g., status), edit value, see it save
- [ ] **Photo thumbnails** — If photos were uploaded, thumbnail column shows them
- [ ] **Photo upload** — Click the photo cell on a vehicle, upload an image, see it appear
- [ ] **Bulk actions** — Select multiple rows, change status or delete (with optimistic UI)
- [ ] **Search** — Type in the search box, table filters in real-time
- [ ] **CSV export** — Click Export, CSV file downloads with correct data

### Deals

- [ ] **Deal table renders** — `/dashboard/deals` shows the deal log
- [ ] **Virtualized scrolling** — Smooth scroll through all deals (no pagination)
- [ ] **Sticky header** — Headers stay pinned while scrolling
- [ ] **Status badges** — Colored badges for pending/funded/unwound/cancelled
- [ ] **Sorting** — Click "Front" or "Total" column header to sort
- [ ] **Status filter** — Filter by pending/funded/unwound/cancelled
- [ ] **Gross calculations** — Front + Back = Total for each row
- [ ] **CSV export** — Click Export, CSV downloads correctly

### New Deal Form

- [ ] **Form renders** — `/dashboard/deals/new` shows the deal form
- [ ] **Vehicle lookup** — Enter a stock number, auto-populates vehicle info
- [ ] **Form validation** — Submit with missing required fields → shows error messages
- [ ] **Successful submit** — Fill out form, submit, redirects to deal log with new deal visible
- [ ] **Realtime update** — Open deal log in a second tab — the new deal appears instantly without refresh

### Roster

- [ ] **Roster loads** — `/dashboard/roster` shows team members and lenders
- [ ] **Add member** — Add a new roster member, see it appear
- [ ] **Delete member** — Delete a member (owner/manager only)

### Campaigns

- [ ] **Campaigns load** — `/dashboard/campaigns` shows mail tracking zones
- [ ] **Data displays** — Zone codes, quantities, dates render correctly

### Commissions

- [ ] **Commissions load** — `/dashboard/commissions` shows commission calculator
- [ ] **Calculations correct** — Commission splits compute accurately

### Performance

- [ ] **Charts render** — `/dashboard/performance` shows Recharts analytics
- [ ] **No blank charts** — All charts have data (if daily metrics exist)
- [ ] **Responsive** — Charts resize correctly on window resize

### Audit Log

- [ ] **Audit log loads** — `/dashboard/audit` shows recent actions
- [ ] **Entity type filter** — Filter by deal/vehicle/roster/config/lender
- [ ] **Expandable diffs** — Click a row to see old/new JSON values
- [ ] **Realtime updates** — Make a change elsewhere, audit entry appears without refresh
- [ ] **Role restriction** — Audit log is visible only to owner/manager roles

### Settings

- [ ] **Settings load** — `/dashboard/settings` shows event configuration
- [ ] **Save works** — Modify a setting, save, refresh, value persists

### Mobile / Responsive

- [ ] **Mobile drawer** — On mobile viewport (< 768px), sidebar becomes a hamburger drawer
- [ ] **Touch scrolling** — Inventory and deal tables scroll smoothly on touch
- [ ] **Cards stack** — KPI cards stack vertically on small screens
- [ ] **Login mobile** — Login page renders correctly on mobile

### Dark Mode

- [ ] **Theme toggle** — Switch between light/dark/system mode
- [ ] **No flash** — No white flash on page load in dark mode (suppressHydrationWarning is set)
- [ ] **All pages themed** — Every page respects the theme (no white backgrounds in dark mode)

### Security Headers

Open browser DevTools → Network → click any document response → check headers:

- [ ] `X-Frame-Options: DENY`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Console Errors

- [ ] **No console errors** — Open DevTools Console, verify zero red errors
- [ ] **No hydration warnings** — No "Hydration mismatch" messages

---

## 8. Promote to Production

### Option A: Auto-Production from `main` (Default)

By default, Vercel deploys the `main` branch as Production. If your code is already on `main`:

1. Go to **Vercel Dashboard → Deployments**
2. The latest `main` deploy should have a **Production** label
3. If it doesn't, click the deployment → **three-dot menu** → **Promote to Production**

### Option B: Manual Production Deploy

```bash
# Ensure you're on main with all changes
git checkout main
git pull origin main

# Push (triggers production deploy automatically)
git push origin main
```

### Adding a Custom Domain (Optional)

1. Go to **Vercel Dashboard → Your Project → Settings → Domains**
2. Click **Add Domain**
3. Enter your domain: e.g., `app.justdriveevents.com`
4. Vercel will show DNS records to add:
   - **Type A:** `76.76.21.21`
   - **Type CNAME:** `cname.vercel-dns.com`
5. Add the records at your DNS provider (Cloudflare, GoDaddy, Namecheap, etc.)
6. Wait for DNS propagation (usually 1-10 minutes, can take up to 48 hours)
7. Vercel auto-provisions SSL — no manual certificate setup needed

> **Important:** If you add a custom domain, update Supabase Auth:
> - **Site URL** → `https://app.justdriveevents.com`
> - **Redirect URLs** → add `https://app.justdriveevents.com/auth/callback`

### SSL Auto-Provisioning

Vercel automatically provisions and renews SSL certificates for:
- Your `.vercel.app` subdomain (immediate)
- Custom domains (after DNS verification, usually within minutes)
- No action required from you

---

## 9. Post-Production Smoke Test

Repeat **every item** from Section 7, but on the production URL:

- [ ] Replace the preview URL with `https://jde-mission-control.vercel.app` (or your custom domain)
- [ ] **Login flow works** on the production URL (magic link redirects to the correct domain)
- [ ] **Realtime works** — open two browser tabs, make a change in one, see it reflected in the other
- [ ] **Images load** — vehicle photos from Supabase Storage render correctly
- [ ] **All 19 routes accessible** — navigate to every page in the sidebar

### Production-Specific Checks

- [ ] **HTTPS enforced** — `http://` redirects to `https://`
- [ ] **No mixed content** — DevTools Console shows no "Mixed Content" warnings
- [ ] **Performance** — Lighthouse score > 80 for Performance (Vercel auto-optimizes)
- [ ] **No `.env.local` secrets leaked** — View Page Source, search for `service_role` → zero results

### Quick Leak Check

Open browser DevTools → Console and run:

```javascript
// Should return undefined — service role key is NOT in the client bundle
console.log(window.__NEXT_DATA__);
// Search the page source for service_role
document.documentElement.innerHTML.includes('service_role');  // Must be false
```

---

## 10. Optional Quick Wins After Go-Live

### Enable Vercel Analytics

1. **Vercel Dashboard → Your Project → Analytics**
2. Click **Enable**
3. This adds free Web Vitals tracking (LCP, FID, CLS) — no code changes needed

### Enable Vercel Speed Insights

1. Install: `npm install @vercel/speed-insights`
2. Add to root layout (`src/app/layout.tsx`):

```tsx
import { SpeedInsights } from "@vercel/speed-insights/next";

// Inside the <body> tag, alongside <Toaster>:
<SpeedInsights />
```

### Supabase Backup Reminder

- **Supabase Dashboard → Settings → Database → Backups**
- Free tier: daily automatic backups (7-day retention)
- Pro tier: point-in-time recovery
- Verify backups are running — this is real dealership money data

### Rate Limiting (Future Enhancement)

For production hardening, consider adding rate limiting to the middleware. Example using Vercel KV (requires Vercel KV addon):

```typescript
// Future: src/middleware.ts rate limiting sketch
// import { Ratelimit } from "@upstash/ratelimit";
// import { kv } from "@vercel/kv";
//
// const ratelimit = new Ratelimit({
//   redis: kv,
//   limiter: Ratelimit.slidingWindow(10, "10 s"),
// });
```

For now, Supabase's built-in rate limiting (Auth: 30 emails/hour, API: varies by plan) provides baseline protection.

---

## 11. Common Failure Modes & Fixes

### Auth: 401 Unauthorized / 403 Forbidden

| Symptom | Cause | Fix |
|---------|-------|-----|
| Login magic link goes to wrong URL | Site URL or Redirect URLs not configured in Supabase | Update **Supabase → Auth → URL Configuration** with your Vercel URL |
| "Invalid login credentials" on callback | Auth callback URL not in Supabase allowed list | Add `https://<your-vercel-url>/auth/callback` to **Redirect URLs** |
| Server actions return 401 | Session cookie expired or not refreshed | Verify middleware is running (check `src/middleware.ts` matcher pattern) |
| RLS blocks all queries | User not in `event_members` table | Add the user to the event via Roster page or directly in Supabase |

### Realtime Not Connecting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No live updates between tabs | Realtime not enabled on tables | **Supabase → Database → Replication** → enable realtime for `sales_deals`, `vehicle_inventory`, `event_roster`, `event_lenders`, `audit_logs` |
| WebSocket connection drops | Vercel serverless function timeout | This is expected — realtime runs in the browser via WebSocket directly to Supabase, not through Vercel. Check browser console for WS errors. |
| "Could not connect to realtime" | Anon key incorrect or Supabase project paused | Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` is correct. Unpause Supabase project if on free tier. |

### Images 404

| Symptom | Cause | Fix |
|---------|-------|-----|
| Vehicle photos show broken image icon | Supabase Storage bucket not public | **Supabase → Storage → vehicle-photos** → ensure bucket is set to Public |
| Next.js image optimization error | Hostname not in `remotePatterns` | Verify `NEXT_PUBLIC_SUPABASE_URL` is set correctly in Vercel — `next.config.ts` extracts the hostname dynamically |
| "Invalid src" console error | Image URL malformed | Check `photo_url` column values in `vehicle_inventory` — should be full Supabase Storage URLs |

### Hydration Mismatch

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Hydration failed" console warning | Server/client render mismatch | Usually caused by browser extensions (Grammarly, ad blockers). Test in incognito mode first. |
| Theme flash on load | `suppressHydrationWarning` missing | Already set on `<html>` element in `src/app/layout.tsx` — should not occur |

### Build Fails on Missing Env Var

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TypeError: Cannot read properties of undefined` during build | `NEXT_PUBLIC_SUPABASE_URL` not set in Vercel | Add the variable in **Vercel → Settings → Environment Variables** and redeploy |
| Build succeeds but pages crash at runtime | Env var set for wrong environment (e.g., only Production, not Preview) | Ensure both variables are enabled for **both** Preview and Production environments |

### Middleware Redirect Loop

| Symptom | Cause | Fix |
|---------|-------|-----|
| Infinite redirect between `/auth/login` and `/dashboard` | Cookie not being set/read correctly | Clear all cookies for the domain, try again. If persists, check Supabase session is valid. |
| Static assets trigger auth redirect | Middleware matcher too broad | Verify `src/middleware.ts` matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and image extensions |

---

## 12. Local Verification Script

Save this as `scripts/verify-deploy.sh` and run before every deploy:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "============================================"
echo " JDE Mission Control — Pre-Deploy Checklist"
echo "============================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS="${GREEN}✓${NC}"
FAIL="${RED}✗${NC}"
WARN="${YELLOW}⚠${NC}"

ERRORS=0

# 1. Check git status
echo "--- Git Status ---"
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${PASS} Working directory is clean"
else
    echo -e "${FAIL} Uncommitted changes detected"
    git status --short
    ERRORS=$((ERRORS + 1))
fi

# 2. Check current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "${PASS} Current branch: ${BRANCH}"

# 3. Check remote sync
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/${BRANCH} 2>/dev/null || echo "no-remote")
if [ "$LOCAL" = "$REMOTE" ]; then
    echo -e "${PASS} Local and remote are in sync"
else
    echo -e "${WARN} Local (${LOCAL:0:7}) differs from remote (${REMOTE:0:7}) — push pending?"
fi

# 4. Check .env.local exists
echo ""
echo "--- Environment ---"
if [ -f ".env.local" ]; then
    echo -e "${PASS} .env.local exists"
else
    echo -e "${WARN} .env.local not found (not required for Vercel, but needed locally)"
fi

# 5. Verify SUPABASE_SERVICE_ROLE_KEY is NOT in src/
echo ""
echo "--- Security Audit ---"
SERVICE_ROLE_HITS=$(grep -r "SUPABASE_SERVICE_ROLE_KEY\|service_role" src/ --include="*.ts" --include="*.tsx" -l 2>/dev/null || true)
if [ -z "$SERVICE_ROLE_HITS" ]; then
    echo -e "${PASS} No service_role references in src/ (safe for Vercel)"
else
    echo -e "${FAIL} service_role found in runtime code:"
    echo "$SERVICE_ROLE_HITS"
    ERRORS=$((ERRORS + 1))
fi

# 6. Verify .gitignore includes .env.local
if grep -q "\.env\*\.local" .gitignore 2>/dev/null || grep -q "\.env\.local" .gitignore 2>/dev/null; then
    echo -e "${PASS} .env.local is in .gitignore"
else
    echo -e "${FAIL} .env.local is NOT in .gitignore — secrets may be committed!"
    ERRORS=$((ERRORS + 1))
fi

# 7. TypeScript check
echo ""
echo "--- TypeScript ---"
if npx tsc --noEmit 2>/dev/null; then
    echo -e "${PASS} TypeScript: zero errors"
else
    echo -e "${FAIL} TypeScript errors detected"
    ERRORS=$((ERRORS + 1))
fi

# 8. Production build
echo ""
echo "--- Production Build ---"
if npm run build > /dev/null 2>&1; then
    echo -e "${PASS} Production build succeeded"
else
    echo -e "${FAIL} Production build failed"
    ERRORS=$((ERRORS + 1))
fi

# 9. Check for accidental secrets in git history
echo ""
echo "--- Git Secret Scan (last 5 commits) ---"
SECRET_IN_DIFF=$(git log -5 --all -p -- '*.ts' '*.tsx' '*.json' '*.env*' | grep -i "service.role" | head -5 || true)
if [ -z "$SECRET_IN_DIFF" ]; then
    echo -e "${PASS} No service_role key in recent commits"
else
    echo -e "${WARN} Potential service_role reference in recent git history"
fi

# Summary
echo ""
echo "============================================"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN} ALL CHECKS PASSED — safe to deploy${NC}"
else
    echo -e "${RED} ${ERRORS} CHECK(S) FAILED — fix before deploying${NC}"
fi
echo "============================================"

exit $ERRORS
```

Make it executable and run:

```bash
chmod +x scripts/verify-deploy.sh
./scripts/verify-deploy.sh
```

---

## 13. Quick Reference: Full Deployment Sequence

For future deploys, here's the condensed checklist:

```bash
# 1. Verify locally
./scripts/verify-deploy.sh

# 2. Push to main (triggers production deploy)
git push origin main

# 3. Watch build in Vercel Dashboard → Deployments

# 4. Smoke test on production URL:
#    - Login with magic link
#    - Select event
#    - Check inventory table + scroll performance
#    - Create a deal, verify realtime
#    - Check DevTools console for errors
#    - Check security headers in Network tab

# 5. Done ✅
```

---

## Appendix: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        VERCEL (Edge + Serverless)                │
│                                                                  │
│  ┌──────────┐   ┌─────────────────┐   ┌──────────────────────┐  │
│  │Middleware │──▶│ Server Actions   │──▶│ createServerClient   │  │
│  │(session   │   │ (requireMember-  │   │ (anon key + cookies  │  │
│  │ refresh)  │   │  ship + RLS)     │   │  → Supabase)         │  │
│  └──────────┘   └─────────────────┘   └──────────┬───────────┘  │
│                                                    │              │
│  ┌──────────────────────────────────────┐          │              │
│  │ Browser (React Client Components)    │          │              │
│  │ createBrowserClient (anon key)       │──────────┤              │
│  │ Realtime WebSocket ─────────────────────────────┤              │
│  └──────────────────────────────────────┘          │              │
└────────────────────────────────────────────────────┼──────────────┘
                                                     │
                                          ┌──────────▼───────────┐
                                          │  SUPABASE             │
                                          │  PostgreSQL + RLS     │
                                          │  Auth (magic link)    │
                                          │  Realtime             │
                                          │  Storage (photos)     │
                                          │                       │
                                          │  Every query gated by │
                                          │  is_event_member()    │
                                          └───────────────────────┘
```

---

*Generated for JDE-Mission-Control commit `b9bcdbb`. Last updated: Feb 2026.*
