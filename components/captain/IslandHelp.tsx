"use client";

// Island's coach guide.
//
// Its own component rather than more conditionals inside the shared Help, for
// the same reason COYBL has one: Island's portal is a different shape. Stats
// are off, there is no calendar feed, no pitch counts, and three of the tabs
// in the shared guide are switched off here. Coaches were reading
// instructions for a portal they do not have.
//
// Written for a volunteer coach on a phone, standing at a field, who has done
// this once. Short sentences, the literal words that appear on the buttons,
// and the surprises said out loud rather than left to be discovered at 9pm
// after a game.
//
// The diagrams are drawn rather than screenshotted, so they cannot go stale
// against a screenshot nobody remembers to retake, and they carry no
// player names.

/** Signing in: pick the team, type the five digits.
 *
 *  This used to be the single thing coaches got wrong, because the box was
 *  labelled Password and no coach ever chose one. The label now reads
 *  "5-digit code", so the guide describes the fix rather than the trap. */
function SignInDiagram() {
  return (
    <svg viewBox="0 0 560 150" className="ih-fig" role="img"
      aria-label="Sign in by choosing your team from a list, then typing the five digit code the league emailed you. It is a code, not a password you chose.">
      <rect x="0" y="0" width="560" height="150" rx="8" fill="#0e1420" stroke="#1e2939" />
      <text x="20" y="26" fontSize="11" fill="#9aa4b2" fontFamily="system-ui">islandfastpitch.com/captain</text>

      <rect x="20" y="38" width="230" height="30" rx="6" fill="#16233a" stroke="#2a3d5f" />
      <text x="32" y="57" fontSize="11" fill="#e2e8f0" fontFamily="system-ui">1. Pick your team ▾</text>

      <rect x="20" y="78" width="230" height="30" rx="6" fill="#16233a" stroke="#2a3d5f" />
      <text x="32" y="97" fontSize="11" fill="#64748b" fontFamily="system-ui">2. 5-digit code</text>

      <rect x="20" y="118" width="110" height="24" rx="6" fill="#fff" />
      <text x="75" y="134" textAnchor="middle" fontSize="10" fill="#0b1730" fontWeight="700" fontFamily="system-ui">Sign in</text>

      <path d="M262 93 L296 93" stroke="#7fb2ff" strokeWidth="1.4" markerEnd="url(#ihArrow)" />
      <defs>
        <marker id="ihArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" fill="#7fb2ff" />
        </marker>
      </defs>
      <rect x="300" y="60" width="242" height="66" rx="6" fill="#16233a" stroke="#7fb2ff" strokeDasharray="3 2" />
      <text x="312" y="82" fontSize="10" fill="#e2e8f0" fontWeight="700" fontFamily="system-ui">Five digits, from your</text>
      <text x="312" y="98" fontSize="10" fill="#c7d2e0" fontFamily="system-ui">welcome email. There is no</text>
      <text x="312" y="112" fontSize="10" fill="#c7d2e0" fontFamily="system-ui">password and no account to</text>
      <text x="312" y="124" fontSize="10" fill="#c7d2e0" fontFamily="system-ui">create.</text>
    </svg>
  );
}

/** Reporting a score. The one thing every coach does, every week. */
function ScoreDiagram() {
  const steps = ["Submit Score", "Quick Score", "Type both", "Done"];
  return (
    <svg viewBox="0 0 560 96" className="ih-fig" role="img"
      aria-label="Tap Submit Score, then Quick Score on the game, type both teams' runs, and it is live on the site immediately.">
      <rect x="0" y="0" width="560" height="96" rx="8" fill="#0e1420" stroke="#1e2939" />
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={16 + i * 136} y={20} width={112} height={34} rx="6"
            fill={i === 3 ? "#14532d" : "#16233a"} stroke={i === 3 ? "#86efac" : "#2a3d5f"} />
          <text x={72 + i * 136} y={41} textAnchor="middle" fontSize="10"
            fill={i === 3 ? "#bbf7d0" : "#e2e8f0"} fontFamily="system-ui">{s}</text>
          {i < 3 && <path d={`M${128 + i * 136} 37 L${16 + (i + 1) * 136} 37`} stroke="#7fb2ff" strokeWidth="1.3" markerEnd="url(#ihArrow2)" />}
        </g>
      ))}
      <defs>
        <marker id="ihArrow2" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 z" fill="#7fb2ff" />
        </marker>
      </defs>
      <text x="280" y="76" textAnchor="middle" fontSize="10" fill="#86efac" fontWeight="700" fontFamily="system-ui">
        Live on the site straight away. You do not wait for the other coach.
      </text>
    </svg>
  );
}

export function IslandHelp({
  supportEmail,
}: {
  supportEmail?: string;
}) {
  const office = supportEmail ?? "mike.islandusssa@gmail.com";
  return (
    <div className="cap-tab cap-help ih">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Help</h2>
        <p className="cap-section-sub">
          How your coach page works. Tap a section to open it.
        </p>
      </div>

      <details open>
        <summary>1. Signing in</summary>
        <div className="help-body">
          <SignInDiagram />
          <ul>
            <li>
              Go to <strong>islandfastpitch.com/captain</strong>, or tap{" "}
              <strong>Coach Login</strong> under Information.
            </li>
            <li>Choose your team from the list.</li>
            <li>
              Type your <strong>five digit code</strong>. The league emailed it
              to you when your team registered.
            </li>
          </ul>
          <p className="ih-note">
            Search your inbox for &ldquo;Island Fastpitch&rdquo; if you cannot
            find the code. It was sent the moment your team registered.
          </p>
          <ul>
            <li>
              <strong>Lost it?</strong> Email{" "}
              <a href={`mailto:${office}`}>{office}</a> and the office will read
              it back to you.
            </li>
            <li>
              <strong>Eight wrong tries locks your team out for 15 minutes.</strong>{" "}
              Wait it out or ring the office. Nothing else clears it.
            </li>
            <li>
              There is no account and no password to remember. Anyone on your
              staff with the code can get in, so share it with your assistant.
            </li>
          </ul>
        </div>
      </details>

      <details>
        <summary>2. Reporting a score</summary>
        <div className="help-body">
          <ScoreDiagram />
          <ul>
            <li>Tap <strong>Submit Score</strong>.</li>
            <li>Find your game and tap <strong>Quick Score</strong>.</li>
            <li>Type both teams&rsquo; runs and confirm.</li>
          </ul>
          <p className="ih-ok">
            <strong>It is live immediately.</strong> You are not waiting on the
            other coach, and the score appears on the Scores and Schedule pages
            straight away.
          </p>
          <p className="ih-note">
            The confirmation mentions the league office confirming it. That is
            about the office reviewing it later, not about your score being held
            back. It is already published.
          </p>
          <h4>Wrong score?</h4>
          <p>
            Do the same thing again with the right numbers. The new one replaces
            the old.
          </p>
          <h4>If the other coach reports something different</h4>
          <p>
            The score comes <strong>off</strong> the site until the office sorts
            it out, and they are emailed automatically. You do not need to do
            anything, but a text to the other coach usually settles it faster.
          </p>
        </div>
      </details>

      <details>
        <summary>3. Your roster</summary>
        <div className="help-body">
          <ul>
            <li>
              Tap <strong>Roster</strong>, then <strong>Add Player</strong>.
            </li>
            <li>
              Only the name is required. Jersey number, position and date of
              birth are all optional.
            </li>
            <li>
              Tap <strong>Add Player</strong> again to save. Backing out loses
              what you typed.
            </li>
          </ul>
          <p className="ih-note">
            Every player shows a grey <strong>NO DOB</strong> badge whether or
            not you entered a birthday. It is cosmetic and nothing depends on
            it. Ignore it.
          </p>
          <p>
            Rosters are optional here. The league runs on scores and standings,
            so nothing breaks if you never add a player. It is useful for your
            own attendance and dues tracking.
          </p>
        </div>
      </details>

      <details>
        <summary>4. Your schedule</summary>
        <div className="help-body">
          <ul>
            <li>
              <strong>Schedule</strong> shows your games, upcoming on top and
              finished below.
            </li>
          </ul>
          <p className="ih-note">
            It is <strong>read only</strong>. Dates, times and fields are set by
            the league office. Email{" "}
            <a href={`mailto:${office}`}>{office}</a> to change one.
          </p>
          <p className="ih-warn">
            <strong>A rained-out game disappears from this tab</strong>, from
            both the upcoming and the finished list. That is not a mistake, but
            it does mean you should check the public Schedule page if a game
            seems to have vanished.
          </p>
        </div>
      </details>

      <details>
        <summary>5. Your team logo</summary>
        <div className="help-body">
          <ul>
            <li>Tap <strong>Team Logo</strong>, then pick a picture.</li>
            <li>
              Tap <strong>Save logo</strong>. Picking the file does not save it,
              and the button stays greyed out until you have chosen one.
            </li>
          </ul>
          <p className="ih-note">
            <strong>iPhone photos work.</strong> If you ever do get a message
            saying the picture could not be read, screenshot it and upload the
            screenshot instead. That converts it to a format any browser
            understands.
          </p>
          <p>
            A square logo looks best. It is shrunk down for the site, so a big
            photo of a team will come out soft.
          </p>
        </div>
      </details>

      <details>
        <summary>6. Team fees, and dues from your families</summary>
        <div className="help-body">
          <p>
            <strong>These are two different things and they live in two
            places.</strong>
          </p>
          <h4>What your team owes Island</h4>
          <p>
            On <strong>My Team</strong>, in a red box, with a{" "}
            <strong>Pay by card</strong> button. That is the league fee.
          </p>
          <h4>What your families owe you</h4>
          <p>
            The <strong>Payments</strong> tab. This is your own running list for
            your own dues, and nobody at the league sees it. It starts everyone
            at $0 until you type the numbers.
          </p>
          <p className="ih-note">
            Amounts save when you tap <strong>out</strong> of the box, not as
            you type. Closing the tab with the keyboard still up loses the last
            thing you entered.
          </p>
        </div>
      </details>

      <details>
        <summary>7. Attendance</summary>
        <div className="help-body">
          <ul>
            <li>
              <strong>Attendance</strong> tracks who is coming to each upcoming
              game.
            </li>
            <li>
              Use <strong>Captain Edit</strong> to set each player yes, no or
              maybe.
            </li>
          </ul>
          <p className="ih-note">
            Players and parents cannot reply themselves, so everything here is
            typed by you. It is a notepad for your own head count, not a poll.
          </p>
        </div>
      </details>

      <details>
        <summary>Put the site on your phone</summary>
        <div className="help-body">
          <p>
            It works like an app if you add it to your home screen, which makes
            reporting a score at the field much faster.
          </p>
          <ul>
            <li>
              <strong>iPhone:</strong> open the site in Safari, tap the share
              button, then <strong>Add to Home Screen</strong>.
            </li>
            <li>
              <strong>Android:</strong> open in Chrome, tap the three dots, then{" "}
              <strong>Install app</strong> or Add to Home screen.
            </li>
          </ul>
        </div>
      </details>

      <details>
        <summary>Something looks wrong?</summary>
        <div className="help-body">
          <p>
            Email <a href={`mailto:${office}`}>{office}</a>. It helps to say
            which game, and what you expected to see.
          </p>
          <p>
            Nothing you can do here breaks anything permanently. Scores can be
            resubmitted, players can be re-added, and the office can undo
            anything you cannot.
          </p>
        </div>
      </details>
    </div>
  );
}
