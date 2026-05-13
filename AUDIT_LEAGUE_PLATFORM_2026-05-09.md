# LeagueEngine audit — 2026-05-09

Comprehensive pre-launch audit of the multi-tenant Next.js 14 + Firebase
platform. Target: SFBL launch May 15, 2026 (6 days). Greenfield, no
production users yet.

Methodology: five parallel category audits (type-safety + app-router,
multi-tenant, auth + api, db + caching + perf, error + security + a11y
+ tests), plus aggregator covering deps + pre-launch + DX. Sub-agents
read DVSL_REVIEW_NOTES.md and PRELAUNCH_AUDIT.md first; findings that
were already closed there are not re-flagged.

---

## Ship blockers (must fix before SFBL launch)

### [B1] Auth — `/api/send-notification` lets any captain or player blast arbitrary push to entire league
- **File:** `app/api/send-notification/route.ts:99-128`
- **What:** Auth check is `if (!callerLeagues?.[leagueId])` — any user with *any* claim (captain or player) on the league can send a push to the entire league with attacker-controlled title/body/category. Only `adminOnly: true` gating is recipient-side (filtered out by `is_admin` check), and an attacker just omits that field.
- **Evidence:**
  ```ts
  const callerClaim = leagues?.[leagueId];
  if (!callerClaim) {
    return NextResponse.json({ error: `Caller has no role in league…` }, { status: 403 });
  }
  // No role narrowing — captain or player passes. title/body fully attacker-controlled.
  ```
- **Recommended fix:** require `callerClaim === "admin"` for the public categories (`scores`, `schedules`, `playoffs`, etc.). For `team_chat` / `captains_chat`, narrow to "caller can only target their own team / captains group" — already partly done in `chat-message`, but `send-notification` is a separate raw entry point. Best path: make `send-notification` an *internal* endpoint (callable only from `chat-message`, `captain-submit`, `captain-schedule`, cron — via a shared internal secret) instead of exposing it to direct user calls at all.

### [B2] Auth — Notification `url` field is not allowlisted; in-app inbox renders attacker-controlled hrefs as league-styled links
- **Files:** `app/api/send-notification/route.ts:142`, `components/profile/InboxPanel.tsx:198`
- **What:** `raw.url` flows through `send-notification` with no validation (`url: typeof raw.url === "string" ? raw.url : undefined`) and into `pending_nav`. The Service Worker `notificationclick` handler clamps to same-origin (`public/firebase-messaging-sw.js:199-207`) — that path is fine. But `InboxPanel` renders the URL as `<Link href={it.url || "/"}>` with **no clamp**. Every league user with notification subscription receives a clickable inbox item that can navigate to any external domain.
- **Evidence (InboxPanel.tsx:198):**
  ```tsx
  <Link href={it.url || "/"} className="inbox-link" onClick={...}>
    <span className="inbox-title">{it.title}</span>
  ```
- **Recommended fix:** validate at write time in `send-notification` that `url` is empty, starts with `/`, or starts with the tenant's own origin. SW already has the pattern; lift it server-side. Compounded with B1 this is the highest-priority pair.

### [B3] Auth — `/api/errors-log` is unauthenticated, no rate limit, writes via Admin SDK
- **File:** `app/api/errors-log/route.ts:28-65`
- **What:** Public POST, no `Authorization` check, no rate limit. Uses `getAdminDb()` (bypasses Firestore rules). `firestore.rules:387` says `errors` writes require `request.auth != null` — Admin SDK ignores rules. Any internet user can `POST /api/errors-log` and stuff ~20KB docs into `/errors` indefinitely. No per-tenant scope means cleanup is global; Firestore quota + write costs accumulate.
- **Evidence:**
  ```ts
  // Public-write — anyone can POST. We don't trust the body…
  await db.collection("errors").add({ message, … });
  ```
- **Recommended fix:** either (a) require bearer token + `verifyIdToken` (matches the rules-stated `request.auth != null` posture), or (b) keep public but add the in-memory per-IP rate limit from `league-form/route.ts:143-183` (5 / 10 min) plus a daily cap.

### [B4] Multi-tenant — `/api/league-form` reads `x-tenant-id` from request headers, but middleware doesn't run on `/api/*`
- **File:** `app/api/league-form/route.ts:162-166`
- **What:** Middleware is intentionally excluded for `/api/*` (PRELAUNCH Fix #2). `headers()` in an API route returns only the *incoming* request headers — middleware-injected `x-tenant-id` is never present. Two outcomes, both bad:
  1. The four public intake forms (`/team-registration`, `/player-registration`, `/team-waiver-form`, `/umpire-evaluation-form`) never send `x-tenant-id` → **all four return 400 in production**.
  2. A client that *does* send `x-tenant-id: <any-tenant>` is trusted (no host validation, no claim check) → writes form submissions into any tenant.
- **Evidence:**
  ```ts
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  if (!tenantId) return NextResponse.json({ error: "no tenant" }, { status: 400 });
  ```
- **Recommended fix:** resolve tenant from `Host` header the way `app/api/schedule.ics/route.ts:20-29` does (`parseHost` + `resolveTenant`). Never trust client-supplied `x-tenant-id` in `/api/*`. Verify with `grep -rn "x-tenant" app/api/` — must be zero hits — and add as a CI guard.

### [B5] Multi-tenant — `/api/player-link` writes to another tenant's player doc without claim check
- **Files:** `app/api/player-link/route.ts:59-66, 130-136`
- **What:** Takes `leagueId` from body, queries `leagues/${leagueId}/players` where `auth_uid == decoded.uid` or by email, then writes `auth_uid` + email into the matched player doc + `_private/contact`. No verification that the caller has any role in that `leagueId`. A signed-in user with an email match in another tenant can self-link into that tenant's player record. The link isn't a direct privilege escalation (downstream endpoints re-check claims), but it crosses tenant boundaries silently and violates CLAUDE.md's "every Firestore query scoped to leagueId" invariant.
- **Evidence:**
  ```ts
  const idToken = auth.slice("Bearer ".length).trim();
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  const leagueId = String(body.leagueId);
  // No claim check on leagueId before...
  const result = await playersRef.where("email", "==", decoded.email).limit(1).get();
  ```
- **Recommended fix:** require Host header to match the tenant's apex domain (mirror `schedule.ics`), OR require `decoded.leagues?.[leagueId]` to be set before allowing the link. The sibling `/api/captain-link` already gates correctly (`route.ts:62-67`) — model on that.

---

## High priority (fix soon after launch)

### [H1] Auth — `verifyIdToken` is never called with `checkRevoked=true`
- **Files:** 25+ routes under `app/api/*/route.ts` (e.g. `admin-grant-claim/route.ts:61`)
- **What:** Demoting an admin or revoking a captain claim leaves their ID token valid for up to 1 hour. They retain admin power for that window. `verifyIdToken(idToken, true)` enables `tokensValidAfter` checks.
- **Fix:** at minimum on high-trust mutating routes: `admin-grant-claim`, `admin-bulk-invite`, `admin-csv-import`, `admin-photo`, `admin-alert`, `live-score`, `captain-submit`, `captain-roster`, `send-notification`. Document why other routes opt out.

### [H2] Auth — `/api/admin-grant-claim` doesn't write to the audit log
- **File:** `app/api/admin-grant-claim/route.ts:178-191`
- **What:** Every other admin mutation writes to `/leagues/{id}/audit`. The endpoint that mutates Firebase Auth custom claims (grant admin, demote admin, change captain teams) writes nothing. No forensic trail on the highest-trust action in the system.
- **Fix:** add the same `audit.add({ kind: "grant_claim", by_uid, target_uid, target_email, role, claim_value, at })` block.

### [H3] Auth — `/api/parse-boxscore` has no rate limit; every captain token spends Anthropic budget
- **File:** `app/api/parse-boxscore/route.ts:84-92, 205-217`
- **What:** Admin or captain in any league can POST a PDF/image. Fans out to `api.anthropic.com/v1/messages` with `claude-sonnet-4-6`. Per-page cost. No body-size cap, per-uid cap, or per-tenant daily cap. Compromised captain credentials = unbounded spend.
- **Fix:** cap `pdfBase64`/`imageBase64` size; per-uid in-memory rate limit (10 / 5 min); per-tenant daily cap in `leagues/{id}/_private/ocr_quota`.

### [H4] Auth — `/api/auth-bridge/create` allows bridge doc overwrite (session-fixation via bridgeId)
- **File:** `app/api/auth-bridge/create/route.ts:74-82`
- **What:** Endpoint accepts any valid bearer + a `bridgeId`, writes `auth_bridges/{bridgeId}` with the caller's custom token. No check that bridgeId hasn't already been bound to a different uid. Attacker Alice who guesses (or intercepts via shared device or shoulder-surf) Bob's bridgeId from his magic link URL can overwrite the parked token; Bob's PWA polls `/claim` and signs in as Alice instead.
- **Fix:** use `.create()` instead of `.set()`, or do a read-then-write transaction that rejects when an existing doc's `uid` differs from the caller's. Bind bridge to the first uid that creates it.

### [H5] Auth — `auth_bridges` collection has no explicit Firestore rule
- **File:** `firestore.rules` (no `match /auth_bridges/...` block)
- **What:** Custom tokens (which exchange for full session) are parked in `/auth_bridges/{bridgeId}`. Default-deny at `firestore.rules:392-394` is the only protection. If anyone ever adds a permissive `match /{document=**}` rule (common debugging mistake), every authenticated user could read every parked custom token and impersonate any user mid-bridge.
- **Fix:** add an explicit `match /auth_bridges/{bridgeId} { allow read, write: if false; }` belt-and-suspenders deny.

### [H6] DB — `firestore.indexes.json` is empty (`{ indexes: [], fieldOverrides: [] }`)
- **File:** `firestore.indexes.json`
- **What:** Compound queries with range filters require explicit composite indexes; current production indexes file is empty. **Mitigation:** no `.where().orderBy()` compound queries found in code today (audit + ticker + notification queries are all single-field, which Firestore auto-indexes). Not currently failing in production. But the file is declared in `firebase.json` and will silently be deployed empty.
- **Fix:** even if no composite index needed today, leave a comment explaining "auto-indexes sufficient for current queries — add composite indexes here when adding orderBy+where" so a contributor doesn't add a compound query and hit a runtime 500.

### [H7] DB — `/errors` root collection is unbounded; `_platform-overview` reads ALL errors on every page load
- **File:** `app/api/_platform-overview/route.ts:115-116`
- **What:** `db.collection("errors").get()` — no `.limit()`, no `.where()`. Errors are append-only (`firestore.rules:378-385`) and accumulate across every tenant forever. Every visit to `/_platform` re-downloads the entire history.
- **Fix:** `db.collection("errors").orderBy("at", "desc").limit(50).get()`. Add a cleanup script that prunes errors older than N days.

### [H8] DB — Audit log read returns the entire collection then slices in memory
- **Files:** `app/api/admin-audit-log/route.ts:65-67`, `app/api/chat-message-delete/route.ts:222-234`
- **What:** `db.collection(`leagues/${leagueId}/audit`).get()` with in-memory sort + `.slice(0, limit)`. Comment claims "audit volume per league is bounded (a few hundred entries per season)" but the log accumulates every admin action across all seasons forever; no rotation.
- **Fix:** Firestore-side `.orderBy("at", "desc").limit(limit)`. Declare a composite `(kind, at desc)` index for filtered paths. Paginate the chat-message-delete clear-all loop.

### [H9] DB — Box-score page does a full-league `games` + `teams` + `players` scan on every visit
- **File:** `lib/box-score-data.ts:20-29`
- **What:** Every `/games/{gameId}` view pulls the full `games`, `teams`, AND `players` collections to compute team-record badges. With ~250 games + 200 players, a single box-score view = ~450 doc reads. A shared link going to 18 captains in iMessage on Sunday = ~8,100 reads.
- **Fix:** standings is small/stable — either cache `computeStandings(games)` in a 60s in-memory map keyed by leagueId, or write team records onto `/teams/{id}` from the same `recalcLeague` cycle that writes player stats. `/box_scores/{gameId}` only needs the two teams' records, not the full league.

### [H10] DB — `loadTickerGames` runs on every layout render with no caching; reads `games` + `teams` unbounded
- **Files:** `app/layout.tsx:172`, `lib/site-data.ts:32-39`
- **What:** Server-side every navigation. No `.limit`, no status filter. 200 game docs × 18 captains × 6 page views on Sunday ≈ 43k ticker-only reads in one game day.
- **Fix:** server-side in-memory TTL cache (30–60s) keyed by tenantId. Alternative: filter at query — `.where("status", "in", ["final", "approved", "scheduled", "live"]).orderBy("date", "desc").limit(20)`. Wrap in `<Suspense>` so a slow Firestore call doesn't stall every page.

### [H11] Type safety — `SubscribeCalendar` builds anchor `href`s from `window.location.host` during render → SSR hydration mismatch
- **File:** `components/SubscribeCalendar.tsx:24-69`
- **What:** Server renders `href="https://calendar.google.com/calendar/r?cid="` (empty cid) and `href="webcal://"` (empty host). Client hydration replaces — React 18 warns in dev and may discard SSR markup. Tapping the Apple link pre-hydrate navigates to `webcal://` with no path.
- **Fix:** render after mount (`const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])`), or pass host as a prop from the server component that includes this widget.

### [H12] A11y — `<Modal>` has no focus management or focus trap
- **File:** `components/Modal.tsx:15-91`
- **What:** Has `role="dialog"` + `aria-modal="true"`, but (a) focus is never moved into the dialog on open, (b) focus is never restored on close, (c) Tab cycles out into the visually-inert background. `dialogRef` is declared on line 17 but never used. Used by player/game parallel-route modals — keyboard and screen-reader users land on hidden background content.
- **Fix:** focus the close button on mount; trap Tab inside the dialog; restore focus to the opener on unmount. WAI-ARIA Authoring Practices dialog pattern.

### [H13] Errors — Service Worker `push` parse failure shows notification titled "League" with empty body
- **File:** `public/firebase-messaging-sw.js:147-150`
- **What:** `try { payload = event.data ? event.data.json() : {}; } catch (_) {}` — silently swallows. Users see an empty mystery notification.
- **Fix:** `catch (e) { console.error("[sw] push parse failed", e); payload = { title: "New activity", body: "Open the league site to see what changed." }; }`

---

## Medium / nice-to-have

### [M1] Type safety — `Sport` discriminated union has no exhaustiveness check
- **Files:** `lib/stats/index.ts:103-108, 143-146, 232-236`; type at `lib/stats/index.ts:37`
- **What:** `if (sport === "softball") {…} else {…}` silently runs baseball aggregation for any future sport added to the union. PLAN §3 calls for adding sport variants — foreseeable.
- **Fix:** `assertNever(x: never)` helper + `if/else if/else assertNever(sport)`. Three call sites.

### [M2] Type safety — JSON.parse of historical archive trusted shape-blindly
- **File:** `app/teams/[teamId]/page.tsx:869-887`
- **What:** Try/catch covers parse failure but not shape failure. A row with `standings: null` hits `.length` and throws inside the server component → 500.
- **Fix:** defensive `if (!Array.isArray(block.standings) || block.standings.length === 0) continue;`.

### [M3] Type safety — Loose `as Record<string, number>` on stat reads admits string values silently
- **Files:** `app/teams/[teamId]/page.tsx:822, 843`; `app/players/page.tsx:85, 86`; `app/players/[playerId]/page.tsx:115, 116`; `app/@modal/(.)players/[playerId]/page.tsx:37, 38`
- **What:** Reducers wrap with `Number()` (safe), but display sites that pass `stats` directly to JSX (`{stats.hr}`) don't — a string slips through.
- **Fix:** `safeStats(data.stats)` validator at the read boundary.

### [M4] Type safety — `as BoxBatter[]` / `as BoxPitcher[]` trusts captain-submitted shape
- **File:** `lib/box-score-data.ts:71-94`
- **What:** Only `player_id` truthy-checked. Other fields typed `number` are actually `unknown` at runtime; rules don't validate shape on direct Web SDK writes.
- **Fix:** lightweight validator coercing numeric fields via `Number()` and dropping malformed rows.

### [M5] Multi-tenant — Dynamic regex construction in `isCaptainOfDocGame` relies on team_id slug discipline
- **File:** `firestore.rules:77`
- **What:** `docId.matches('^.+_' + teamId + '$')` — `teamId` interpolated from claim. If a captain claim contained regex metachars (e.g. `captain:a.*`), the regex would over-match. All production claim-set paths enforce `^[a-z0-9_-]+$`, but `scripts/grant-claim.ts:82` accepts the looser `^captain:[^:]+$`.
- **Fix:** tighten `validateRole` in `scripts/grant-claim.ts:80-88` to enforce `^captain:[a-z0-9_-]+$` / `^player:[a-z0-9_-]+$`.

### [M6] DB — No server-side caching layer; every page reads `games` + `teams` from Firestore
- **Files:** `app/standings/page.tsx`, `app/schedule/page.tsx`, `app/page.tsx`, `app/scores/page.tsx`, plus 4 more
- **What:** `grep "revalidatePath|revalidateTag|unstable_cache" app/ lib/` returns zero hits. Every page is `force-dynamic`, no shared cache. Costs scale linearly with traffic.
- **Fix:** thin `lib/server-cache.ts` with 30s in-memory TTL keyed by `(tenantId, "games" | "teams" | "players")`. Invalidate from captain-submit's last-write hook.

### [M7] DB — `/api/_platform-overview` does 3 sub-collection reads per tenant
- **File:** `app/api/_platform-overview/route.ts:85-109`
- **What:** `leaguesSnap.docs.map(async d => Promise.all([teams.get(), players.get(), games.get()]))`. At 5+ tenants this becomes expensive on every `/_platform` page load.
- **Fix:** denormalize counts to `/leagues/{id}.stats = { team_count, player_count, game_count }` updated by `recalcLeague`.

### [M8] Perf — Layout loads three Google Font families with 11+ weight files
- **File:** `app/layout.tsx:18-34`
- **What:** Inter (1) + Barlow_Condensed (6) + Oswald (4) = 11 separately-fetched font files on first paint. No preload for LCP fonts.
- **Fix:** audit which weights are actually used (`grep -rn "font-weight: [0-9]"`). Barlow_Condensed at 6 weights is likely overkill; cutting to 2 per family halves font payload.

### [M9] Perf — Hero LCP logo is raw `<img>` with no width/height/fetchPriority
- **Files:** `components/ui/Hero.tsx:67-68`, `components/ui/Ticker.tsx:75-76`
- **What:** No intrinsic dimensions → layout shift. No fetchPriority="high" → slow LCP. Logo dimensions are known (normalize-logos.js standardizes them).
- **Fix:** `<img width={N} height={M} fetchPriority="high" decoding="async" ...>` on the Hero img.

### [M10] Errors — No nested `error.tsx` boundaries for `/admin`, `/captain`, `/games/[gameId]`
- **What:** Any throw in these (highest-engagement routes) tears down the entire shell — nav, footer, theming — and shows generic error page.
- **Fix:** add `app/admin/error.tsx`, `app/captain/error.tsx`, `app/games/[gameId]/error.tsx` mirroring root's pattern but preserving shell + giving contextual CTAs.

### [M11] Security — `recapOverrideHtml` in BoxScoreContent renders stored HTML without re-sanitization
- **File:** `components/BoxScoreContent.tsx:201-210`
- **What:** HTML is sanitized once at write time in `/api/game-recap/route.ts:137`. If anyone updates `/recaps/{gameId}` via Admin SDK or a migration script that bypasses the API, unsanitized HTML renders. `HomepageBanner` re-sanitizes at render — this doesn't.
- **Fix:** `sanitizeHtml()` at render in `app/games/[gameId]/page.tsx:122` before passing to `BoxScoreContent`. Two-line change.

### [M12] Errors — `app/captain/page.tsx` silent catches on captain-link (the #3 captain support ticket in DVSL)
- **File:** `app/captain/page.tsx:209-211, 241-243`
- **What:** `await fetch("/api/captain-link", ...); } catch { /* non-fatal */ }` — discards response status. If the link fails, captain has no signal; they just see "no roster link" silently.
- **Fix:** check `res.ok`; surface `console.warn` with body for diagnostics; toast on persistent failure.

### [M13] Tests — No E2E test infrastructure (Playwright/Cypress)
- **What:** SHIPPING_CHECKLIST acknowledges visual smoke can't be automated. 781 unit/integration tests give zero coverage on PWA install, iOS push, magic link, login → captain dashboard, push subscribe + receive.
- **Fix:** post-launch v1: Playwright smoke for (1) magic-link sign-in stub, (2) captain dashboard renders scheduled game, (3) admin edits rules page → public read shows new HTML.

### [M14] Security — `/api/admin-bulk-invite` `continueUrl` is unvalidated
- **File:** `app/api/admin-bulk-invite/route.ts:113-116, 205-208`
- **What:** Admin sends `continueUrl: "https://phish.example.com/"`, every issued magic link redirects there. Firebase's authorized-domains list constrains for some flows but not `generateSignInWithEmailLink`. Admin-compromise blast radius.
- **Fix:** validate `continueUrl` starts with tenant's apex or `/`.

### [M15] Security — `/api/admin-photo` data-URL not validated as actually an image
- **File:** `app/api/admin-photo/route.ts:78-94`
- **What:** Check is `body.imageDataUrl.startsWith("data:image/")` — any string with that prefix passes. SVG-with-script is technically `data:image/svg+xml`. Today only rendered via `<img>` (XSS contained), but storing arbitrary blobs as images is fragile.
- **Fix:** reject `data:image/svg+xml`; validate base64 magic-number.

### [M16] Security — `/api/page-content` size cap is on raw HTML pre-sanitize
- **File:** `app/api/page-content/route.ts:77-86, 99-113`
- **What:** `MAX_BYTES = 500_000` checked against raw HTML before `sanitizeHtml`. 500KB of `<script>` payload writes successfully (sanitized into nothing), wasting Firestore storage.
- **Fix:** cap after sanitization, or cap both.

### [M17] DX — `LeagueConfig.flags` declared in types but never consumed
- **File:** `lib/types.ts:78`
- **What:** `grep -rn "config.flags\b\|\.flags\b" app/ lib/` returns zero feature-flag reads.
- **Fix:** remove `flags?` from the type until wired, or comment "declared for future use; see PLAN §7 Feature flags".

---

## Low / cleanup

### [L1] Type safety — `(window.navigator as IosNav).standalone` duplicated 4×
- **Files:** `components/notifications/NotificationsPanel.tsx:104`, `components/PwaShell.tsx:89`, `components/ui/PwaTabBar.tsx:103`, `app/login/page.tsx:65-66`
- **Fix:** `lib/pwa-mode.ts` → `isStandalonePwa(): boolean`. Four call sites collapse.

### [L2] Type safety — `decoded.leagues as Record<string, string>` cast repeated across 6 API routes
- **Files:** `app/api/captain-submit/route.ts:114`, `app/api/captain-roster/route.ts:102`, `app/api/admin-branding/route.ts:81-83`, `lib/auth-client.ts:129, 175`, `app/login/finish/page.tsx:94`
- **Fix:** single helper in `lib/platform-auth.ts` (already exists) — `getLeagueRole(decoded, leagueId)`.

### [L3] Type safety — `@ts-expect-error iOS-only legacy property` inconsistent with `as IosNav` used elsewhere
- **File:** `app/login/page.tsx:65-66`
- **Fix:** consolidate into helper from L1.

### [L4] Multi-tenant — Middleware matcher excludes any path ending in `.txt` or `.xml`
- **File:** `middleware.ts:57`
- **What:** Covers intentional `/robots.txt` and `/sitemap.xml` (both re-resolve tenant via Host). Any future route at a `.txt`/`.xml` suffix that assumes middleware-set `x-tenant-id` will silently see `null`.
- **Fix:** one-line comment on the matcher explaining what's intentionally excluded.

### [L5] Multi-tenant — No CI guard against `x-tenant` reads in `/api/*`
- **What:** B4 slipped past PRELAUNCH Fix #2 because there was no automated check. The invariant is "zero matches for `grep -rn x-tenant app/api/`".
- **Fix:** add as a CI step or pre-commit hook.

### [L6] Security — `/api/parse-boxscore` returns Anthropic error messages verbatim
- **File:** `app/api/parse-boxscore/route.ts:225-227`
- **Fix:** log full error server-side, return generic 502 to client.

### [L7] A11y — `disabled:opacity-50` on buttons fails WCAG contrast in places
- **Files:** `components/admin/TeamsManager.tsx` (8 locations), `components/admin/CalendarFeeds.tsx` (3), others
- **Fix:** `disabled:bg-slate-300 disabled:text-slate-500` instead of opacity.

### [L8] Errors — `signOut().then(...)` patterns missing `.catch`
- **Files:** `components/ProfileButton.tsx:80`, `app/admin/page.tsx:343`, `app/profile/page.tsx:226`
- **Fix:** `.then().catch(...).finally(() => location.href = "/")` — navigate either way.

### [L9] Deps — npm audit reports moderate undici vulnerability via Firebase SDK chain
- **Output:** 6 moderate vulnerabilities, all `undici` transitive via `@firebase/auth`, `@firebase/firestore`, `@firebase/functions` (and their `-compat` packages). `npm audit fix` available — bumps Firebase SDK patch versions.
- **Fix:** `npm audit fix` and re-run typecheck + tests. Low-risk patch bump.

### [L10] Deps — 27+ outdated packages including @firebase/rules-unit-testing (3.0.4 → 5.0.1, major)
- **Notable:** ESLint 8 → 10 (major behind), @tiptap/* 3.22.5 → 3.23.1 (every package). React 19 available; staying on 18 is fine for Next 14.
- **Fix:** post-launch hygiene. Tiptap minor bumps are safe to do now; ESLint 8 → 10 needs a manual review.

### [L11] DX — README still says "Pre-MVP — scaffolding only"
- **File:** `README.md:5`
- **What:** SFBL is being launched May 15. README is stale relative to reality.
- **Fix:** one-line refresh: "Live tenant: SFBL (sfbl-1.vercel.app). v1 launch May 15 2026."

### [L12] DX — `LeagueConfig.fields?: string[]` referenced in admin UI, undocumented in seed
- **File:** `lib/types.ts:92`
- **Fix:** add to `provision.example.json` schema docs OR remove from type if not used.

### [L13] Pre-launch — `vercel.json` is empty `{}` (no headers, redirects, function regions, cron schedules)
- **File:** `vercel.json`
- **What:** Defaults work, but the `/api/pregame-reminder` route is documented as cron in DEPLOY.md — no cron schedule defined in `vercel.json`, so it never runs unless triggered manually.
- **Fix:** declare cron in `vercel.json`:
  ```json
  { "crons": [{ "path": "/api/pregame-reminder", "schedule": "0 12 * * 0" }] }
  ```
  Verify `CRON_SECRET` is set in Vercel env.

### [L14] Pre-launch — No CI workflows (no `.github/workflows/`)
- **What:** Tests don't run automatically on push. The 781 tests + the security-rules emulator suite that CLAUDE.md flags as non-negotiable both run locally only. A regression to the rules suite can ship without anyone noticing.
- **Fix:** add `.github/workflows/ci.yml`: typecheck, build, vitest, security-rules tests. Block merge on red.

### [L15] Pre-launch — DEPLOY.md mentions `FIREBASE_SERVICE_ACCOUNT_PATH` and `FIREBASE_SERVICE_ACCOUNT_JSON` but is unclear which Vercel uses
- **File:** `DEPLOY.md` Vercel section
- **What:** "Most prod-ready Admin SDK init reads either" — but a fresh deployer won't know which env var to set. `lib/firebase-admin.ts` should be the source of truth; doc it explicitly.
- **Fix:** in DEPLOY.md, explicit "On Vercel use `FIREBASE_SERVICE_ACCOUNT_JSON` (paste full JSON). The `_PATH` variant is local-dev only."

---

## Verified intentional / not findings

- **`/api/*` excluded from middleware** (`middleware.ts:46-58`) — documented in PRELAUNCH_AUDIT Fix #2; API auth is per-route via bearer token.
- **Every page declares `export const dynamic = "force-dynamic"`** — multi-tenant intentionally avoids static caching per CLAUDE.md. M6 finding is about adding a thin in-memory cache that doesn't change the dynamic-rendering contract.
- **3-lane scoring writes (`/score_submissions/{game}_{team}` + canonical `/box_scores/{game}`)** — same pattern as DVSL; not a duplicate-write bug.
- **`as unknown as LeagueConfig` in `lib/tenants.ts:197`** — emergency hardcoded SFBL fallback per the night Firestore quota was exhausted. Documented in code comment.
- **`NEXT_PUBLIC_FIREBASE_*` env vars exposed to client** — Firebase web config is public by design; Firestore rules enforce access. Verified in `lib/firebase.ts:10-18`.
- **firebase-admin SDK never imported into `"use client"` files** — `grep "firebase-admin"` on client files returns zero hits.
- **DOMPurify wraps every `dangerouslySetInnerHTML` writepath** — `lib/markdown.ts:55-62`. 5/6 read sites also defensively re-sanitize; the 6th (recapOverrideHtml) is M11.
- **Service Worker `notificationclick` clamps URL to same-origin** — `public/firebase-messaging-sw.js:199-207`. The B2 finding is about the SEPARATE InboxPanel render path; SW itself is fine.
- **Open redirect protection on `/login/finish`** — `nextParam.startsWith("/") && !nextParam.startsWith("//")` is correct.
- **`scripts/seed-fixture.ts` deletes collections before re-seeding** — guarded by `FIRESTORE_EMULATOR_HOST` env check; cannot run against production.
- **`scripts/migrate-pii-to-private.ts` uses `FieldValue.delete()`** — idempotent + targeted; safe.
- **Captain-submit transaction over `/box_scores/{gameId}`** — `route.ts:197` — race condition from earlier audit is fixed.
- **All 30+ `<img>` tags have alt attributes**; decorative use `alt=""`, meaningful uses are descriptive.
- **Div onClick keyboard support** — `GameCard`, `PreviewCard`, `LeaderCard` all use `role="link"` + `tabIndex={0}` + Enter/Space key handlers.
- **scripts/audit-tenant.ts EXISTS** — DVSL_REVIEW_NOTES.md §6 said it was missing; it's been added since (good — DVSL reviewer would now mark closed).
- **PRELAUNCH_AUDIT Fix #1–#4** — verified each is still in place via the multi-tenant agent's re-read of `firestore.rules` + audit-relevant routes.
- **`createCustomToken` in auth-bridge mints for `decoded.uid`** — same uid, just rebinds session in another auth instance. Doesn't elevate.
- **No NoSQL injection** — every `where()` clause uses server-validated values (decoded.uid, claim-derived teamId, or path literals).
- **No SSRF risk in server-side fetches** — only outbound fetches are Anthropic (hardcoded URL) and `/api/send-notification` via `originFromRequest` (clamped to `req.url`'s origin).
- **`(window.navigator as IosNav).standalone`** — non-standard but the IosNav narrowing is the right pattern. L1 is about deduplication, not correctness.

---

## Gut check — investigate

### [G1] FCM token doc-id encoding (raised in DVSL_REVIEW_NOTES.md §10a, never resolved)
- **File:** `firestore.rules:268` comment, `lib/notifications/register.ts` (if it exists)
- **What:** Doc-id convention is `<fcm_token>_<leagueId>`. FCM tokens contain `:`, `/`, base64url chars; Firestore doc IDs disallow `/` and have length constraints. DVSL reviewer flagged: "verify by registering a real FCM token end-to-end on the emulator and inspecting the doc id."
- **Action:** Adam to do a one-time end-to-end test (subscribe to push on iOS Safari, check the doc that lands in `/notification_tokens`). If special chars get URL-encoded somewhere, double-encode on read breaks the dismiss-pending-nav lookup. If broken, switch to `<sha256(token)>_<leagueId>`.

### [G2] Captain claim shape stability
- **What:** `decoded.leagues as Record<string, string>` is cast in 6 places. If PLAN §6 ever expands custom claims to `leagues: { sfbl: { role: "admin", teamIds: [...] } }`, every consumer breaks but typecheck won't catch it.
- **Action:** decide now whether to lock the cast behind a `getLeagueRole()` helper (L2) before adding more consumers.

### [G3] cleanName Unicode whitespace normalization (DVSL_REVIEW_NOTES.md §1, never resolved)
- **What:** DVSL caught 70+ NBSP-split player names in real audit. Adam's `scripts/provision.ts` uses only `.trim()` when reading CSV.
- **Action:** add `cleanName` helper to `lib/text.ts`, apply at `provision.ts`, `/api/chat-message`, anywhere a name crosses the trust boundary from external input. ~15 LOC.

### [G4] captains_chat empty-categories trap (DVSL_REVIEW_NOTES.md §10b)
- **What:** `lib/notifications/match.ts:140-145` treats empty `categories[]` as subscribe-to-all (DVSL backward-compat). A future bug that clears categories silently opts every user into captains_chat.
- **Action:** special-case `captains_chat` to NEVER deliver when `categories[]` is empty.

### [G5] `messaging/invalid-argument` in DEAD_TOKEN_ERROR_CODES (DVSL_REVIEW_NOTES.md §5)
- **File:** `lib/notifications/match.ts:202-206`
- **What:** Firebase uses `invalid-argument` for both malformed-token AND malformed-payload. A bad push payload would prune live tokens.
- **Action:** drop `messaging/invalid-argument` from the dead-token set; log but don't prune.

(G3, G4, G5 are open items from DVSL_REVIEW_NOTES.md the reviewer flagged as ship-blockers. Re-flagging here because they don't appear closed in this audit either. If they're already fixed, mark resolved; if not, decide before launch.)

---

## Counts

- **Total findings:** 47
- **Ship blockers:** 5  *(B1 send-notification phishing, B2 inbox URL phishing, B3 errors-log abuse, B4 league-form broken, B5 player-link cross-tenant)*
- **High priority:** 13  *(token revocation, audit trail gap, parse-boxscore cost, bridge overwrite, bridge-rule gap, indexes, errors collection, audit log, box-score N+1, ticker N+1, hydration mismatch, modal a11y, SW parse)*
- **Medium:** 17
- **Low:** 15  *(includes 5 cleanup, 3 deps, 4 pre-launch ops, 3 DX)*
- **Verified intentional:** 20 patterns
- **Gut-check items to investigate:** 5

## Sequencing recommendation

For SFBL launch (6 days):
1. **Today/tomorrow** — fix B1–B5. None are big code changes; all are small-surface security/correctness fixes.
2. **Pre-launch hardening (this week)** — H1, H2, H4, H5, H6, H13. Quick wins, real risk reduction.
3. **Cost/scale (this week)** — H7, H8, H9, H10 because Nelson's first day with real users will hit Firestore reads hard.
4. **Post-launch v1** — everything else.
5. **Don't ship without** — running `npm audit fix` (L9) and adding the cron schedule to `vercel.json` (L13) for the pregame reminder to fire.
