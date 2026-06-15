"use client";

import { useTenant } from "@/lib/tenant-context";

// Help tab — verbatim port of DVSL captain.html:1009-1242 (sec-help)
// with text adjusted for LE-specific UX:
//   - Login is magic-link (no passwords)
//   - Notifications live inside the captain dashboard (post-v271
//     fix), not via a bounce-out to /profile
//   - Payment tracks $ amounts + partial payments (not just paid/unpaid)
//   - Live scoring + PDF upload are Phase 2 (scorer port) — not
//     described here so we don't promise features that aren't shipping
//
// Native <details> elements drive the accordion — no JS state, no
// custom keyboard handling, accessible by default. Same UX shape DVSL
// has, browser-native.

interface Props {
  contactEmail?: string;
}

export function HelpTab({
  contactEmail = "adam.mainlinewebdesign@gmail.com",
}: Props) {
  // SFBL doesn't use attendance (teams poll on WhatsApp) or push
  // notifications, so those Help sections are hidden for it. Other
  // leagues see the full guide. (Adam, 2026-06.)
  const { tenantId } = useTenant();
  const isSfbl = tenantId === "sfbl";
  return (
    <div className="cap-tab cap-help">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Help</h2>
        <p className="cap-section-sub">
          How everything in your captain portal works. Tap a section to
          expand.
        </p>
      </div>

      <details>
        <summary>1. Logging In</summary>
        <div className="help-body">
          <p>
            Captains sign in with a <strong>team password</strong> — no
            account or email needed. Go to the captain page, pick your team
            from the list, and type the password the commissioner gave you.
          </p>
          <ul>
            <li>
              <strong>First time?</strong> Ask the commissioner for your
              team&rsquo;s password. Each team has its own.
            </li>
            <li>
              <strong>Stays signed in</strong> — once you log in on a device
              you stay signed in until you tap Sign Out. Safe to install as a
              PWA on your home screen.
            </li>
            <li>
              <strong>iPhone install</strong> — Safari → Share → Add to Home
              Screen so it runs like a real app on your phone.
            </li>
          </ul>
          <p>
            This site is built as a <strong>PWA (Progressive Web App)</strong>
            , so it works like a real app — installable, offline-friendly,
            auto-updating.
          </p>
        </div>
      </details>

      <details>
        <summary>2. Managing Your Roster</summary>
        <div className="help-body">
          <p>
            Your roster lives in the <strong>Roster</strong> tab. Players you
            add here appear on your team page on the public site.
          </p>
          <ul>
            <li>
              <strong>Add a player</strong> — tap "+ Add Player" and enter
              name, jersey, position, email, phone. Email and phone are kept
              on the roster for your records.
            </li>
            <li>
              <strong>Edit a player</strong> — tap the row to update jersey,
              position, etc. mid-season.
            </li>
            <li>
              <strong>Remove a player</strong> — only removes them from the
              current roster, not their historical stats.
            </li>
            <li>
              <strong>Pending players</strong> — if a player signed up via
              your link, they'll show as Pending. Approve to add them to the
              official roster, Reject to dismiss.
            </li>
          </ul>
          <p>
            If a player joined your team mid-season from another team, add
            them here and the commissioner will clean up the transfer on
            their end.
          </p>
        </div>
      </details>

      <details>
        <summary>3. Schedule &amp; Calendar Sync</summary>
        <div className="help-body">
          <p>
            The <strong>Schedule</strong> tab shows every game on your
            schedule — dates, times, fields, and status. It's view-only;
            the commissioner manages the master schedule.
          </p>
          <ul>
            <li>
              <strong>Subscribe to Calendar</strong> — at the top of the tab,
              the Apple / Google buttons subscribe each player's phone to a
              feed of your team's games. <em>Each device has to subscribe
              individually</em>; the link doesn't subscribe the whole team at
              once.
            </li>
            <li>
              <strong>Rainouts &amp; reschedules</strong> — handled by the
              commissioner. Once they update a game, subscribed players see
              the new info on their next calendar refresh.
            </li>
          </ul>
        </div>
      </details>

      <details>
        <summary>4. Submitting a Score</summary>
        <div className="help-body">
          <p>
            After a game, go to <strong>Submit Score</strong>. Two options:
          </p>
          <ul>
            <li>
              <strong>📊 Box Score</strong> — full manual entry. AB / R / H /
              2B / 3B / HR / RBI / BB / K per player, plus pitcher lines.
              Takes ~5 minutes if you've got a paper scoresheet in front of
              you. The system reconciles your entry with the opposing
              captain's.
            </li>
            <li>
              <strong>📝 Score Only</strong> — fastest option. Just enter the
              final away/home runs, hit submit, done. No individual stats. Use
              this when nobody tracked the game and you only know the final.
            </li>
          </ul>
          <p>
            You only need <strong>one</strong> of these. Make sure somebody on
            your team submits something after each game.
          </p>
        </div>
      </details>

      <details>
        <summary>5. Building Your Lineup</summary>
        <div className="help-body">
          <p>
            When submitting box-score stats, you build your lineup by tapping
            players in batting order:
          </p>
          <ul>
            <li>
              The <strong>first player you tap is your leadoff hitter</strong>
              , second tap = 2-hole, and so on.
            </li>
            <li>
              Players not in the lineup (didn't play) — leave them un-tapped;
              they're marked DNP.
            </li>
            <li>
              Wrong order? Clear and restart — the lineup grid resets.
            </li>
            <li>
              Subs not on your official roster? Tap "+ Add Batter" during
              entry to drop them in as a one-game guest.
            </li>
          </ul>
        </div>
      </details>

      <details>
        <summary>6. Score Discrepancies</summary>
        <div className="help-body">
          <p>
            Both captains submit independently. Here's how conflicts are
            handled:
          </p>
          <ul>
            <li>
              <strong>Scores must match.</strong> If your final differs from
              the other captain's, the commissioner is alerted and settles
              it on their end.
            </li>
            <li>
              <strong>Each team owns its own batting stats.</strong> Your
              stats for your own players are final. If Team A called a ball a
              hit and Team B called it an error, both entries stand for their
              own team.
            </li>
            <li>
              The commissioner can override anything from the admin page if
              you and the opposing captain can't agree.
            </li>
          </ul>
        </div>
      </details>

      {!isSfbl && (
      <details>
        <summary>7. Player Attendance</summary>
        <div className="help-body">
          <p>
            The <strong>Attendance</strong> tab has three views:
          </p>
          <ul>
            <li>
              <strong>My Availability</strong> — pick your name from the
              dropdown to mark yourself Yes / Maybe / No for each upcoming
              game. Tap a status again to clear it.
            </li>
            <li>
              <strong>Team</strong> — see who's in / out / waiting for each
              upcoming game. Has a "📢 Remind N waiting" button that sends a
              push to everyone who hasn't responded yet (skips people who
              already have).
            </li>
            <li>
              <strong>Captain Edit</strong> — mark availability on behalf of a
              player who isn't phone-savvy or forgot. Same effect as the
              player marking themselves.
            </li>
          </ul>
          <p>
            <em>Tip:</em> share your team's URL with your players so they
            bookmark it and update their own availability.
          </p>
        </div>
      </details>
      )}

      <details>
        <summary>8. Tracking Payments</summary>
        <div className="help-body">
          <p>
            The <strong>Payments</strong> tab shows each player on your roster
            and how much they've paid toward the season fee.
          </p>
          <ul>
            <li>
              Enter <strong>amount paid</strong> per player. Partial payments
              are fine — the system shows status as Paid / Partial / Unpaid
              based on amount paid vs amount due.
            </li>
            <li>
              <strong>Notes field</strong> — track method ("Venmo 4/12",
              "owes $50 cash"). Visible to you and the commissioner.
            </li>
            <li>
              The commissioner sees totals across the league — no need to
              text or email summaries.
            </li>
            <li>
              Default fee per player comes from league config. If a player
              owes a different amount (discount, late fee), edit their Owes
              column.
            </li>
          </ul>
        </div>
      </details>

      {!isSfbl && (
      <details>
        <summary>9. Push Notifications</summary>
        <div className="help-body">
          <p>
            Push notifications ping you when something happens — no need to
            check the app.
          </p>
          <ul>
            <li>
              <strong>Enable</strong> — go to the{" "}
              <strong>🔔 Notifications</strong> tab in your captain portal.
              Tap "Enable Notifications" and accept the browser prompt.
            </li>
            <li>
              <strong>Pick categories</strong> — Score updates, Schedule
              changes, Rainouts, Pre-game (1-hour heads-up), League
              Announcements, Photos, Live Games, Playoff updates. Toggle
              what you want.
            </li>
            <li>
              <strong>Pick teams</strong> — All teams / Just my team / Custom.
              Default is "All teams" so you don't miss anything; switch to
              your team only if you want less noise.
            </li>
            <li>
              <strong>iPhone caveat</strong> — Safari only allows push
              notifications when the site is installed to your home screen
              (iOS 16.4+). The Notifications tab will tell you if you need to
              install first.
            </li>
          </ul>
          <p>
            If notifications stop coming through, re-open Notifications and
            tap Enable again — iOS sometimes quietly drops the subscription
            after long inactivity.
          </p>
        </div>
      </details>
      )}

      <details>
        <summary>Still Stuck? Contact Adam</summary>
        <div className="help-body">
          <p>
            Site breaks, feature requests, "how do I…?" — I'm usually quick
            and can push fixes within the hour.
          </p>
          <p>
            <strong>Adam Miller</strong> (site builder)
            <br />
            Email:{" "}
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </p>
          <p>
            If something feels off or you have an idea to make the site
            better, just tell me. That's how we get it right.
          </p>
        </div>
      </details>
    </div>
  );
}
