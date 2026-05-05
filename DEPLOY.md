# Deploy & Onboarding Runbook

Reference for going live with the first tenant (SFBL) and adding more.

---

## 1. One-time platform setup (do once, before any tenant)

### Firebase project

Create a Firebase project at <https://console.firebase.google.com>.

Enable:

- **Authentication** → Sign-in providers → Email/Password (with email link
  enabled). This is the magic-link flow; no password is needed.
- **Firestore Database** → Create in production mode (we'll deploy our
  rules). Pick a region close to your tenants — `nam5` is fine for US.
- **Cloud Messaging** → Already enabled by default. Generate a Web Push
  certificate (VAPID key): Project settings → Cloud Messaging →
  Web Push certificates → "Generate key pair." Save the public key.

Get your Firebase config (Project settings → General → "Your apps" → add
a web app if needed). You'll plug the values into `.env.local` and
Vercel env.

### Service account (server-side admin SDK)

Project settings → Service accounts → "Generate new private key" → save
the JSON to `secrets/service-account.json`. **Treat this file like a
password.** It bypasses every Firestore rule. `.gitignore` keeps it out
of git; verify with `git check-ignore -v secrets/service-account.json`.

### Vercel project

`vercel link` from this repo, or create the project at
<https://vercel.com/new>. Required Vercel env vars (Settings → Environment
Variables):

| Var | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | from Firebase config | public |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | from Firebase config | public |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | from Firebase config | public |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | from Firebase config | public |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | from Firebase config | public |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | from Firebase config | public |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | the VAPID public key from above | public |
| `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` | leave unset in prod | |
| `LEAGUEENGINE_APEX_DOMAINS` | `leagueengine.com,localhost` (comma-separated) | drives subdomain split |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | leave unset in Vercel | bundle the JSON instead — see below |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | paste the full JSON contents | server-only |
| `CRON_SECRET` | `openssl rand -hex 32` | server-only; for `/api/pregame-reminder` |

Note: Vercel doesn't have local file paths. If your code reads
`FIREBASE_SERVICE_ACCOUNT_PATH`, switch it to also accept
`FIREBASE_SERVICE_ACCOUNT_JSON` (env var with the full JSON inline). Most
prod-ready Admin SDK init reads either.

### Wildcard DNS (`*.leagueengine.com`)

In your DNS provider (Cloudflare, Route 53, etc.):

```
Type: CNAME
Host: *
Value: cname.vercel-dns.com
TTL:  Auto (or 300s)
```

Then in Vercel project → Settings → Domains, add `*.leagueengine.com`.
Vercel will auto-provision an SSL cert via Let's Encrypt once DNS
propagates (a few minutes to an hour). Now any `*.leagueengine.com`
host hits this Vercel project, middleware parses the subdomain → tenant.

For custom-domain tenants (e.g. `sfbl.com` instead of
`sfbl.leagueengine.com`), v2 work — defer.

### Deploy security rules

```bash
firebase login
firebase use <your-firebase-project-id>
npm run rules:deploy:prod
```

Re-run any time `firestore.rules` changes. CI step worth adding later.

---

## 2. Provisioning the first tenant (SFBL)

### Gather inputs

Get from the commissioner:

1. League name, abbreviation (3-letter), brand colors, logo PNG
2. Team list — name + abbrev + division per team
3. Captain list — name + email per captain (one per team)
4. Player rosters — per team: name, jersey, position, email, phone
5. Schedule — every game's date, time, field, away_team_id, home_team_id
6. Sport variant (baseball / softball) + ruleset (hardball / fastpitch / slowpitch)
7. Rules document (Word / PDF / Google Doc)

### Build the provision config

Copy `scripts/templates/provision.example.json` to `data/sfbl.json`,
fill in the league config block. Drop the CSVs alongside (use the
example CSVs as templates).

### Dry-run

```bash
npm run provision -- --config data/sfbl.json --dry-run
```

Shows every doc that *would* be written, validates CSV row formats,
flags any missing required fields. Fix errors and re-run until clean.

### Live provision

```bash
npm run provision -- --config data/sfbl.json
```

Writes the league config, all teams, all players, all games, and
grants admin claim to any emails listed in `config.admins`. Idempotent
— rerun safely if you need to update.

### Post-deploy smoke (run after every prod deploy, before announcing)

These are 30 seconds of `curl` to catch a broken deploy before users
do. Run them after `vercel deploy --prod` (or after a push that
auto-deploys) and after each provision. Replace `<slug>` with your
tenant's subdomain (e.g. `sfbl`).

```bash
# 1. Apex: bare leagueengine.com returns 200 with the platform landing.
curl -fsSI https://leagueengine.com | head -1
# expect: HTTP/2 200

# 2. Tenant home: subdomain returns 200 with league HTML.
curl -fsS https://<slug>.leagueengine.com | grep -o '<title>[^<]*</title>' | head -1
# expect: <title>...league name...</title>  (NOT "404" or default)

# 3. Tenant scoped pages render (none should 5xx).
for path in / /scores /schedule /standings /teams /players /rules; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://<slug>.leagueengine.com$path")
  echo "$path -> $code"
done
# expect: every line ends in 200 (or 404 if /rules content not posted yet)

# 4. Cross-tenant isolation: a tenant subdomain that DOESN'T exist
#    should 404, not crash or leak another tenant's data.
curl -s -o /dev/null -w "%{http_code}\n" https://nonexistent-xyz.leagueengine.com
# expect: 404

# 5. Login page loads (magic-link flow shell).
curl -fsS https://<slug>.leagueengine.com/login | grep -q 'sign in\|magic link' && echo "login ok"

# 6. PWA manifest + service worker ship.
curl -fsSI https://<slug>.leagueengine.com/manifest.webmanifest | head -1
curl -fsSI https://<slug>.leagueengine.com/sw.js | head -1
# expect: both 200

# 7. Cron endpoint refuses anon (returns 401 without secret).
code=$(curl -s -o /dev/null -w "%{http_code}" https://<slug>.leagueengine.com/api/pregame-reminder)
[ "$code" = "401" ] && echo "cron gated" || echo "FAIL: pregame returned $code"
# expect: cron gated

# 8. Cron endpoint accepts the secret and runs (returns 200 + summary).
curl -fsS -H "X-Cron-Secret: $CRON_SECRET" \
  https://<slug>.leagueengine.com/api/pregame-reminder | head -200
# expect: JSON like {"ok":true,"checked":N,"reminders_sent":...}

# 9. Captain-submit refuses anon (no bearer = 401, never 500).
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "content-type: application/json" \
  -d '{"leagueId":"<slug>","gameId":"x"}' \
  https://<slug>.leagueengine.com/api/captain-submit)
[ "$code" = "401" ] && echo "captain-submit gated" || echo "FAIL: $code"

# 10. Admin endpoints refuse non-admin tokens. Skip if you don't have a
#     fresh ID token handy — verify by signing in to /admin and confirming
#     "League Health" loads.
```

If any of 1-9 fail, **do not announce the launch.** Roll back with
`vercel rollback` (or revert + push), investigate, fix, redeploy, re-run.

### Post-provision

1. Visit `https://<slug>.leagueengine.com` — public site should render
   with league branding.
2. Sign in with your admin email at `https://<slug>.leagueengine.com/login`.
3. Visit `/admin` to verify your admin claim resolved. (If "you don't
   have admin role" appears, click Refresh access — the token caches
   claims for ~1 hr.)
4. Open the Pages manager → paste in the league rulebook markdown
   under page id `rules`.
5. From `/admin` Send Push, fire a test push to yourself (category
   `announcements`, leave team blank). Confirm it lands on your phone.
6. Grant captain claims. Run for each captain:
   ```bash
   npm run grant-claim -- --email <captain-email> --league <slug> --role captain:<team-id>
   ```
7. Email each captain a magic-link sign-in link they can use to access
   their portal at `https://<slug>.leagueengine.com/captain`.

---

## 3. Adding a second tenant (KCSL or whatever's next)

Same flow as SFBL — the platform is multi-tenant from line 1.

1. Create `data/kcsl.json` (same shape as SFBL config)
2. Drop their CSVs alongside
3. `npm run provision -- --config data/kcsl.json --dry-run` (validate)
4. `npm run provision -- --config data/kcsl.json` (live)
5. DNS: nothing to do — `*.leagueengine.com` wildcard already covers
   `kcsl.leagueengine.com`
6. Tell their commissioner the URL + share their captain list

Tenant #2 typically takes 4-8 hours total because the provision script
gets tested against new CSV shapes / sport variants. Tenant #5 is
under an hour once the playbook is locked.

---

## 4. CRON setup (pregame reminder)

Already configured in `vercel.json` — Vercel runs
`/api/pregame-reminder` every 15 minutes. The endpoint is gated by
`CRON_SECRET` env. If `CRON_SECRET` isn't set, the endpoint fails
closed (no anonymous triggers possible).

To manually trigger for testing:

```bash
curl -H "X-Cron-Secret: $CRON_SECRET" https://<slug>.leagueengine.com/api/pregame-reminder
```

The endpoint iterates every league, finds games starting in 45-75
min, fires `pregame` push, marks `pregame_reminder_sent: true` for
exactly-once delivery.

---

## 5. Observability

- **Server logs**: Vercel project → Deployments → Functions → live tail
- **Push delivery**: `/push_log` collection in Firestore — every
  send-notification call appends an audit row with sent/failed counts
- **Errors**: `/errors` collection (planned ingestion endpoint, deferred)
- **Audit trail**: `/leagues/{id}/audit` — every captain schedule edit
  + admin override appends here

---

## 6. Rolling forward

Day 1 must-haves before flipping a tenant on:

- [ ] Wildcard DNS resolved + SSL cert issued by Vercel
- [ ] All env vars set in Vercel (especially `CRON_SECRET` and
      `FIREBASE_SERVICE_ACCOUNT_JSON`)
- [ ] Firestore rules deployed (`npm run rules:deploy:prod`)
- [ ] Tenant provisioned (`npm run provision`)
- [ ] At least one admin's claim granted + verified by them logging in
- [ ] Test push fired and received on a real phone
- [ ] Captains' claims granted for every team
- [ ] Each captain emailed their magic-link sign-in URL
- [ ] Public site renders the league name + brand colors

Day 1 nice-to-haves:

- [ ] Rulebook posted via Pages manager
- [ ] About page created at `/content/about` if commissioner wants one
- [ ] Logo uploaded somewhere accessible at `theme.logo_url`
      (currently in `/public/logos/<slug>/`)
