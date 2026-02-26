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
REMOTE=$(git rev-parse "origin/${BRANCH}" 2>/dev/null || echo "no-remote")
if [ "$LOCAL" = "$REMOTE" ]; then
    echo -e "${PASS} Local and remote are in sync"
elif [ "$REMOTE" = "no-remote" ]; then
    echo -e "${WARN} No remote tracking branch for ${BRANCH}"
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
if grep -q '\.env\*\.local' .gitignore 2>/dev/null || grep -q '\.env\.local' .gitignore 2>/dev/null; then
    echo -e "${PASS} .env.local is in .gitignore"
else
    echo -e "${FAIL} .env.local is NOT in .gitignore — secrets may be committed!"
    ERRORS=$((ERRORS + 1))
fi

# 7. Verify no secrets in .env.example
if grep -q "eyJ" .env.example 2>/dev/null; then
    echo -e "${FAIL} .env.example contains what looks like a real key (eyJ...)"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${PASS} .env.example has no real keys"
fi

# 8. TypeScript check
echo ""
echo "--- TypeScript ---"
echo "Running tsc --noEmit..."
if npx tsc --noEmit 2>&1; then
    echo -e "${PASS} TypeScript: zero errors"
else
    echo -e "${FAIL} TypeScript errors detected"
    ERRORS=$((ERRORS + 1))
fi

# 9. Production build
echo ""
echo "--- Production Build ---"
echo "Running next build..."
BUILD_OUTPUT=$(npm run build 2>&1)
if echo "$BUILD_OUTPUT" | grep -q "Generating static pages"; then
    ROUTE_COUNT=$(echo "$BUILD_OUTPUT" | grep -E "^[├└┌]" | wc -l | tr -d ' ')
    echo -e "${PASS} Production build succeeded (${ROUTE_COUNT} routes)"
else
    echo -e "${FAIL} Production build failed"
    echo "$BUILD_OUTPUT" | tail -20
    ERRORS=$((ERRORS + 1))
fi

# 10. Check for accidental secrets in last 5 commits
echo ""
echo "--- Git Secret Scan (last 5 commits) ---"
SECRET_IN_DIFF=$(git log -5 --all -p -- '*.ts' '*.tsx' '*.json' | grep -i "service.role" | head -5 || true)
if [ -z "$SECRET_IN_DIFF" ]; then
    echo -e "${PASS} No service_role key in recent commit diffs"
else
    echo -e "${WARN} Potential service_role reference in recent git history:"
    echo "$SECRET_IN_DIFF"
fi

# 11. Check next.config.ts has security headers
echo ""
echo "--- Security Headers ---"
if grep -q "X-Frame-Options" next.config.ts 2>/dev/null; then
    echo -e "${PASS} X-Frame-Options header configured"
else
    echo -e "${WARN} X-Frame-Options header not found in next.config.ts"
fi

if grep -q "X-Content-Type-Options" next.config.ts 2>/dev/null; then
    echo -e "${PASS} X-Content-Type-Options header configured"
else
    echo -e "${WARN} X-Content-Type-Options header not found in next.config.ts"
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
