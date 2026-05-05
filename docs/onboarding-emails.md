# Onboarding email templates

Copy-paste templates for the three emails you'll send during a tenant
launch. Substitute `[BRACKETED]` placeholders.

---

## 1. Commissioner welcome — site is live

Send right after `npm run provision` succeeds and `<slug>.leagueengine.com`
renders the league. Confirms admin access works + walks them through
what they can do from `/admin`.

**Subject:** `[LEAGUE_NAME]` site is live

---

Hey [COMMISSIONER_NAME],

Your site is up: **https://[SLUG].leagueengine.com**

I've granted admin access to **[YOUR_EMAIL]**. To get in:

1. Visit https://[SLUG].leagueengine.com/login
2. Enter your email — magic-link arrives in your inbox
3. Tap the link from the same browser/device. You'll land on `/admin`.

From `/admin` you can:

- **Branding** — name, abbrev, colors, logo. Changes ship to the public
  site within a minute.
- **Captain & admin claims** — paste a captain's email, pick their team,
  hit Grant. Same flow for granting another admin.
- **Send push notification** — for league-wide announcements. Default
  category is "Announcements"; goes to everyone subscribed.
- **Pages** — create rules, code-of-conduct, sponsor pages, etc. Each
  lives at `/content/<slug>`. Edit anytime, markdown supported.
- **Recalc league stats** — usually automatic; manually trigger if
  standings ever drift after a box-score edit.

What I need from you next:

1. Paste your league rulebook into Pages → Rules. Markdown-formatted
   is fine; plain text works too.
2. Confirm the team list, captain emails, and rosters look right at
   https://[SLUG].leagueengine.com/teams
3. Send your captains the email below (template attached) so they can
   sign in and get to their portal.

Schedule for ongoing: I push fixes + features as we find them.
Captains hitting bugs → email or text me, I'm usually fast.

Let me know when you're ready to flip notifications + tell the league.

— Adam

---

## 2. Captain welcome — captain access granted

Send after running the provisioning admin grant or doing the in-app
"Grant captain" flow. One per captain.

**Subject:** Your `[TEAM_NAME]` captain portal is ready

---

Hey [CAPTAIN_NAME],

You're set up as the captain of **[TEAM_NAME]** on the new
**[LEAGUE_NAME]** site:

**Sign in:** https://[SLUG].leagueengine.com/login

Enter the email I'm using here ([CAPTAIN_EMAIL]) and tap the
sign-in link in your inbox. After signing in once, you'll land on
the **Captain Portal** automatically.

What you can do from there:

- **Roster** — add/remove players, edit jerseys, positions, emails
- **Schedule** — see every game; edit date / field / status for your
  own games (rainouts, reschedules)
- **Submit Score** — tap any game to enter a box score after the game
- **Attendance** — three views: My Availability, Team summary
  (yes/maybe/no/waiting), and Captain Edit. There's a "📢 Remind
  Waiting" button that pings unrresponded players with one tap.
- **Payments** — track season-fee payments per player, including
  partial payments
- **Team Chat** — group conversation with everyone on your roster
- **Captains Chat** — private room with every other captain + the
  commissioner
- **🔔 Notifications** — tap "Enable" once to get push alerts on this
  device

A few quick tips:

- **Add to home screen** on your phone. iPhone: Share → Add to Home
  Screen. Android: browser menu → Install. Push notifications only
  work on iPhone once installed (Apple rule, not ours).
- **Share the site link in your team text thread** so players
  bookmark it. They sign in with their email, mark their own
  availability, and get pinged when you message Team Chat.
- **First time submitting a score?** Try Score Only mode for the
  fastest path — just enter the final and hit Submit. Use Box Score
  mode when you want full per-player stats.

Bugs / "how do I…?" / ideas → email me directly. I'm usually quick.

— Adam
adam.miller.22@gmail.com

---

## 3. Player welcome — site launched, here's how to use it

This goes from the **commissioner** to the league, not from you.
Either give the commissioner the template + ask them to forward, or
they'll write their own. Including in case they want a starting
point.

**Subject:** [LEAGUE_NAME] season — new website is live

---

[LEAGUE_NAME],

We've got a new site this season:
**https://[SLUG].leagueengine.com**

It's the home for everything league-related — schedule, scores,
standings, leaderboards, team pages, and your individual stats.

**Sign in once** to unlock features that need to know who you are:

1. Visit https://[SLUG].leagueengine.com/login
2. Enter the email your captain has on file for you
3. Tap the sign-in link from your inbox

Once you're signed in:

- **Mark your availability** for upcoming games — your captain sees
  it instantly
- **Read team chat** — your captain posts updates here (field
  changes, sub requests, etc.)
- **Get push notifications** for game results, schedule changes,
  and team chat — opt in via the 🔔 Notifications tab in your
  profile

📱 **iPhone users:** the site works best added to your home screen.
Open in Safari → tap the Share button → "Add to Home Screen." Push
notifications only work once installed.

Any issues, ping your captain or [COMMISSIONER_NAME].

See you out there.

[COMMISSIONER_NAME]

---

## 4. Bug-fix follow-up (optional)

Use when a captain or player reports something that broke. Closes
the loop personally — most SaaS doesn't do this, and it builds trust
that the platform is real-supported.

**Subject:** Re: `[their original issue]`

---

Hey [NAME],

Pushed a fix — should be live now (Vercel auto-deploys on merge).
[ONE-LINE WHAT YOU FIXED, IN PLAIN ENGLISH].

Try it again and let me know if anything still feels off. If it's
fixed, no need to reply.

Thanks for catching this.

— Adam
