# LeagueEngine — Architecture Plan

> Single source of truth for building LeagueEngine. Created from the Opus
> architecture chat on 2026-05-02. When you start Claude Code in
> `~/Desktop/league-engine/`, point it at this file first.

---

## Original Brief (sent to Opus)

### Who I am
Solo builder. I run 3 amateur sports league sites in production and just signed a 4th. Each is its own Next.js + Firebase + Vercel codebase. Every bug fix has to be ported 3–4 times. I want to consolidate into one multi-tenant SaaS and grow it into a real side business (10+ leagues, $700–$1,500/yr each).

### What I have today

| League | Sport | Teams | Status |
|---|---|---|---|
| **DVSL** (Delaware Valley Softball) | Softball | ~30 | Production, in-season, paying. Stays standalone. Migration not required. |
| **Long Beach** | Baseball | TBD | Production, in-season, paying, 4 weeks into season. Stays standalone. Migration not required. |
| **SFBL** (South Florida Baseball) | Baseball | 27 (3 divs) | Skeleton only, no real data. Will be tenant #1 in LeagueEngine. |
| **KCSL** (Kings County Softball) | Softball | 41 (5 divs) | Skeleton only, no real data. Will be tenant #2 in LeagueEngine. |

**Migration burden: zero.** Building LeagueEngine fresh. SFBL and KCSL provision in once it's ready. DVSL and Long Beach stay standalone as production labs — features ship there first, then port to LeagueEngine.

### Reference implementation: DVSL — what's actually in production

Public side: single-page shell with hash-routed sections (home, players, teams, recaps, leaders, scores/schedule, stats, standings, rules, photos, registration, playoffs) — content fragments lazy-loaded on first nav. ESPN-style live ticker. Standings with division filtering, schedule, leaderboards, recap cards, photo gallery, rules with sticky TOC, registration with multi-step waiver + signature, playoff brackets with year toggle. PWA with versioned service worker (v264), offline support, FCM push.

Admin dashboard: game entry, roster management, division setup. Box score upload: PDF → Claude Vision API → parsed JSON → reviewed → committed. MailerLite proxy, x-admin-secret header on API routes. Auto stats recalc trigger on every score path.

Captain portal: tap-to-order batting lineup. Live box score editor (AB, R, H, 2B, 3B, HR, RBI, BB, SO, SB, PB). Auth-to-player auto-link backfill on first roster touch. Stats recalc on submit so leaderboards update immediately.

3-lane scoring architecture (the crown jewel): admin / home / away each have private write lanes. Conflict resolution UI when home and away submit different totals. Score-only fallback when innings detail missing.

Data integrity discipline: 13-dimension audit (game/box_score score parity, schedule fields, day-of-week vs date, time_24, field/address mapping, player stats, standings, wk validity, score range, refs, admin draft) — all clean. Stored XSS prevention via `esc()` helper, textContent-based escaping. One-time migrations live in `/scripts/`.

What DVSL is NOT (and what LeagueEngine has to add): LEAGUE config is hardcoded in `config.js` — no concept of tenants. One Firebase project, one Vercel deployment, one domain. No billing, no onboarding, no per-tenant theming pipeline. Auth has no leagueId claim. Softball-specific assumptions baked in.

### Constraints
- Work in Claude Code on Mac (not Terminal). I direct Claude Code to build, don't hand-write much code.
- Comfortable: Next.js, Firebase, Vercel, GitHub via Claude Code
- Less comfortable: DNS at scale, multi-tenant auth/security rules, Stripe billing, support tooling
- DVSL is in-season and **cannot break**. SFBL/KCSL/Long Beach can move on my timeline.

---

## Opus's Final Architecture Decisions

### 1. Tenancy Model

**Vercel middleware, hostname → leagueId, Edge Config as cache.**

```
sfbl.leagueengine.com → middleware → x-tenant=sfbl → /[tenant]/...
sfbl.com (custom)     → middleware → Edge Config lookup → same
```

- Single Vercel project, wildcard subdomain on `*.leagueengine.com`
- `middleware.ts` reads `req.headers.host`, strips the apex, looks up tenant
- Edge Config holds `{ "sfbl.com": "sfbl", "sfbl.leagueengine.com": "sfbl", ... }` — populated by provisioning script, ~1ms lookup
- Cache miss → Firestore lookup → write back to Edge Config
- Set `x-tenant` header on the rewritten request, available to every route via `headers()` in server components

Custom domains via Vercel Domains API. Tenant adds `sfbl.com` in admin UI → code calls `POST /v9/projects/{id}/domains` → display CNAME instructions → Vercel issues cert automatically. ~50 lines including verification polling.

**Skip path-based tenancy entirely.** Subdomains look like real league sites; custom domains look indistinguishable from a bespoke build — which is the product.

### 2. Data Isolation

> **`firestore.rules` is the canonical source of truth for what's allowed
> where. This section is reconciled to match it.** When rules and PLAN
> drift, update rules first, then update this section. Last reconciled:
> 2026-05-02.

**Single Firebase project. `leagues` map in custom claims. Security rules enforce.**

Schema (R = read, W = write; "self" means the user holding the matching
`player:` or `captain:` claim):

```
/leagues/{leagueId}                                   R: public        W: admin
/leagues/{leagueId}/teams/{teamId}                    R: public        W: admin
/leagues/{leagueId}/teams/{teamId}/_private/{doc}     R: admin+captain W: admin+captain
/leagues/{leagueId}/games/{gameId}                    R: public        W: admin
/leagues/{leagueId}/games/{gameId}/_private/{doc}     R: admin         W: admin
/leagues/{leagueId}/box_scores/{gameId}               R: public        W: admin OR captain-of-game
/leagues/{leagueId}/lineups/{gameId_teamId}           R: public        W: admin OR captain-of-team
/leagues/{leagueId}/players/{playerId}                R: public        W: admin
/leagues/{leagueId}/players/{pid}/_private/{doc}      R: admin+self    W: admin+self
/leagues/{leagueId}/recaps/{gameId}                   R: public        W: admin
/leagues/{leagueId}/standings/{divisionId}            R: public        W: admin    (denormalized)
/leagues/{leagueId}/page_content/{pageId}             R: public        W: admin
/leagues/{leagueId}/audit/{logId}                     R: admin         W: server-only (Cloud Function)
/leagues/{leagueId}/billing_history/{entryId}         R: admin         W: server-only

/users/{uid}                                          R/W: own profile only
/domains/{hostname}                                   R: public        W: server-only
/errors/{errorId}                                     R: server-only   create: authenticated; no update/delete
```

**Public-read pattern.** Public-facing collections are world-readable
because the league site is a public website (DVSL is the model). PII —
phone numbers, emails, DOB, internal notes — never lives on these docs.
It lives in a sibling `_private/{doc}` subcollection gated by claims.
**This is a convention enforced by the rules tests, not the type system.**
CSV imports and admin UIs must split fields accordingly.

**Public-read on `/leagues/{id}` and `/domains/{hostname}` is intentional**
— the Edge middleware (which runs pre-auth) needs to resolve tenants from
hostname. A slimmed `PublicLeagueConfig` (no `billing.notes`, no payment
dates) gets injected into request headers; full billing detail re-fetches
server-side.

**Default deny.** Any path not explicitly matched is denied for both read
and write. Adding a new collection requires adding a `match` block AND
extending `tests/rules/deny-default.test.ts`.

Custom claims, set by Cloud Function on user creation and role changes:
```js
{
  leagues: {
    sfbl: 'admin',
    kcsl: 'captain:team_42',
    dvsl: 'player:player_1138'
  }
}
```

Helpers in `firestore.rules`:
- `leagueRole(leagueId)` → role string for that league or null
- `isAdmin(leagueId)` → role == 'admin'
- `captainTeamId(leagueId)` → team id if role matches `^captain:[^:]+$`, else null
- `isCaptainOfGameTeam(leagueId, gameId)` → fetches game, checks captain owns home or away team
- `isSelfPlayer(leagueId, playerId)` → role == 'player:' + playerId

Example rule for the captain-of-game box-score write:
```
match /leagues/{leagueId}/box_scores/{gameId} {
  allow read: if true;
  allow write: if isAdmin(leagueId)
              || isCaptainOfGameTeam(leagueId, gameId);
}
```

**Write rule unit tests against the Firebase emulator before SFBL goes live. Non-negotiable.** Half a day for a proper test suite covering: cross-tenant read attempts, captain editing wrong team's box score, captain editing other league's box score, expired claim refresh, admin-only paths.

### 3. Sport Variants

**Config object on the league doc. Single template. Stat math dispatched by sport.**

```js
// /leagues/sfbl
{
  sport: 'baseball',
  innings: 9,
  ruleset: 'hardball',
  stat_columns: ['AB','R','H','2B','3B','HR','RBI','BB','SO','SB'],
  pitching: { tracked: true, columns: ['IP','H','R','ER','BB','SO','HR'] },
  rules_flags: { dropped_third_strike: true, balks: true, infield_fly: true },
  linescore_innings: 9,
}

// /leagues/dvsl-clone-for-testing
{
  sport: 'softball',
  innings: 7,
  ruleset: 'slowpitch',
  stat_columns: ['AB','R','H','2B','3B','HR','RBI','BB','SO','SB','PB'],
  pitching: { tracked: false },
  rules_flags: { dropped_third_strike: false, balks: false },
  linescore_innings: 7,
}
```

Stat math extracted to:
```
/lib/stats/
  index.ts          → dispatch by sport
  softball.ts       → hits, HR, BA, SLG, OBP, the PB column
  baseball.ts       → adds ERA, WHIP, pitching line aggregation
  shared.ts         → standings calc (W/L/T, run diff, head-to-head)
```

Same interface: `recalcLeague(leagueId)` reads config, dispatches. Contract tests for each sport.

### 4. Onboarding — Intake Form (NOT self-serve)

**Move onboarding wizard into MVP. It's an intake form, not self-serve provisioning.**

What goes in MVP:
- Public marketing page at `leagueengine.com` with "Start your league" CTA
- Intake form: league name, slug, sport, division count, expected team count, admin email, custom domain (optional), color preferences (primary + accent), Stripe checkout button
- Form submit → creates `pending_tenants` doc → emails Adam → run `npm run provision --from-pending {id}` → script reads doc, provisions, sends magic link to commissioner
- Commissioner's first login lands on CSV import page

**You're still pulling the trigger.** True self-serve is v3 territory.

CSV import is the highest-leverage code in MVP. Every tenant uses it. Build:
- Templates downloadable from admin UI
- Server-side validation with row-level errors ("row 47: team_name 'Sluggrs' not found, did you mean 'Sluggers'?")
- Dry-run mode
- Idempotent: re-running with same CSV updates rather than duplicates

### 5. Billing — Manual via Zelle/Venmo (no Stripe in MVP)

**Pricing model:**
- **Build fee: $1,500 one-time** — domain setup, theming, CSV import, training, first month support
- **Season fee: $350 per season** — hosting, ongoing support, season-specific work
- Payment via Zelle or Venmo. No Stripe, no PCI scope, no 2.9% fee.

**Why this works for solo builder under 10 tenants:**
- League budgets are per-season anyway; matches their cash flow
- Zero billing infrastructure to build, debug, or maintain
- Saves ~10 hours of MVP work (no webhook plumbing, no test mode debugging)
- Adam invoices manually via email before each season start

**Lifecycle (manually managed):**
- Adam emails invoice 4 weeks before season start
- Commissioner pays Zelle/Venmo
- Adam manually flips `/leagues/{id}/billing` doc:
  ```
  { status: 'paid', paid_through: '2026-fall-season', last_payment: '2026-08-15' }
  ```
- Day 0 of unpaid season: site goes read-only (banner "League has not renewed")
- Captain texts Adam, sends payment, Adam flips flag back to active
- No archive flow needed — they come back next season or they don't

**Admin UI for billing (in MVP platform admin dashboard):**
- Tenant list shows billing status + paid_through date
- One-click toggle to flip status
- Note field for tracking ("paid via Venmo 8/15/26")

**When to revisit Stripe:** tenant 5+, or when payment chasing becomes more painful than the integration cost. Likely 12-18 months out, not a v1 concern.

**The piece to bake in NOW:** every league config doc has a `billing` field from day 1 (status, paid_through, last_payment, notes). Middleware reads `billing.status` and gates write access. This way, when you do add Stripe later, it just writes to the same field — no schema migration.

### 6. Platform Admin Dashboard (MVP)

`/_platform` route, gated on Adam's specific UID (hardcoded), shows:
- Tenant list: slug, name, sport, team count, subscription status, last write timestamp
- Click tenant → recent errors, recent box score submits, recent admin logins
- "Impersonate" button — sets session claim to view tenant as admin (logs to `/platform_audit`)
- Errors view: `/errors` collection, last 100, dismissable

Without this: SSH into Firebase console at 9pm. With it: open one URL on phone.

### 7. Feature Flags (MVP, minimal)

In the existing config doc:
```js
// /leagues/{id}/config
{
  ...,
  flags: {
    new_box_score_editor: false,
    pdf_vision_upload: false,
    fcm_push: false,
  }
}
```

Code reads `config.flags.X ?? false`. New features ship behind a flag, default off, flipped on per-tenant from platform admin dashboard. DVSL and Long Beach become natural canary tenants when eventually unified.

**Don't build:** percentage rollouts, A/B testing, flag analytics, LaunchDarkly. Boolean per tenant. That's it.

### 8. Risks (ranked by likelihood to bite)

1. **Support burden** — first Saturday of SFBL playoffs, 5 Slack messages from commissioner. Set expectations in contract: 48hr response, no SLA on weekends. `support@leagueengine.com` inbox before tenant #2.
2. **Security rules bug leaks data across tenants** — emulator tests in CI, blocking on merge.
3. **Minors' data — COPPA and state privacy laws** — registration form detects DOB, routes minors through parental email confirmation, no behavioral analytics on those accounts. Privacy policy reviewed by lawyer once ($500–$1,000).
4. **Waiver liability** — waiver text is editable per-league and the league's text, not yours. TOS makes clear LeagueEngine is platform, not organizer.
5. **Captain abuse** — auto-link only when auth email matches email field on admin-uploaded roster CSV. No email match = manual claim flow.
6. **Stripe Connect temptation** — say no for v1. Player fees go through Stripe/PayPal/Zelle directly.
7. **"I want my data" exit** — `GET /api/admin/export` streams zip of CSVs per tenant. One afternoon.
8. **Vercel/Firebase costs at 10 tenants** — non-issue. ~$10–20/month.
9. **100-team tenant** — denormalized standings via Cloud Function, debounced, triggered on box_score writes. Don't build now. Note it.
10. **"We want our own theme" tenant** — `{ primary, secondary, accent, logo_url }` on config doc, applied via CSS variables. Custom font/layout = $500 custom job.

### 9. Deployment Lifecycle

**Two Firebase projects, never one.**

| Project ID                | Role     | What's allowed                              |
|---------------------------|----------|---------------------------------------------|
| `leagueengine-staging`    | staging  | Schema/rules changes land here first.       |
| `league-platform-5f3c8`   | prod     | Real tenants. Rules promoted from staging.  |

`.firebaserc` aliases both as `staging` and `prod` so the CLI flags read
naturally:
```
npm run rules:deploy:staging   # firebase deploy --only firestore:rules --project staging
npm run rules:deploy:prod      # ...                                   --project prod
```

**Rules promotion checklist** (run for any change to `firestore.rules`):

1. Modify `firestore.rules` + extend `tests/rules/*` with regression cases.
2. `npm run test:rules` — local emulator suite must be green.
3. CI runs the same suite on every PR (`.github/workflows/ci.yml`).
4. Merge to `main`.
5. `npm run rules:deploy:staging` — push to staging.
6. Smoke test against staging Firestore (manual: hit the page, hit the
   captain portal once Phase 2b lands, run an integration test if one exists).
7. `npm run rules:deploy:prod` — promote to prod. Watch the platform admin
   dashboard for elevated permission-denied rates over the next hour.

**Rollback:** keep the previous `firestore.rules` in git. `git checkout
HEAD~1 firestore.rules && npm run rules:deploy:prod`. Cloud Functions
deploys are similar (`functions:deploy --project ...`).

**Why not single-project + branch-based deploy:** Firebase rules deploy
is a single-target operation per project. Without a separate staging
project, every rules change is tested in prod with real tenant data —
unacceptable. Cost of staging: ~$0/month while idle (free tier covers it).

---

## Feature Cut Checklist

| Feature | Cut |
|---|---|
| Hash-routed unified shell | **MVP** |
| Standings (with division filter) | **MVP** |
| Schedule | **MVP** |
| Scores display | **MVP** |
| Teams pages | **MVP** |
| Players pages | **MVP** |
| Admin game entry | **MVP** |
| Captain portal — lineup (tap-to-order) | **MVP** |
| Captain portal — box score editor | **MVP** |
| 3-lane scoring (admin/home/away) | **MVP** |
| Leaderboards | **MVP** |
| PWA shell + offline support | **MVP** |
| Per-tenant theming (primary/accent CSS vars) | **MVP** |
| Rules page (markdown per tenant) | **MVP** |
| Platform admin dashboard | **MVP** |
| Feature flags (boolean per tenant) | **MVP** |
| Onboarding intake form | **MVP** |
| Recap cards | **v1** |
| ESPN-style live ticker | **v1** |
| Playoff brackets | **v1** |
| Photo gallery | **v1** |
| Multi-step registration with waiver + signature | **v1** |
| FCM push notifications | **v1** |
| PDF box score upload via Claude Vision | **v2** |
| MailerLite newsletter integration | **v2** |
| Custom domain support | **v2** |
| Per-tenant audit log | **v2** |
| Stripe Connect for player fees | **never** |

**SFBL commissioner must see this before go-live.** Frame it as "phase 1 ships with X, phases 2 and 3 ship across the season at no extra cost."

---

## Timeline — 12 Weeks Realistic

Plan for 12, target 10, accept 14. Evening capacity is 8–12 hrs/week.

| Workstream | Hours |
|---|---|
| Vercel middleware + hostname routing + Edge Config | 8 |
| Custom claims + security rules + emulator test suite | 16 |
| Tenant config schema + sport variant wiring | 10 |
| Stat math extraction (softball + baseball modules) | 12 |
| CSV import (templates, validation, dry-run, idempotent) | 14 |
| Provisioning script | 6 |
| Manual billing tracking (config field + admin toggle) | 2 |
| MVP feature cut (standings, schedule, scores, captain portal, theming, rules) | 30 |
| Platform admin dashboard | 8 |
| Feature flag plumbing | 2 |
| Onboarding intake form | 8 |
| Testing, polish, things you forgot | 16 |
| **Total** | **~140 hours** |

At 10 hrs/week → 14 weeks. At 12 hrs/week → 12 weeks. At 14 hrs/week (sprint) → 10 weeks.

**Don't compress by cutting the security rules test suite.** That's the one thing that can't be cut.

**SFBL deadline check:** confirm with commissioner. If "next season" (April 2027), 6-month buffer. If "this fall," tight.

---

## Phased Build Plan

### MVP (12 weeks) — ship SFBL as tenant #1
- LeagueEngine repo, Next.js 14 App Router, TypeScript, Tailwind, Firebase
- Vercel middleware + hostname → leagueId
- Firestore tenant config doc, custom claims, security rules + emulator tests
- Sport config wired through linescore + box score editor
- Stat math extracted to `/lib/stats/{softball,baseball}.ts`
- Provisioning script (`npm run provision`)
- CSV import (templates, validation, dry-run, idempotent)
- Manual billing tracking via tenant config doc (no Stripe yet)
- Public marketing page + intake form
- Platform admin dashboard at `/_platform`
- Feature flag plumbing (boolean per tenant)
- Feature cut: standings, schedule, scores, captain portal, theming, rules

### v1 (next 2 months) — KCSL on, ready to sell tenant #3
- Custom domain support via Vercel Domains API
- Read-only mode on lapsed subscription
- Per-tenant rules markdown content
- Tenant CSV export
- `support@leagueengine.com` inbox
- Stripe customer portal wired
- Recap cards, ticker, playoff brackets, photo gallery
- Multi-step registration with waiver + signature
- FCM push

### v2 (when tenant 5 signs) — semi-self-serve
- Commissioner-facing onboarding wizard (still triggers manual provisioning)
- Denormalized standings via Cloud Function
- Per-tenant audit log
- **Stripe integration** — auto-invoice per season, customer portal, webhook → billing.status (replaces manual flip)
- PDF box score upload via Claude Vision
- MailerLite integration

### v3 (tenant 10+, only if demand pulls)
Don't plan it now.

---

## DVSL Pattern Transfer Checklist

When building LeagueEngine, read these from `~/Desktop/softball-site/` and rebuild
in multi-tenant idiom. **Extract the pattern, not the code.**

- `index.html` — hash-routed unified shell, lazy-loaded sections
- `index.html` — popstate hash-fallback (rules page anchor fix at ~line 4900)
- `captain.html` — auth-to-player backfill (`_backfillCaptainPlayerLink`)
- `captain.html` / `scorer.html` / `admin.html` — stats recalc trigger points (avoid the "stale until admin visits" trap)
- `admin.html` — 3-lane scoring write paths + conflict resolution UI
- `admin.html` — box score Vision API pipeline (PDF → JSON)
- `sw.js` — versioned service worker + CORE_URLS precache pattern (current v264)
- All HTML — `esc()` helper + textContent-based XSS escaping
- `scripts/` — 13-dimension data integrity audit pattern
- `api/` — `x-admin-secret` header pattern → **REPLACE** with claims-based auth in LeagueEngine

## Long Beach Pattern Transfer Checklist

Read from `~/Desktop/Long-Beach-Men-s-Baseball/src/App.jsx`. LB uses Supabase
(not Firebase) so you'll port the pattern, not the queries.

- `RichTextEditor` + `RichTextInput` — inline editable rich text per page block
- `sanitizeHTML` + DOMPurify — XSS sanitization for admin-edited HTML
- `getPageContent` / `savePageContent` + debounce — page content CRUD
- `cleanName` — Unicode whitespace normalization (NBSP splits caught 70+ player dupes)
- `cleanHeadline` — strip submission-tracking metadata before public render
- Sub Board page — substitute player availability board (LB-unique feature)
- ICS feed (`api/schedule.ics.js`) — per-team calendar subscriptions
- Multi-season History archive pattern (`historyData.js` data shape)
- POTG (Player of the Game) calculation — `calcPOTG` from box score data
- `buildRealRecap` — auto-generate recap text from box scores
- Image compression on upload (`compressImageToBlob`) — 1400px max, 0.82 quality
- Two-division handling (Spring/Summer + Boomers) — natural multi-division pattern

## "Every Page Editable in Admin" — MVP requirement

Commissioners edit their own content. Adam does not become a content monkey.

**Pattern (lifted from Long Beach):**

```
/leagues/{leagueId}/page_content/{pageId}
  blocks: [
    { id: 'hero', type: 'rich_text', html: '<h1>...</h1>' },
    { id: 'about', type: 'rich_text', html: '<p>...</p>' },
    { id: 'sponsors', type: 'sponsor_grid', items: [...] },
  ]
```

- Logged-in admin sees "Edit this page" toggle in corner of every page
- Click block → inline RichTextEditor opens
- Type → debounced save (1.5s) → DOMPurify sanitize → write to Firestore
- Public visitors see rendered (sanitized) HTML
- Works for: home page hero, rules, sponsors, contact, field directions, announcements, league info

**Form-based admin (not rich text):**
- Schedule (game add/edit/delete forms)
- Rosters (player CRUD or CSV)
- Scores (existing box score editor)
- Theming (color picker, logo upload)
- Captain accounts (invite, remove, role changes)

**Why MVP, not v1:** this feature *is* the business model. Without it, every league = ongoing manual content work for Adam. With it, setup = 4-6 hours then commissioner is self-serve.

## Business Model — Hands-off After Setup

| Activity | Adam | Commissioner |
|---|---|---|
| Initial roster + schedule import | ✅ | — |
| Theming (colors, logo) | ✅ | — |
| Domain setup | ✅ | — |
| Stripe configuration | ✅ | — |
| Captain training | shared | shared |
| Page content edits (rules, sponsors, announcements) | — | ✅ |
| Roster updates mid-season | — | ✅ |
| Schedule changes | — | ✅ |
| Score entry / box scores | — | captain or commissioner |
| Payment tracking | — | ✅ |
| Captain support | — | ✅ (escalate to Adam only for platform bugs) |

**Target per-tenant time after setup:** 1-2 hours/month. Anything more breaks the unit economics.

**Setup fee ($350-500):** covers the hands-on work. Non-refundable.
**Annual ($1,500):** hosting, support, platform improvements, processing.

If a commissioner cannot operate the site themselves after 30 min of training, the platform is built wrong. Bar is: "easier than LeagueLineup."

---

## What NOT to do

- Don't open the Opus chat again unless you hit a *specific* decision point.
- Don't try to build everything in week 1. 12-week ladder. One rung at a time.
- Don't touch DVSL or Long Beach. They're production. LeagueEngine is greenfield.
- Don't compress timeline by cutting security rules tests.

---

## First Milestone (target: end of week 2)

SFBL skeleton tenant provisioned at `sfbl.localhost:3000` (or `sfbl.leagueengine.com` if domain bought). Middleware reads hostname, looks up `sfbl` in Firestore, renders hello-world page that says "South Florida Baseball — 9 innings" pulled from tenant config doc.

Once that renders, you've crossed the hardest architectural threshold. Everything after is feature work.
