"use client";

// The admin's own how-to.
//
// Adam asked for this on 2026-08-19: "a HOW TO for admin... pictures and
// all". Mike runs the league, Kaitlin joined the office this week, and the
// admin has 27 tabs with no explanation anywhere.
//
// WRITTEN FOR ISLAND, not for the platform. Tabs that are switched off here,
// or that read data Island does not keep, are called out as such rather than
// documented as if they worked. A manual that describes features you cannot
// use is worse than no manual, because it makes the reader think they have
// missed something.
//
// The diagrams are drawn, not screenshotted. Screenshots of this admin would
// have to live in /public, which is world readable, and these screens carry
// coaches' emails and phone numbers. A drawing shows the shape of the screen
// and leaks nothing.
//
// SAME ACCORDION as the coach portal's Help (cap-help), so the two feel like
// one product. Native <details>, so no state, no keyboard handling, and it
// works with the browser's find-on-page.


/** The tab strip, drawn. Shows where things are and which row they sit on. */
function TabStripDiagram() {
  const row1 = ["Health", "Activity", "Scores", "Schedule", "Teams", "Roster Approval"];
  const row2 = ["Captains", "Payments", "Alerts", "Send Message", "Form submissions"];
  return (
    <svg viewBox="0 0 620 132" className="ah-fig" role="img"
      aria-label="The admin tab strip has two rows, with a More button at the right end of the first row holding Tournament logos, News, Photos, Sponsors, Branding, Pages, Player of Week and Audit log.">
      <rect x="0" y="0" width="620" height="132" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      {row1.map((t, i) => (
        <g key={t}>
          <rect x={12 + i * 88} y={14} width={80} height={24} rx="5"
            fill={i === 0 ? "#13284a" : "#fff"} stroke="#cbd5e1" />
          <text x={52 + i * 88} y={30} textAnchor="middle" fontSize="9"
            fill={i === 0 ? "#fff" : "#334155"} fontFamily="system-ui">{t}</text>
        </g>
      ))}
      <rect x="540" y="14" width="66" height="24" rx="5" fill="#fff" stroke="#94a3b8" strokeDasharray="3 2" />
      <text x="573" y="30" textAnchor="middle" fontSize="9" fill="#0f172a" fontWeight="700" fontFamily="system-ui">MORE ▾</text>
      {row2.map((t, i) => (
        <g key={t}>
          <rect x={12 + i * 104} y={46} width={96} height={24} rx="5" fill="#fff" stroke="#cbd5e1" />
          <text x={60 + i * 104} y={62} textAnchor="middle" fontSize="9" fill="#334155" fontFamily="system-ui">{t}</text>
        </g>
      ))}
      <path d="M573 40 L573 84 L400 84" stroke="#94a3b8" strokeWidth="1.2" fill="none" strokeDasharray="3 2" />
      <rect x="150" y="76" width="250" height="44" rx="6" fill="#fff" stroke="#94a3b8" strokeDasharray="3 2" />
      <text x="160" y="92" fontSize="9" fill="#475569" fontFamily="system-ui">Under MORE: Tournament logos, News,</text>
      <text x="160" y="105" fontSize="9" fill="#475569" fontFamily="system-ui">Photos, Sponsors, Branding, Pages,</text>
      <text x="160" y="115" fontSize="9" fill="#475569" fontFamily="system-ui">Player of Week, Audit log</text>
    </svg>
  );
}

/** What happens when a team registers. The thing people most often assume
 *  needs a button and does not. */
function RegistrationFlowDiagram() {
  const steps = [
    ["Coach fills in", "the form"],
    ["Team created", "automatically"],
    ["Coach emailed", "their 5-digit code"],
    ["You and Kaitlin", "emailed"],
  ];
  return (
    <svg viewBox="0 0 620 92" className="ah-fig" role="img"
      aria-label="A team registration automatically creates the team, emails the coach their five digit code, and emails the office. Nothing needs clicking.">
      <rect x="0" y="0" width="620" height="92" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
      {steps.map(([a, b], i) => (
        <g key={a}>
          <rect x={14 + i * 152} y={18} width={128} height={42} rx="6"
            fill={i === 0 ? "#fff" : "#eef6ee"} stroke={i === 0 ? "#cbd5e1" : "#86bf8a"} />
          <text x={78 + i * 152} y={38} textAnchor="middle" fontSize="10" fill="#0f172a" fontFamily="system-ui">{a}</text>
          <text x={78 + i * 152} y={51} textAnchor="middle" fontSize="10" fill="#0f172a" fontFamily="system-ui">{b}</text>
          {i < 3 && (
            <path
              d={`M${142 + i * 152} 39 L${14 + (i + 1) * 152} 39`}
              stroke="#94a3b8"
              strokeWidth="1.4"
              markerEnd="url(#ahArrow)"
            />
          )}
        </g>
      ))}
      <defs>
        <marker id="ahArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" fill="#94a3b8" />
        </marker>
      </defs>
      <text x="310" y="80" textAnchor="middle" fontSize="10" fill="#166534" fontWeight="700" fontFamily="system-ui">
        You do not click anything. It has already happened.
      </text>
    </svg>
  );
}

export function AdminHelp() {
  const office = "Adam";

  return (
    <div className="cap-tab cap-help ah">
      <div className="cap-section-head">
        <h2 className="cap-section-title">How to run the site</h2>
        <p className="cap-section-sub">
          Everything you actually need, in the order you need it. Click a
          section to open it.
        </p>
      </div>

      {/* ── start here ─────────────────────────────────────────────── */}
      <details open>
        <summary>Start here: the five minute version</summary>
        <div className="help-body">
          <p>
            Four things cover almost everything you will ever do:
          </p>
          <ul>
            <li>
              <strong>Form submissions</strong> — the inbox. Registrations,
              waivers and clinic signups land here.
            </li>
            <li>
              <strong>Scores</strong> — type in final scores after games.
            </li>
            <li>
              <strong>Schedule</strong> — add a game, move a game, rain a day out.
            </li>
            <li>
              <strong>Payments</strong> — who has paid, and chase who has not.
            </li>
          </ul>
          <p>
            Everything else is occasional. The tabs sit in two rows, and the
            less common ones hide behind <strong>MORE</strong> at the right
            hand end:
          </p>
          <TabStripDiagram />
          <p className="ah-note">
            On a phone the tab strip slides sideways. Swipe it to reach the
            tabs further along.
          </p>
        </div>
      </details>

      {/* ── registrations ──────────────────────────────────────────── */}
      <details>
        <summary>When a team registers</summary>
        <div className="help-body">
          <p>
            <strong>Nothing is waiting for you.</strong> This is the part most
            people expect to have to do by hand, and it is already done:
          </p>
          <RegistrationFlowDiagram />
          <p>
            By the time you read the email, the team exists, the coach has
            their sign-in code, and they can log in. You only need to open{" "}
            <strong>Form submissions</strong> if you want to read what they
            wrote, set their division, or record a payment.
          </p>
          <h4>To look at one</h4>
          <ul>
            <li>Click <strong>Form submissions</strong>.</li>
            <li>
              Click <strong>Team registration</strong> in the row of small
              buttons. The panel always opens on Player registration, which is
              always empty for us, so this is the first click every time.
            </li>
            <li>Click any row to open it. Emails and phone numbers are tappable.</li>
            <li>
              Set their <strong>Division</strong> from the dropdown, or the
              team reads &ldquo;Division TBD&rdquo; on the site.
            </li>
            <li>
              If they paid by Venmo, cheque or cash, click the matching{" "}
              <strong>Mark paid</strong> button. Card payments record
              themselves.
            </li>
            <li>
              Work the queue with <strong>Start review</strong> then{" "}
              <strong>Mark done</strong>.
            </li>
          </ul>
          <p className="ah-warn">
            <strong>NEEDS REVIEW in the subject line.</strong> Occasionally a
            registration trips an automatic spam check. It is still saved and
            the team is still created. The check catches real people, usually a
            password manager filling a hidden box, so treat it as real unless
            something in it is obviously junk.
          </p>
        </div>
      </details>

      {/* ── scores ─────────────────────────────────────────────────── */}
      <details>
        <summary>Putting in scores</summary>
        <div className="help-body">
          <ul>
            <li>Click <strong>Scores</strong>. It opens on the games still missing one.</li>
            <li>Type the away runs and the home runs.</li>
            <li>Press <strong>Enter</strong>, or click the green Save on that row.</li>
            <li>
              To do a batch, fill in several rows and click{" "}
              <strong>Save all changes</strong> at the bottom.
            </li>
          </ul>
          <p className="ah-warn">
            Saving here always marks a game <strong>final</strong>. To set a
            game back to scheduled, or to postponed or cancelled, use the{" "}
            <strong>Schedule</strong> tab instead.
          </p>
          <h4>When two coaches disagree</h4>
          <p>
            If both coaches report and their numbers differ, the score comes
            <strong> off</strong> the site straight away, you get an email, and
            it lands in <strong>Score Disputes</strong>. That tab shows both
            coaches&rsquo; numbers side by side with a button to take either
            one, or boxes to type your own.
          </p>
          <p className="ah-warn">
            <strong>Dismiss</strong> on a dispute puts the game back to
            unplayed with no score at all. Use it only when the game genuinely
            did not happen.
          </p>
        </div>
      </details>

      {/* ── schedule ───────────────────────────────────────────────── */}
      <details>
        <summary>Games: adding, moving, rain-outs</summary>
        <div className="help-body">
          <ul>
            <li>
              <strong>Add:</strong> Schedule, then the green{" "}
              <strong>+ Add Game</strong>. Only date and the two teams are
              required.
            </li>
            <li>
              <strong>Change:</strong> find the game, click{" "}
              <strong>Edit</strong>, then Save changes.
            </li>
            <li>
              <strong>Rain out a whole day:</strong> click{" "}
              <strong>Rain Out Day</strong>, check the date, click Rain out this
              date, then confirm the popup.
            </li>
          </ul>
          <p className="ah-note">
            The box opens on <strong>today</strong> in league time, and the
            amber line tells you how many scheduled games sit on that date
            before you click. The confirm names the date in full and the number
            of games, so a wrong date is caught before anything moves rather
            than after.
          </p>
          <p className="ah-warn">
            <strong>Nobody is told automatically.</strong> Marking a day rained
            out updates the website, and that is all it does. No email and no
            text goes to any coach or parent. Follow it with the{" "}
            <strong>Send Message</strong> tab, or they will drive to the field.
          </p>
          <ul>
            <li>
              Rain Out Day only moves games still marked{" "}
              <strong>scheduled</strong>. Anything already final or cancelled is
              left alone, so &ldquo;0 games affected&rdquo; usually means there
              was nothing to move.
            </li>
            <li>
              <strong>Delete is permanent.</strong> If you want to keep the
              record, click Edit and set the status to cancelled instead.
            </li>
          </ul>
        </div>
      </details>

      {/* ── money ──────────────────────────────────────────────────── */}
      <details>
        <summary>Money: who has paid, and chasing who has not</summary>
        <div className="help-body">
          <ul>
            <li>
              Click <strong>Payments</strong>. The four boxes across the top are
              collected, paid, still owed, and player payments.
            </li>
            <li>
              To record a Venmo, cheque or cash payment: type the amount in that
              team&rsquo;s box, pick the method, click <strong>Save on that
              same row</strong>.
            </li>
            <li>
              <strong>Email the unpaid</strong> writes to every unpaid team
              currently on screen.
            </li>
          </ul>
          <p className="ah-warn">
            <strong>Each row saves on its own.</strong> Type into five rows,
            click one Save, and only that row is kept. Sending reminders
            reloads the table and loses anything unsaved.
          </p>
          <p>
            {/* The old Card link button minted a Square hosted payment link
                and recorded nothing when it was paid, so a team who paid
                through it stayed on this tab as unpaid and got chased by the
                reminder emailer. Replaced 2026-08-20 by Copy pay link, which
                points at our own /pay page and does record. */}
            <strong>Copy pay link</strong> on an unpaid row copies that
            team&rsquo;s own payment page, ready to paste into a text or an
            email. The page shows the fee, the card fee and the total before
            any card is entered, and a payment made there lands on this tab
            straight away.
          </p>
          <p className="ah-note">
            Coaches can also pay themselves, without a link, on the{" "}
            <strong>My Team</strong> tab of the coach portal.
          </p>
          <p className="ah-warn">
            <strong>Some teams cannot be paid by card.</strong> If the office
            has already recorded any money against a team, or has changed what
            that team owes, the page refuses the card and says to contact the
            office. That is on purpose: the card would charge the full original
            fee, not the balance. Take those by Venmo or cheque and record them
            here.
          </p>
          <ul>
            <li>
              Card payments made on the registration form appear here on their
              own. A payment taken in your Square app does <strong>not</strong>,
              so type those in by hand.
            </li>
          </ul>
        </div>
      </details>

      {/* ── emailing people ────────────────────────────────────────── */}
      <details>
        <summary>Emailing coaches and your alert list</summary>
        <div className="help-body">
          <ul>
            <li>Click <strong>Send Message</strong>.</li>
            <li>
              Pick who gets it: everyone, registered coaches, or alert sign-ups.
            </li>
            <li>
              Scroll the names and <strong>untick anyone</strong> who should not
              get it. Greyed-out rows have no email and cannot be reached.
            </li>
            <li>
              Put your own address in <strong>Send yourself a test first</strong>{" "}
              and read it before sending for real.
            </li>
            <li>Then <strong>Send to everyone</strong>.</li>
          </ul>
          <p className="ah-warn">
            <strong>The form does not clear itself.</strong> Clicking Send a
            second time sends the same message again to the same people.
          </p>
          <p className="ah-warn">
            <strong>&ldquo;Registered coaches&rdquo; means every registration
            ever.</strong> There is no season filter, so Spring coaches are
            still on that list. Read the names before sending.
          </p>
          <ul>
            <li>
              Texting is not connected. If the Text box is greyed out, no text
              will go however the message is written.
            </li>
          </ul>
        </div>
      </details>

      {/* ── tournaments ────────────────────────────────────────────── */}
      <details>
        <summary>Changing a tournament logo</summary>
        <div className="help-body">
          <ul>
            <li>Click <strong>MORE</strong>, then <strong>Tournament logos</strong>.</li>
            <li>
              Find the tournament. They are in date order, Labor Day Lash Out at
              the top.
            </li>
            <li>
              Click <strong>Upload new</strong> and pick the artwork.{" "}
              <strong>Any size or format.</strong> It is resized for you.
            </li>
            <li>Wait for the button to stop saying Uploading. It is live immediately.</li>
            <li>
              <strong>Use original</strong> puts the built-in artwork back.
            </li>
          </ul>
          <p className="ah-ok">
            Nothing here can be broken. Use original always works, so it is safe
            to try something at 11pm.
          </p>
          <ul>
            <li>
              Artwork with a transparent background comes out on white, so send
              a version with the background you want.
            </li>
            <li>
              <strong>Logos only.</strong> Dates, prices, age groups and the
              tournament names still go through {office}.
            </li>
          </ul>
        </div>
      </details>

      {/* ── coaches and codes ──────────────────────────────────────── */}
      <details>
        <summary>Coach sign-in codes</summary>
        <div className="help-body">
          <p>
            Coaches sign in at <strong>islandfastpitch.com/captain</strong> by
            picking their team and typing a five digit code. There are no
            accounts and no passwords.
          </p>
          <ul>
            <li>
              <strong>To look one up:</strong> Captains tab, then click the code
              to copy it. Handy when a coach rings having lost their welcome
              email.
            </li>
            <li>
              <strong>To set or change one:</strong> Teams tab, Edit on that
              team, then the blue box. Tick &ldquo;Email this password to the
              coach&rdquo; and Save.
            </li>
          </ul>
          <p className="ah-warn">
            A dash or &ldquo;none&rdquo; in the Code column means that coach
            <strong> cannot get in at all</strong>. Set one in Teams.
          </p>
          <ul>
            <li>
              The Captains tab shows codes but cannot change them, and it has no
              refresh, so reload the page to see a coach who just logged in.
            </li>
          </ul>
        </div>
      </details>

      {/* ── teams ──────────────────────────────────────────────────── */}
      <details>
        <summary>Fixing a team</summary>
        <div className="help-body">
          <ul>
            <li>
              Teams tab, then <strong>Edit</strong> on the team&rsquo;s row.
              Name, age group, division, colour and logo all live here.
            </li>
            <li>
              Type the age group <strong>exactly</strong> as the others read:
              10U, 12U, 14U, 16/18U. A near miss like &ldquo;16U&rdquo; creates a
              second, half empty age button on the public site.
            </li>
          </ul>
          <p className="ah-warn">
            <strong>Deactivate is close to permanent.</strong> Reactivate does
            not currently work: it saves the name and leaves the team inactive.
            Only {office} can bring one back, so be sure.
          </p>
          <ul>
            <li>
              Deactivating takes a team off Standings but leaves its games on
              Schedule and Scores. Delete those separately if you want them gone.
            </li>
          </ul>
        </div>
      </details>

      {/* ── what not to worry about ────────────────────────────────── */}
      <details>
        <summary>Tabs you can ignore</summary>
        <div className="help-body">
          <p>
            These exist because the site runs several leagues. They do nothing
            here, and you are not missing anything by leaving them alone:
          </p>
          <ul>
            <li>
              <strong>Playoffs, Chat</strong> — switched off for us.
            </li>
            <li>
              <strong>Arbiter, Umpires</strong> — for leagues that assign
              umpires through the site. We do not.
            </li>
            <li>
              <strong>Player of Week, Photos, News</strong> — available if you
              ever want them, but nothing on the public site is waiting on them.
            </li>
            <li>
              <strong>Activity</strong> — meant to be a running feed, but our
              imported teams and games have no timestamps, so it stays nearly
              empty. Not broken, just quiet.
            </li>
            <li>
              <strong>Signed waivers</strong> — permanently empty. No page on
              the site submits that form.
            </li>
          </ul>
          <p>
            <strong>Player stats are off, but rosters are not.</strong> Coaches
            can add their players under Roster in the coach portal, and several
            already have. What is switched off is batting averages and player
            leaderboards, so the site shows scores and standings only.
          </p>
        </div>
      </details>

      {/* ── stuck ──────────────────────────────────────────────────── */}
      <details>
        <summary>Stuck, or something looks wrong?</summary>
        <div className="help-body">
          <p>
            Text {office}. Useful things to say: which tab you were on, what you
            clicked, and what you expected instead. A screenshot beats a
            description every time.
          </p>
          <p>
            Nothing in here can lose a registration. Every submission is kept
            even after it is deleted, under the{" "}
            <strong>Deleted</strong> filter on Form submissions, with a Restore
            button.
          </p>
        </div>
      </details>
    </div>
  );
}
