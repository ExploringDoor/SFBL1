# League Platform

Multi-tenant SaaS platform for amateur sports leagues. One codebase, many leagues.

**Status:** Pre-MVP — scaffolding only. See `PLAN.md` for the full architecture spec.

## Quick reference

- **Architecture spec:** `PLAN.md` (read this first, always)
- **Tenants planned:** SFBL (baseball, tenant #1), KCSL (softball, tenant #2), Long Beach (migrating in offseason after Aug 8 2026)
- **DVSL stays standalone** — never migrate during season
- **Backend:** Firebase (Firestore + Auth + FCM + Cloud Functions)
- **Frontend:** Next.js 14 App Router + TypeScript + Tailwind
- **Hosting:** Vercel (wildcard subdomains + custom domains)
- **Billing:** Manual (Zelle/Venmo). Stripe deferred to v2.

## Reference codebases (read patterns from these, do NOT copy code)

- `~/Desktop/softball-site/` — DVSL, the polished softball reference
- `~/Desktop/Long-Beach-Men-s-Baseball/` — Long Beach, the polished baseball reference (Supabase-based, port patterns to Firebase)

## What NOT to do

- Don't touch DVSL during the build. It's in production, in-season.
- Don't touch Long Beach until after Aug 8 (their season ends).
- Don't skip the security rules emulator test suite. That's the one thing that can't be cut.
- Don't add Stripe in MVP. Manual billing only until tenant 5+.

## First milestone

SFBL skeleton tenant rendering at `sfbl.localhost:3000` — middleware reads hostname, looks up tenant in Firestore, renders hello-world page with sport config from tenant doc.

Once that works, the hardest architectural threshold is crossed. Everything after is feature work.
