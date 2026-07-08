# COYBL Launch Checklist

_Updated 2026-07-08._
Live: **https://coybl.net** · Vercel project: `coybl-preview` · Firebase (shared, Blaze): `sfbl-acf51`

---

## 🔴 Blockers — must be done for a real launch

- [ ] **Coach login email (from coybl.net).** Right now a coach who registers gets
      an account created but **no email**, so they can't set a password / sign in.
      Turn it on:
      - Adam: create a Resend account → API key.
      - Claude: verify `coybl.net` in Resend (add SPF/DKIM/DMARC — DNS is in Vercel now, self-serve).
      - Set on `coybl-preview`: `RESEND_API_KEY`, `EMAIL_FROM="COYBL <noreply@coybl.net>"`, `EMAIL_NOTIFY`.
- [ ] **Coach → team connection.** Registration creates the account but does NOT
      link it to a team; a director binds each coach to their team (captain claim)
      in Admin. Decide the flow for ~196 teams: coaches self-register + directors
      bind as they come in, or a bulk invite. Walk the directors through it.

## 🟡 Confirm with Doug

- [ ] **Pricing** — site shows Option 1 $495 / Option 2 $425 / USSSA +$35.
      Doug's earlier number was +$40 USSSA — confirm the $35.
- [ ] **Who runs the schedule** — the office maintains it in Admin (the calendar
      sync + everything feeds off it). Confirm they'll keep it current here (vs.
      GameChanger). Same person assigns teams to divisions.

## 🟢 Recommended before launch

- [ ] **Deploy the Firestore rules.** Prod rules are behind the repo (the
      pitch-counts read is worked around via a server endpoint). Proper fix =
      `npm run rules:deploy:prod`, but it's GLOBAL across SFBL/LBDC/COYBL — review
      the diff first to confirm nothing SFBL relies on changes.
- [ ] **Registration confirmation email is SFBL-hardcoded** — make it tenant-aware
      before go-live (affects other tenants; COYBL's coach email is already branded).
- [ ] **Human test pass** (Claude can't do these): text 5–10 people to open it at
      once; open on a real iPhone (Safari) + Android (Chrome); kill wifi mid-action.
- [ ] _(Optional)_ Fix the home/scores/schedule **hydration warning** (date/timezone
      SSR mismatch). Pages work fine; it's polish, and it's shared code with SFBL.

## ⚪ Optional / can wait

- [ ] **Anthropic API key** → AI game recaps (a template recap works without it).
- [ ] **SMS (text) alerts** need Twilio — email alerts already work via Resend.
- [ ] **Power-rankings editor login** (CSV upload) — deferred per Adam.
- [ ] **www → coybl.net redirect** — cosmetic (one canonical URL).
- [ ] **"Captain Portal" → "Coach Portal"** wording for youth baseball.

## ✅ Already done

- [x] **Domain live** — https://coybl.net (+ www, http→https, valid auto-renew SSL),
      nameservers → Vercel (Adam manages DNS; Doug keeps ownership).
- [x] **Branding** — COYBL tab icon, baseball ⚾ in the ticker, Central Ohio
      link-preview image (texts/social).
- [x] **Firebase on Blaze** (paid — no free-tier quota risk).
- [x] **Real data** — 196 teams / 30 divisions / 974 games; standings, schedules, scores.
- [x] **Coach portal** — email+password login, Submit Score (Quick Score), Pitch
      Counts (game + roster dropdowns), Roster, Team Logo, Schedule, Help. Trimmed
      to youth-appropriate tabs (hid Free Agents / Payments / Attendance / Notifications).
- [x] **Manager & Coach Help** illustrated guide + **Coach Quick Start**.
- [x] **Admin** — homepage announcement banner (Alerts), News, Pages, Scores, etc.
- [x] **Registration** — coach/asst info, age group, street address, GameChanger
      link, team logo, insurance option, Venmo/card fee copy.
- [x] Admin password set; automated security/console/bad-URL pass clean.
