// Public "Suggest a change" form. Anyone using the site — coach, parent,
// umpire, board member — can report something broken, confusing, or missing,
// or ask for something new.
//
// Submissions land in /form_submissions/site_feedback and show up in the
// admin Form submissions tab under "Site feedback", where they get the same
// new / in progress / done triage as everything else.
//
// Deliberately NO email to the league office (Adam, 2026-08-04): Doug reads
// these in the admin panel. A per-submission email would just be another
// inbox to keep on top of, and feedback is not time-critical the way an
// unpaid registration is.
//
// Name and email are deliberately OPTIONAL. Requiring them is the fastest way
// to stop hearing about the things people find embarrassing to ask about, and
// "this page confused me" is useful even unsigned.

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";

export const dynamic = "force-dynamic";

const FIELDS: FormField[] = [
  {
    name: "topic",
    label: "What is this about?",
    type: "select",
    required: true,
    width: "half",
    options: [
      { value: "Something is broken", label: "Something is broken" },
      { value: "Something is wrong or out of date", label: "Something is wrong or out of date" },
      { value: "Something is confusing", label: "Something is confusing" },
      { value: "I'd like a new feature", label: "I'd like a new feature" },
      { value: "Something else", label: "Something else" },
    ],
  },
  {
    name: "role",
    label: "You are a…",
    type: "select",
    width: "half",
    options: [
      { value: "Coach or manager", label: "Coach or manager" },
      { value: "Parent", label: "Parent" },
      { value: "Umpire", label: "Umpire" },
      { value: "Board member", label: "Board member" },
      { value: "Other", label: "Other" },
    ],
  },
  {
    name: "page",
    label: "Which page?",
    type: "text",
    width: "full",
    placeholder: "e.g. Standings, or the schedule on my team page",
    help: "Optional, but it saves us guessing.",
  },
  {
    name: "message",
    label: "Tell us about it",
    type: "textarea",
    required: true,
    width: "full",
    help: "What were you trying to do, and what happened instead? The more specific the better.",
  },
  {
    name: "name",
    label: "Your name",
    type: "text",
    width: "half",
    help: "Optional.",
  },
  {
    name: "email",
    label: "Your email",
    type: "email",
    width: "half",
    help: "Optional. Only needed if you want an answer.",
  },
];

export default function FeedbackPage() {
  const h = headers();
  let abbrev = "the league";
  try {
    const cfg = JSON.parse(h.get("x-tenant-config-json") ?? "{}") as {
      abbrev?: string;
      name?: string;
    };
    abbrev = cfg.abbrev ?? cfg.name ?? "the league";
  } catch {
    /* keep the default */
  }

  return (
    <LeagueForm
      kind="site_feedback"
      eyebrow={abbrev}
      title="Suggest a change"
      description="Found something broken, confusing, or just plain wrong? Want something the site doesn't do yet? Tell us. This goes straight to the league, and every one gets read."
      intro={[
        "You don't have to leave your name. Add an email only if you want a reply.",
      ]}
      fields={FIELDS}
      submitLabel="Send it"
      successMessage="Thanks, we got it. Someone from the league will take a look, and if you left an email and it needs an answer you'll hear back."
    />
  );
}
