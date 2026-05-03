# Instructions for Claude Code

You are building a multi-tenant SaaS platform for amateur sports leagues. Read `PLAN.md` first, every session, before doing anything. It contains the full architecture spec, feature cut, timeline, and pattern transfer checklists.

## Critical principles

1. **Multi-tenant from line 1.** Every Firestore query, every auth check, every API route must scope to a `leagueId`. There is no "we'll add tenancy later" — that's how data leaks happen.

2. **Security rules + emulator tests are non-negotiable.** Before any tenant goes live, the emulator test suite must pass: cross-tenant read attempts blocked, captain-of-wrong-team blocked, expired claims rejected, admin-only paths gated. This is the one thing that cannot be cut.

3. **DVSL is the reference implementation.** Read patterns from `~/Desktop/softball-site/` (vanilla HTML + Firebase). Don't copy code — extract the pattern, rebuild in Next.js + TypeScript idiom.

4. **Long Beach is the secondary reference.** Read patterns from `~/Desktop/Long-Beach-Men-s-Baseball/src/App.jsx` (React + Supabase). Particularly: `RichTextEditor`, `cleanName`, `cleanHeadline`, `sanitizeHTML`, sub board, ICS feeds, multi-season history.

5. **Adam directs, Claude builds.** Adam doesn't write code by hand. He reviews, tests, and gives feedback. Build incrementally — show what works after each piece, don't pile up huge unverified changes.

6. **Never touch DVSL or Long Beach repos.** They're in production. This platform is greenfield.

## Tech stack (locked)

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Firebase (Firestore, Auth, FCM, Cloud Functions, Emulator Suite)
- Vercel (wildcard subdomains + custom domains)
- DOMPurify for sanitizing admin-edited content
- React 18

## Tech NOT to use (yet)

- **No Stripe.** Manual billing via Zelle/Venmo until tenant 5+.
- **No PostHog/Segment/analytics.** Defer until v2.
- **No Sentry yet** — log errors to a `/errors` Firestore collection, view in platform admin dashboard.
- **No state management library** (Redux, Zustand). React state + Firebase real-time is enough.

## Build order (follow this)

Phase 0: Skeleton
- Next.js project bootstrapped
- Firebase SDK initialized with placeholder env vars
- Tenant middleware stub (logs hostname, no lookup yet)
- Hello-world home page

Phase 1: Tenant routing
- Firestore tenant config schema
- Middleware reads Host → looks up tenant in Firestore → injects tenant context
- Edge Config caching

Phase 2: Auth + claims
- Firebase Auth with email magic links
- Custom claims via Cloud Function (`leagues: { sfbl: 'admin' }`)
- Security rules with leagueId scoping
- Emulator test suite (cross-tenant, captain-wrong-team, expired claims, admin paths)

Phase 3: Sport variants
- Sport config wired through linescore + box score editor
- Stat math extracted to `/lib/stats/{softball,baseball}.ts`
- Contract tests per sport

Phase 4: Core features (MVP cut from PLAN.md)
- Standings (with division filter)
- Schedule
- Scores display
- Teams + Players pages
- Captain portal (lineup + box score editor)
- 3-lane scoring (admin/home/away)
- Leaderboards
- PWA shell

Phase 5: Admin + content editing
- Rich text editor (LB pattern, DOMPurify sanitized)
- Per-page content CRUD
- Theming (CSS vars from tenant config)
- Platform admin dashboard at `/_platform`
- Feature flag plumbing

Phase 6: Onboarding + provisioning
- CSV import (templates, validation, dry-run, idempotent)
- Provisioning script (`npm run provision`)
- Onboarding intake form
- Manual billing tracker

## What "done" looks like for MVP

SFBL provisioned at `sfbl.leagueengine.com` (or whatever domain), real teams imported via CSV, captains can submit box scores, standings calculate correctly, commissioner can edit page content inline, security rules tests pass in CI. That's it. Ship to SFBL.

## Always

- Read `PLAN.md` at the start of every session
- Use TypeScript strict mode
- Sanitize all admin-edited HTML with DOMPurify before storing
- Scope every Firestore query by leagueId
- Write a security rules test before changing security rules
- Show diffs and explain changes; don't just apply silently
