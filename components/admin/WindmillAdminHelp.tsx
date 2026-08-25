// Windmill's own admin "How to" tab. The shared AdminHelp is written for
// Island (magic-link logins, its own URL), so Windmill gets a version matching
// its real setup: shared admin password, per-team captain codes, Venmo/check
// payments. Mirrors the Windmill Admin Guide PDF. Screenshots to be added.

const CHEAT: [string, string][] = [
  ["Put in game scores", "Scores"],
  ["Fix a disagreed score", "Score Disputes"],
  ["Move or rain out a game", "Schedule"],
  ["Find or reset a coach code", "Captains"],
  ["Review team signups", "Form submissions"],
  ["Record a payment", "Payments"],
  ["Post a homepage notice", "Alerts"],
  ["Email or text coaches", "Send Message"],
  ["Edit Rules, Parents, etc.", "Pages"],
];

interface Step {
  n: number;
  title: string;
  tab?: string;
  steps: string[];
  note?: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Getting in",
    steps: [
      "Go to windmill-site.vercel.app/admin.",
      "Enter the league admin password (Adam has it; it can be changed anytime).",
      "You land on the dashboard. Tools run along the top as tabs; less-common ones are under More.",
    ],
  },
  {
    n: 2,
    title: "Entering game scores",
    tab: "Scores",
    steps: [
      "Open Scores.",
      "Find the game, type the two final scores, and press Enter or Save.",
      "Standings, records, and streaks update on their own. Coaches can also submit their game's score from their team login.",
    ],
  },
  {
    n: 3,
    title: "Score disputes",
    tab: "Score Disputes",
    steps: [
      "If the two coaches report different scores for a game, it shows up here.",
      "Open it, pick the correct final, and save. Your call is final and locks the game.",
    ],
  },
  {
    n: 4,
    title: "Changing the schedule",
    tab: "Schedule",
    steps: [
      "Open Schedule and find the game.",
      "To move it: change the date, time, or field, then save.",
      "To rain out a date: mark it rained out. Those games can be rescheduled later.",
    ],
    note: "Changing a game does not automatically alert coaches yet. To tell them, post an Alert (step 8) or use Send Message (step 9).",
  },
  {
    n: 5,
    title: "Coaches and their login codes",
    tab: "Captains",
    steps: [
      "Every team has its own code, a club word plus four digits (e.g. tornados4821). Coaches sign in at windmill-site.vercel.app/captain by picking their team and entering the code.",
      "Open Captains to see each team's code, whether it is set, and when the coach last logged in.",
      "To reset a code: open the team and set a new one.",
    ],
    note: "Once email is switched on, you can email a coach their code from this tab. Until then, copy the code and send it yourself.",
  },
  {
    n: 6,
    title: "Registrations",
    tab: "Form submissions",
    steps: [
      "Open Form submissions to see every team that registered online, with coach and rec/club-lead contacts, division, and skill level.",
      "Use Signups to approve any players a coach added.",
      "Nothing is ever lost. Every submission is saved, even one flagged by the spam check.",
    ],
  },
  {
    n: 7,
    title: "Payments",
    tab: "Payments",
    steps: [
      "Open Payments to see who has paid, per team, with running totals.",
      "To log a Venmo, check, or cash payment: type the amount for that team and click Mark paid.",
      "You can send a team its own card-payment link to paste into a text or email.",
    ],
    note: "Card payments made on the registration form appear here automatically. A payment in your own Square app does NOT sync, record those by hand. Accepting cards on the site needs Ken's Square account connected; Venmo, check, and pay-later work today.",
  },
  {
    n: 8,
    title: "Posting a homepage alert",
    tab: "Alerts",
    steps: [
      "Open Alerts.",
      "Type a title and message, choose a level (info, warning, or critical), and publish.",
      "It appears across the top of the whole site right away. Clear it when it no longer applies.",
    ],
  },
  {
    n: 9,
    title: "Messaging coaches",
    tab: "Send Message",
    steps: [
      "Open Send Message.",
      "Pick who gets it: everyone, registered coaches, or your alert sign-up list.",
      "Write it and send. It goes out by email and text.",
    ],
    note: "Sending switches on once the email and text service is connected.",
  },
];

const AS_NEEDED: [string, string][] = [
  ["Pages", "Edit Rules, Divisions, Parent Resources, and other content pages. Changes go live right away."],
  ["Teams", "Edit a team's name or division, or import a roster."],
  ["Photos", "Add photos to the public gallery."],
];

export function WindmillAdminHelp() {
  return (
    <div className="max-w-3xl space-y-6 text-slate-800">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Running the site</h2>
        <p className="mt-1 text-sm text-slate-600">
          A plain-English walkthrough of the day-to-day tasks. Nothing here can
          lose data. (Step-by-step screenshots are being added.)
        </p>
      </div>

      {/* cheat sheet */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
          Quick reference &mdash; where things live
        </div>
        <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {CHEAT.map(([task, tab]) => (
            <div
              key={task}
              className="flex items-baseline justify-between gap-3 border-b border-dashed border-slate-200 py-1 text-sm"
            >
              <span>{task}</span>
              <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-wide text-emerald-900">
                {tab}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* steps */}
      <div className="space-y-5">
        {STEPS.map((s) => (
          <section key={s.n} className="rounded-lg border border-slate-200 p-4">
            <h3 className="flex items-baseline gap-2 text-base font-bold text-slate-900">
              <span className="text-emerald-700">{s.n}.</span>
              <span>{s.title}</span>
              {s.tab && (
                <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                  {s.tab}
                </span>
              )}
            </h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              {s.steps.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
            {s.note && (
              <p className="mt-3 rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-[13px] text-slate-700">
                {s.note}
              </p>
            )}
          </section>
        ))}
      </div>

      {/* as-needed */}
      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-base font-bold text-slate-900">As needed</h3>
        <dl className="mt-2 space-y-1.5 text-sm">
          {AS_NEEDED.map(([tab, desc]) => (
            <div key={tab} className="flex gap-3">
              <dt className="w-20 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-emerald-900">
                {tab}
              </dt>
              <dd className="text-slate-700">{desc}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-sm text-slate-500">
        Questions any time: Adam Miller &middot; adam.miller.22@gmail.com &middot;
        610-804-9222
      </p>
    </div>
  );
}
