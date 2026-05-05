# Launch-day shipping checklist

Print this. Walk through it top-to-bottom on launch day for SFBL (or
any future tenant). Every check has a verification step.

Companion to:
- `DEPLOY.md` — one-time platform setup + onboarding playbook
- `docs/onboarding-emails.md` — copy-paste emails to send

---

## Day-before: T-24h

### 1. Code state
- [ ] All work merged to `main`. Run `git status` — clean tree.
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` succeeds with no warnings
- [ ] `npm run test` passes (full suite, both rules + integration)

### 2. SFBL data
- [ ] Commissioner replied with: logo, brand colors, team list,
      captain emails, full roster CSV, schedule CSV, rules doc
- [ ] CSV files are saved to `data/sfbl/{teams,players,schedule}.csv`
      and `data/sfbl/provision.json` references them by relative path
- [ ] Eyeball the CSVs: every team has an abbrev, every player has an
      email if you want them to receive notifications, every game has
      `away_team_id` + `home_team_id` matching team IDs in teams.csv
- [ ] Logo file dropped at `public/logos/sfbl/sfbl-logo.png` (PNG,
      ideally 512×512 with the logo on a brand-color square)

### 3. Provisioning dry-run
- [ ] Boot dev emulators: `npm run dev:emulators` (in one terminal)
- [ ] In another terminal:
      `npm run provision:emulator -- --config data/sfbl/provision.json --dry-run`
- [ ] Read the output — every CSV row should land in the writes list
      and the validation errors should be empty. If any errors, fix
      the CSV and re-run.
- [ ] Live emulator provision (no `--dry-run`):
      `npm run provision:emulator -- --config data/sfbl/provision.json`
- [ ] Visit `http://sfbl.localhost:3000` — homepage shows SFBL name +
      logo. Hero color matches `theme.primary` from config.

### 4. End-to-end smoke (you, click-through, ~30 min)
For each captain in the league, plus yourself as admin:

- [ ] **Sign in** at `http://sfbl.localhost:3000/login` — magic link
      shows in emulator UI at `localhost:4000/auth`
- [ ] **Captain portal** loads at `/captain` — your team appears in
      the hero, "My Team" tab shows record/upcoming/roster

For the admin (you):
- [ ] `/admin` loads — League Health dashboard shows correct counts
- [ ] Branding form populates with current values; saving a color
      change persists + appears on public site after reload
- [ ] Teams manager lists every team
- [ ] Captain claims grant works for one fresh email
- [ ] Send Push form fires (test category: announcements, blank team
      filter); check the push log doc in Firestore emulator
- [ ] Pages manager: paste in the rulebook markdown, save, visit
      `/rules` — content renders

For one captain (yourself, granted captain claim):
- [ ] `/captain#roster` lists your team's players
- [ ] `/captain#schedule` shows your games; click Edit on a future
      game, change date, save — game updates + audit log entry
      appears in `/admin`
- [ ] `/captain#scores` lists submittable games; click Box Score
- [ ] Submit a Score-Only entry (final score 7-3) — verify the
      public `/games/[id]` page shows FINAL with the score, recap
      auto-generates a one-line headline
- [ ] Open `/captain#attendance` — three views all render
- [ ] `/captain#teamchat` — type a message, hit Send, message
      appears, push log shows fan-out attempt
- [ ] `/captain#notifications` — click Enable (won't actually
      register on emulator without VAPID key; should show error
      message, not crash)

### 5. iPhone visual smoke (~15 min)
On a real iPhone, point browser at your dev tunnel (e.g. ngrok) or
production-staging URL:
- [ ] Public homepage renders without horizontal scroll
- [ ] Hamburger menu opens, all links work
- [ ] `/scores`, `/schedule`, `/standings`, `/teams`, `/players`
      all render acceptably on a 4.7" or 6.1" screen
- [ ] Sign in via magic link, land on `/captain` (or `/profile` if
      no captain claim) — tap through every tab, nothing crashes
- [ ] Box-score editor on a phone — lineup grid scrolls, batter
      stat inputs are tappable

---

## T-2h to T-30min: Production setup

### 6. Vercel project state
- [ ] Vercel project linked: `vercel link`
- [ ] All env vars set in Vercel UI (cross-reference DEPLOY.md):
  - [ ] `NEXT_PUBLIC_FIREBASE_API_KEY`
  - [ ] `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - [ ] `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  - [ ] `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
  - [ ] `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - [ ] `NEXT_PUBLIC_FIREBASE_APP_ID`
  - [ ] `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
  - [ ] `LEAGUEENGINE_APEX_DOMAINS=leagueengine.com,localhost`
  - [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON, not file path)
  - [ ] `CRON_SECRET` (`openssl rand -hex 32`)

### 7. DNS
- [ ] Wildcard `*.leagueengine.com` → `cname.vercel-dns.com` resolved
      via `dig sfbl.leagueengine.com cname` returning Vercel's value
- [ ] Vercel UI shows the wildcard domain provisioned + SSL cert
      issued (green check)

### 8. Firestore rules
- [ ] `npm run rules:deploy:prod` — confirm rules console shows the
      latest revision

### 9. Pre-launch deploy + smoke
- [ ] `vercel deploy --prod` (or merge to main if Vercel auto-deploys
      on push)
- [ ] `curl https://leagueengine.com` — bare apex returns 200 with
      LeagueEngine landing
- [ ] `curl https://sfbl.leagueengine.com` — returns 200 with SFBL
      content (or 404 if tenant not provisioned yet — expected at
      this stage)

---

## T-30min: Live provisioning

### 10. Provision SFBL in production
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON='...full JSON...' npm run provision -- --config data/sfbl/provision.json --dry-run`
- [ ] If clean: live run (omit `--dry-run`)
- [ ] In Vercel logs (or Firebase Console), watch the `/leagues/sfbl`
      doc + child collections appear
- [ ] Visit `https://sfbl.leagueengine.com` — full league site
      renders. Test homepage, schedule, teams page, one team detail.

### 11. Grant captain claims
For each captain on the team list:
- [ ] In `/admin` Captain Claims Manager, paste their email, pick
      their team, click Grant Captain
- [ ] Result toast confirms grant

(Or use the script: `FIREBASE_SERVICE_ACCOUNT_JSON='...' npm run grant-claim -- --email <email> --league sfbl --role captain:<team_id>`)

### 12. Self-test as admin
- [ ] Sign in at `https://sfbl.leagueengine.com/login` with your
      admin email
- [ ] Tap the magic link — land on `/admin`
- [ ] Run through the admin smoke list (sec. 4 above) on production
      data — Branding renders, Teams manager loads, Send Push
      delivers a real notification to your phone (you'll have
      enabled push first via `/profile#notif`)

### 13. Self-test as a captain
Pick one captain — ideally yourself with a separate email:
- [ ] Open private/incognito window, sign in with captain email
- [ ] Land on `/captain`, see your team, all 11 tabs render
- [ ] Submit a test box score (Score-Only, low numbers)
- [ ] Verify the game appears as FINAL on the public `/scores` page
- [ ] In `/admin` audit log, the schedule edit doesn't appear (you
      didn't edit), but you'll see the captain-submit when fan-out
      writes audit (currently doesn't, but the box score promotion
      is observable in `/box_scores/{gameId}` Firestore doc)

### 14. Email captains
- [ ] Use `docs/onboarding-emails.md` template #2 ("Your captain
      portal is ready") for each captain
- [ ] BCC yourself so you have a record of who got the link

---

## T-0: Public launch

- [ ] Send commissioner an "all set" message with the URL
- [ ] Commissioner sends template #3 (player-facing) to the league
- [ ] Watch `/admin` League Health dashboard — within an hour,
      `players_linked_to_auth` should tick up as captains sign in

---

## T+1h to T+24h: Watch + fix

- [ ] Monitor Vercel logs for any 5xx errors
- [ ] Watch `/push_log` collection in Firebase Console for delivery
      failures (sent vs failed counts)
- [ ] Watch `/leagues/sfbl/audit` for unexpected schedule edits
- [ ] Reply to any captain who texts/emails about a bug — fix in
      under an hour where possible (use template #4 for the reply)

### Common first-day issues to expect

- **iOS push doesn't fire** for a captain → they didn't add to home
  screen first. Send them DEPLOY.md sec 6 + the iOS PWA banner
  copy.
- **Captain signs in but sees "no captain access"** → claim grant
  hasn't propagated. Have them sign out + back in to refresh token.
- **Game doesn't show as final after submit** → check Firestore
  `/leagues/sfbl/box_scores/{gameId}` — if it's not there, captain-
  submit promotion failed. Check Vercel function logs.
- **Push fires but link goes wrong place** → check `/profile#avail`
  vs `/captain#attendance` deep link routing. Sometimes a stale SW
  ignores updated push routes; have user uninstall + reinstall PWA.

---

## Post-launch: T+1 week

- [ ] Run `npm run test` weekly to catch any drift before it lands
- [ ] Pull `/push_log` query for the week — total sent / failed /
      pruned. If pruned > 5% of sent, dead-token rate is high; check
      iOS PWA install rate.
- [ ] Check `/leagues/sfbl/audit` for who's been editing schedules.
      If a single captain is the source of every change, they may
      need help.
- [ ] Schedule a 15-min check-in with the commissioner: what's
      working, what's painful, anything missing.
