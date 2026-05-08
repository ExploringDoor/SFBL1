# SFBL launch-day runbook

Step-by-step for getting SFBL onto production and live for Nelson + the captains. Follow in order. Each step has a verification line — don't move on until it passes.

## Pre-launch (do once, anytime before launch day)

### 1. Firebase / Google Cloud project

**Goal:** confirm production project is wired up and the same one Firebase Admin SDK + Calendar API will use.

- [ ] Confirm `league-platform-5f3c8` (or whatever the prod project is) exists in Google Cloud Console
- [ ] Service account JSON downloaded → put it somewhere private (NOT in git). Vercel will reference it via env var.
- [ ] **Enable APIs** in the console:
  - Firestore API ✓ (already on for dev)
  - Firebase Authentication ✓
  - Firebase Cloud Messaging (FCM)
  - **Google Calendar API** ← required for the new GCal sync
- [ ] In Authentication → Settings → Authorized domains, add: `sfbl.leagueengine.com` and `sfbl.com` (whichever you'll use)

**Verify:** `gcloud auth list` shows your service account.

### 2. Vercel project

**Goal:** the Next.js app deployed and reachable on a test URL.

- [ ] Connect GitHub repo to Vercel
- [ ] Set environment variables (Settings → Environment Variables):

```
NEXT_PUBLIC_FIREBASE_PROJECT_ID         = league-platform-5f3c8
NEXT_PUBLIC_FIREBASE_API_KEY            = <from Firebase Console → Project Settings>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN        = league-platform-5f3c8.firebaseapp.com
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET     = league-platform-5f3c8.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = <from console>
NEXT_PUBLIC_FIREBASE_APP_ID             = <from console>
NEXT_PUBLIC_USE_FIREBASE_EMULATOR       = false   ← critical, must be false in prod
FIREBASE_SERVICE_ACCOUNT_PATH           = (don't set — use FIREBASE_SERVICE_ACCOUNT_JSON instead)
FIREBASE_SERVICE_ACCOUNT_JSON           = <paste full JSON contents>
ANTHROPIC_API_KEY                        = sk-ant-…   ← required for the captain scoresheet upload feature
LEAGUEENGINE_APEX_DOMAINS                = leagueengine.com,sfbl.com
```

- [ ] Trigger a deployment from the `main` branch
- [ ] Wait for build to complete green

**Verify:** visit `https://<project>.vercel.app` — should redirect or show the apex landing.

### 3. Provision SFBL into production Firestore

**Goal:** SFBL's data (28 teams, 443 players, 136 games, 6 page docs) lands in production.

```bash
# From your dev machine, with FIREBASE_SERVICE_ACCOUNT_PATH pointing
# at the prod service account JSON (NOT emulator)
GCLOUD_PROJECT=league-platform-5f3c8 \
  FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/prod-sa.json \
  npm run provision -- --league sfbl
```

- [ ] Provision script reports: 28 teams, 443 players, 136 games, audit clean
- [ ] Run the deep audit: `npm run audit:tenant -- --league sfbl`
- [ ] Should print "✅ No issues found."

### 4. Bootstrap the first admin (Nelson)

**Goal:** Nelson can sign in and click around `/admin`.

- [ ] Nelson signs in once at `https://<project>.vercel.app/login` with his email — creates his Firebase Auth user
- [ ] You grant him admin:
```bash
GCLOUD_PROJECT=league-platform-5f3c8 \
  FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/prod-sa.json \
  npm run grant-claim -- --email nelson@... --league sfbl --role admin
```
- [ ] Nelson signs out + back in, sees the **◉ Admin** pill in the nav
- [ ] He grants himself / co-admins / captains directly from the **Captains** admin tab from now on

### 5. DNS for sfbl.com (custom domain)

**Goal:** sfbl.com points to Vercel.

- [ ] In Vercel → Project → Settings → Domains, add `sfbl.com` and `www.sfbl.com`
- [ ] Vercel shows the CNAME record to add at Nelson's DNS host
- [ ] Nelson (or you with his login) adds the records — both apex `A` record and `www` `CNAME`
- [ ] Wait for SSL cert (~5 min)
- [ ] **Add a domain mapping doc in Firestore**: `/domains/sfbl.com` → `{ leagueId: "sfbl" }` (the middleware uses this to resolve custom domains to tenants). The provision script does this automatically when `provision.json` includes `customDomain: "sfbl.com"`.

**Verify:** `curl -I https://sfbl.com` returns 200, NOT a redirect to leagueengine.com.

### 6. Set up Google Calendar sync

**Goal:** captains/players subscribe to one calendar URL → see schedule updates within seconds.

- [ ] Calendar API already enabled (step 1)
- [ ] Sign in as admin → Admin → **Calendar** tab → click **🚀 Set up Google Calendar sync**
- [ ] Endpoint creates a public-read calendar named "South Florida Baseball League Schedule"
- [ ] Copy the public subscribe URL — share with players via email blast / push notification

**Verify:** click the URL on your phone — should add to Calendar, show all SFBL games.

### 7. Push notifications (FCM + Service Worker)

- [ ] Verify the service worker registers — visit the site on iPhone Safari, allow notifications when prompted
- [ ] Send a test push from Admin → **Notifications** tab to yourself
- [ ] Try a category-targeted push (e.g. "Scores") — verify it lands

## Launch day

### Morning of May 15

- [ ] **Final provision run** — pulls in any roster/schedule updates Nelson did between your last provision and launch
- [ ] **Fresh deploy** to Vercel (auto-deploys on git push to main)
- [ ] **Send the welcome push** (Admin → Notifications → Category: Announcements → "Welcome to the new SFBL site! Subscribe to push and the calendar above for updates.")
- [ ] **Email captains** the captain-portal walkthrough (once they receive their captain claim grant)

### Captains onboarding (first 48h after launch)

- [ ] Send each captain a magic-link sign-in via the Auth Emulator script (or Firebase Console manually)
- [ ] Grant their captain claim via Admin → **Captains** tab → pick team + player → Grant
- [ ] They sign in, see ⚾ Captain pill, click around their team's portal

## Smoke tests (run after every deploy)

- [ ] `curl https://sfbl.com/` → 200, sees SFBL hero
- [ ] `curl https://sfbl.com/standings` → 200, division tables render
- [ ] `curl https://sfbl.com/schedule` → 200, upcoming games show
- [ ] `curl https://sfbl.com/teams/margate-marlins` → 200, roster appears
- [ ] `curl https://sfbl.com/api/schedule.ics` → 200, returns iCalendar `BEGIN:VCALENDAR`
- [ ] Sign in as captain, visit `/captain` — all 7 tabs load
- [ ] Sign in as admin, visit `/admin` — all 14 tabs load
- [ ] Hit `/foo-not-real` → custom 404 page renders

## Rollback (worst case)

If something is broken in prod:

1. In Vercel → Deployments, click **Promote to Production** on the previous green deploy
2. If the issue is Firestore data corruption, run `npm run audit:tenant -- --league sfbl` and triage
3. If push notifications broke, check Admin → Audit log for `chat_clear_all`/etc. to make sure no one ran the wrong button

## Things that are NOT yet automated

- **Email magic link in production**: Firebase sends real emails to real addresses in prod — the emulator-only `npm run magic-link` script is no longer needed. Just hit `/login` and check the inbox.
- **Stripe billing**: SFBL uses manual Zelle/Venmo billing per `PLAN.md`. Tracker UI is at `/admin → Health` showing payment status, but charging is offline.
- **GoogleAuth domain ownership for production**: if you hit "this domain is not verified" when setting up GCal sync, go to Google Search Console and verify ownership.
