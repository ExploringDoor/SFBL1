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

// Who a stuck coach should contact, per league.
//
// This used to be Adam's address for every tenant, which is right while a
// league is being built and wrong the moment it has 200 coaches: routine
// "how do I…" questions belong with the people who run the league, not the
// person who runs the server. Leagues not listed here still fall through to
// Adam, which is the correct answer for one that has not launched.
const SUPPORT: Record<string, { name: string; email: string; phone?: string }> = {
  coybl: {
    name: "COYBL League Office",
    email: "doughare@coybl.org",
    phone: "614-778-1391",
  },
};


/** COYBL's own Help.
 *
 *  The shared version below documents Attendance, Payments, Push Notifications
 *  and box-score lineups — four things a COYBL coach cannot see, because those
 *  tabs are filtered out for this tenant. It also still described the old
 *  "set your password" login. Coaches were reading instructions for a portal
 *  they do not have.
 *
 *  This mirrors the printed coach handbook exactly: same seven-plus-one tabs,
 *  same 5-digit code, Quick Score only, and the Game dropdown on pitch counts.
 *  When one changes, change the other. */
function CoyblHelp({
  support,
}: {
  support?: { name: string; email: string; phone?: string };
}) {
  return (
    <div className="cap-tab cap-help">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Help</h2>
        <p className="cap-section-sub">
          How everything on your team page works. Tap a section to expand.
        </p>
      </div>

      <details>
        <summary>1. Signing in</summary>
        <div className="help-body">
          <p>
            Go to <strong>coybl.org/captain</strong>, pick your team from the
            list, and type your <strong>5-digit code</strong>.
          </p>
          <p>
            Your code was emailed to you when you registered. There is no
            account to create and no password to remember. Your assistant coach
            got the same code, so either of you can post games and enter scores.
          </p>
          <p>
            <strong>Lost it?</strong> The league office can read it back to you.
            If you have typed a wrong code several times, your team locks for 15
            minutes — wait it out rather than keep trying.
          </p>
          <p>
            Keep the code to your coaching staff. Anyone who has it can enter
            scores for your team.
          </p>
        </div>
      </details>

      <details>
        <summary>2. Finding your way around</summary>
        <div className="help-body">
          <p>
            Everything lives in the row of tabs across the top: <strong>My
            Team</strong>, <strong>Roster</strong>, <strong>Message
            Families</strong>, <strong>Team Logo</strong>, <strong>Submit
            Score</strong>, <strong>Pitch Counts</strong>,{" "}
            <strong>Schedule</strong> and <strong>Help</strong>.
          </p>
          <p>
            On a phone that row is wider than the screen, so{" "}
            <strong>swipe it sideways</strong> to reach the far end. Nothing is
            hidden in a menu.
          </p>
        </div>
      </details>

      <details>
        <summary>3. Your roster</summary>
        <div className="help-body">
          <p>
            Open <strong>Roster</strong> and tap <strong>+ Add Player</strong>.
            Fill in the name, jersey number, position, date of birth, and the{" "}
            <strong>parent or guardian&rsquo;s</strong> email and phone. Tap{" "}
            <strong>Add Player</strong> to save.
          </p>
          <p>
            Get the birth dates in. They are what the site uses to check age
            eligibility, and pitch counts only work for players who are on the
            roster.
          </p>
          <p>
            <strong>Birth dates are never shown publicly.</strong> They are
            stored separately from the roster that parents and other teams can
            see, and only you and the league office can read them. The public
            side shows a player&rsquo;s name and nothing else. Same for the
            email and phone.
          </p>
          <p>To fix or remove a player, tap them in the list below the form.</p>
        </div>
      </details>

      <details>
        <summary>4. Posting your games</summary>
        <div className="help-body">
          <p>
            COYBL coaches schedule their own games. There is no master schedule
            from the office.
          </p>
          <p>
            <strong>The home team posts the game</strong>, so it only gets
            entered once. Open <strong>Schedule</strong>, tap{" "}
            <strong>+ Add a game</strong>, pick the opponent, set who is home,
            put in the date, and tap <strong>Add game</strong>. Time and field
            are optional — add them later if you do not know them yet.
          </p>
          <p>
            If you are the <strong>away</strong> team, do not post it. Ask the
            home coach to. Two coaches posting the same game is the one thing
            that makes a mess here.
          </p>
          <p>
            While you are on that tab, use the{" "}
            <strong>Google Calendar</strong> or <strong>Apple Calendar</strong>{" "}
            buttons once. Your games drop into the calendar app on your phone
            and stay right when a game moves. <strong>Copy URL</strong> gives
            you the same link to hand your parents.
          </p>
        </div>
      </details>

      <details>
        <summary>5. Submitting a score</summary>
        <div className="help-body">
          <p>
            Open <strong>Submit Score</strong>, find the game, and tap{" "}
            <strong>⚡ Quick Score</strong>. A small form opens right there in
            the list. Put your runs in the <strong>US</strong> box and theirs in
            the <strong>THEM</strong> box, then tap <strong>SUBMIT</strong>.
          </p>
          <p>
            Standings update themselves from that. Nobody types a standings
            table.
          </p>
          <p>
            <strong>Somebody on your team has to submit a score after every
            game.</strong> Both coaches can report, and if your two finals
            disagree it goes to the league office to settle rather than one
            quietly overwriting the other. So enter what you actually had, and
            if you got it wrong, say so.
          </p>
        </div>
      </details>

      <details>
        <summary>6. Pitch counts</summary>
        <div className="help-body">
          <p>
            Open <strong>Pitch Counts</strong>, pick the <strong>Game</strong>{" "}
            from the dropdown, pick the <strong>Pitcher</strong>, type the
            number of <strong>Pitches</strong>, and tap{" "}
            <strong>+ Log outing</strong>. Repeat for each pitcher who threw.
          </p>
          <p>
            Do it the same day. The site works out who is eligible to pitch next
            and when, and it can only do that from what you have entered.
          </p>
          <p>
            <strong>Daily maximums:</strong> 75 pitches at 9U and 10U, 85 at 11U
            and 12U, 95 at 13U and 14U.
          </p>
          <p>
            <strong>Required rest, the same at every age:</strong> 1&ndash;20
            pitches, no rest. 21&ndash;35, one day. 36&ndash;50, two days.
            51&ndash;65, three days. 66 or more, four days.
          </p>
          <p>
            <strong>Pitches add up across a whole day.</strong> Two games on a
            Saturday is one total, not two, and the rest applies to the combined
            number. 7U and 8U are coach pitch, so none of this applies to them.
          </p>
        </div>
      </details>

      <details>
        <summary>7. Messaging your families</summary>
        <div className="help-body">
          <p>
            Open <strong>Message Families</strong> to send one email to every
            family on your roster — practice moved, bring red jerseys, whatever
            you need.
          </p>
          <p>
            It shows how many families it will reach before you send, and tells
            you if any player has no email on file. Add missing ones on the
            Roster tab and they are included next time.
          </p>
          <p>
            Each family gets their own copy, so nobody sees anyone else&rsquo;s
            address. Replies come straight back to you, not to the league. The
            league office gets a copy of what you send.
          </p>
        </div>
      </details>

      <details>
        <summary>8. Your team logo</summary>
        <div className="help-body">
          <p>
            Open <strong>Team Logo</strong> and upload a PNG or JPG. It appears
            next to your team on the standings, the schedule and every score.
            Optional, but it takes ten seconds and your players will notice.
          </p>
        </div>
      </details>

      <details>
        <summary>9. Put the site on your phone</summary>
        <div className="help-body">
          <p>
            The site can sit on your home screen like an app and keep you signed
            in.
          </p>
          <p>
            <strong>iPhone:</strong> open the site in Safari, tap the Share
            button, then <strong>Add to Home Screen</strong>. It has to be
            Safari — Chrome on iPhone cannot do it.
          </p>
          <p>
            <strong>Android:</strong> open it in Chrome, tap the three-dot menu,
            then <strong>Install app</strong> or{" "}
            <strong>Add to Home screen</strong>.
          </p>
        </div>
      </details>

      <details>
        <summary>
          Still stuck? {support ? `Contact ${support.name}` : "Contact Adam"}
        </summary>
        <div className="help-body">
          <p>
            Questions about the league — rules, divisions, schedules,
            registration, or anything on this page — go to the league office.
          </p>
          {support ? (
            <p>
              <strong>{support.name}</strong>
              <br />
              Email: <a href={`mailto:${support.email}`}>{support.email}</a>
              {support.phone && (
                <>
                  <br />
                  Phone:{" "}
                  <a href={`tel:${support.phone.replace(/[^0-9]/g, "")}`}>
                    {support.phone}
                  </a>
                </>
              )}
            </p>
          ) : null}
          <p>
            If something on the site looks broken rather than confusing, say so
            and the office will pass it on.
          </p>
          <p>
            You can also{" "}
            <a href="/feedback">send a question or concern to the league here</a>
            . It takes a second and you don&rsquo;t have to leave your name.
          </p>
        </div>
      </details>
    </div>
  );
}

export function HelpTab({ contactEmail }: Props) {
  // SFBL doesn't use attendance (teams poll on WhatsApp) or push
  // notifications, so those Help sections are hidden for it. Other
  // leagues see the full guide. (Adam, 2026-06.)
  const { tenantId } = useTenant();
  const isSfbl = tenantId === "sfbl";
  // An explicit prop wins; otherwise the league's own office, if it has one.
  const support = contactEmail
    ? { name: "the league office", email: contactEmail }
    : SUPPORT[tenantId ?? ""];
  const fallbackEmail = contactEmail ?? "adam.mainlinewebdesign@gmail.com";
  // COYBL's portal is a different shape from SFBL's, so it gets its own guide
  // rather than a pile of conditionals inside one.
  if (tenantId === "coybl") return <CoyblHelp support={support} />;
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
        <summary>Still stuck? {support ? `Contact ${support.name}` : "Contact Adam"}</summary>
        <div className="help-body">
          {support ? (
            <>
              <p>
                Questions about the league — rules, divisions, schedules,
                registration, or anything on this page — go to the league
                office.
              </p>
              <p>
                <strong>{support.name}</strong>
                <br />
                Email: <a href={`mailto:${support.email}`}>{support.email}</a>
                {support.phone && (
                  <>
                    <br />
                    Phone:{" "}
                    <a href={`tel:${support.phone.replace(/[^0-9]/g, "")}`}>
                      {support.phone}
                    </a>
                  </>
                )}
              </p>
              <p>
                If something on the site looks broken rather than confusing,
                say so and the office will pass it on.
              </p>
            </>
          ) : (
            <>
              <p>
                Site breaks, feature requests, &ldquo;how do I…?&rdquo; — I&rsquo;m
                usually quick and can push fixes within the hour.
              </p>
              <p>
                <strong>Adam Miller</strong> (site builder)
                <br />
                Email: <a href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>
              </p>
              <p>
                If something feels off or you have an idea to make the site
                better, just tell me. That&rsquo;s how we get it right.
              </p>
            </>
          )}
        </div>
      </details>
    </div>
  );
}
