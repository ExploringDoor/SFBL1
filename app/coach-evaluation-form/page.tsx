// Public coach evaluation form. The mirror image of the umpire evaluation:
// there, coaches grade the officials; here, the officials grade the coaches.
//
// Mike asked for this on 2026-09-01, "a coaches evaluation on the site just
// like umpires", the same day he set up an umpire in chief. The pairing is the
// point. A league that lets coaches file on umpires and gives umpires nowhere
// to file back only ever hears one side of a Saturday morning.
//
// WHO FILLS IT IN. Umpires, about the coach and the bench. That is the natural
// reciprocal of the umpire form and the reason it exists, but it is the one
// assumption in this file worth re-reading: if Mike meant parents evaluating
// their own coach, the fields below are wrong and the audience line under the
// title is the first thing to change.
//
// WHAT IT IS NOT. Not a complaint box for parents, and not published anywhere.
// It lands in /form_submissions/coach_evaluation for the office, exactly like
// the umpire one, and nothing about it renders on the public site.
//
// Server component (async) for the same reason the umpire form is: the team
// fields hydrate from the real roster, and a tenant hiding its field gets
// typed names instead of a dropdown that would leak it.

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { loadTeamOptions, teamNameField, teamsHidden } from "@/lib/team-options";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const OTHER = "Other / Not listed";

export default async function CoachEvaluationPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();
  const abbrev = config?.abbrev ?? config?.name ?? "";
  const hidden = teamsHidden(config);
  const teams = await loadTeamOptions(tenantId, config);

  const FIELDS: FormField[] = [
    { name: "evaluator_name", label: "Your Name", type: "text", required: true, width: "half" },
    {
      name: "evaluator_role",
      label: "Your Role",
      type: "select",
      width: "half",
      options: [
        { value: "Umpire", label: "Umpire" },
        { value: "Umpire in chief", label: "Umpire in chief" },
        { value: "League official", label: "League official" },
        { value: OTHER, label: OTHER },
      ],
    },
    { name: "phone", label: "Cell Phone", type: "tel", width: "half" },
    { name: "game_date", label: "Game Date", type: "date", required: true, width: "half" },
    { name: "game_time", label: "Game Time", type: "text", placeholder: "e.g. 9:30 AM", width: "half" },
    { name: "field", label: "Field", type: "text", width: "half" },
    // Required, so a sentinel-only dropdown would file every evaluation under
    // "Other / Not listed @ Other / Not listed" and the office would lose the
    // only index it has for these. Typed names while the field is private.
    teamNameField({
      name: "visiting_team",
      label: "Visiting Team",
      teams,
      hidden,
      required: true,
      width: "half",
      trailingOptions: [{ value: OTHER, label: OTHER }],
      placeholder: "Team name",
      hiddenHelp:
        "Type the team names. The team list goes up when the schedule is released.",
    }),
    teamNameField({
      name: "home_team",
      label: "Home Team",
      teams,
      hidden,
      required: true,
      width: "half",
      trailingOptions: [{ value: OTHER, label: OTHER }],
      placeholder: "Team name",
    }),

    // ── The coach being graded ───────────────────────────────────
    // One coach per submission, named, rather than a rating per team. An
    // evaluation that says "the home bench" is not something the office can
    // act on, and the umpire form's own lesson is that a name is what makes a
    // pattern visible across a season.
    {
      name: "coach_name",
      label: "Coach being evaluated",
      type: "text",
      required: true,
      width: "half",
      help: "The head coach, or whoever was running the bench.",
    },
    teamNameField({
      name: "coach_team",
      label: "Their Team",
      teams,
      hidden,
      required: true,
      width: "half",
      trailingOptions: [{ value: OTHER, label: OTHER }],
      placeholder: "Team name",
    }),

    // Four ratings rather than one. "Rate this coach 1 to 5" produces a number
    // nobody can defend at a hearing; these are the four things a league can
    // actually act on separately, and sportsmanship is the one that matters.
    {
      name: "sportsmanship_rating",
      label: "Sportsmanship and conduct",
      type: "rating",
      width: "half",
      help: "1 (poor) — 5 (excellent)",
    },
    {
      name: "rules_rating",
      label: "Knowledge of the rules",
      type: "rating",
      width: "half",
      help: "1 (poor) — 5 (excellent)",
    },
    {
      name: "players_rating",
      label: "Treatment of players",
      type: "rating",
      width: "half",
      help: "1 (poor) — 5 (excellent)",
    },
    {
      name: "officials_rating",
      label: "Treatment of officials",
      type: "rating",
      width: "half",
      help: "1 (poor) — 5 (excellent)",
    },
    {
      name: "coach_comments",
      label: "Comments about this coach",
      type: "textarea",
      width: "full",
      help: "Be specific. What was said or done, and when in the game.",
    },
    // Separate from the comments box on purpose. A yes here is the difference
    // between a note for the file and something the office has to open today,
    // and burying that inside free text is how it gets missed.
    {
      name: "incident",
      label: "Was there an ejection or an incident the league should follow up?",
      type: "select",
      width: "half",
      options: [
        { value: "No", label: "No" },
        { value: "Yes", label: "Yes" },
      ],
    },
    {
      name: "incident_details",
      label: "If yes, what happened?",
      type: "textarea",
      width: "full",
    },
    {
      name: "general_comments",
      label: "General comments / suggestions for the league",
      type: "textarea",
      width: "full",
    },
  ];

  return (
    <LeagueForm
      kind="coach_evaluation"
      eyebrow={abbrev}
      title="Coach Evaluation"
      description="For umpires and league officials to grade a coach after a game. The league reviews every submission."
      intro={[
        "Be specific and constructive. Patterns across multiple submissions are what the league acts on, and a single bad afternoon usually is not.",
        "This is not published anywhere. Only the league office sees it.",
      ]}
      fields={FIELDS}
      submitLabel="Submit evaluation"
      successMessage="Thank you. The league office reviews every evaluation."
    />
  );
}
