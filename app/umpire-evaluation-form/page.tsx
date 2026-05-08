// Public umpire evaluation form. Mirrors sfbl.com/umpire-evaluation-form/.
// Captains/managers grade the plate + field umpires after a game on a
// 1–5 star scale with optional comments. Submissions land in
// /form_submissions/umpire_evaluation for league review.

import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";

const FIELDS: FormField[] = [
  { name: "evaluator_name", label: "Your Name", type: "text", required: true, width: "half" },
  { name: "team_affiliation", label: "Your Team", type: "text", required: true, width: "half" },
  { name: "phone", label: "Cell Phone", type: "tel", width: "half" },
  { name: "game_date", label: "Game Date", type: "date", required: true, width: "half" },
  { name: "game_time", label: "Game Time", type: "text", placeholder: "e.g. 9:30 AM", width: "half" },
  { name: "field", label: "Field", type: "text", width: "half" },
  { name: "visiting_team", label: "Visiting Team", type: "text", required: true, width: "half" },
  { name: "home_team", label: "Home Team", type: "text", required: true, width: "half" },

  // ── Plate umpire ─────────────────────────────────────────────
  { name: "plate_umpire_name", label: "Home Plate Umpire", type: "text", width: "half" },
  {
    name: "plate_umpire_rating",
    label: "Plate Umpire Rating",
    type: "rating",
    width: "half",
    help: "1 (poor) — 5 (excellent)",
  },
  {
    name: "plate_umpire_comments",
    label: "Plate Umpire Comments",
    type: "textarea",
    width: "full",
  },

  // ── Field umpire ─────────────────────────────────────────────
  { name: "field_umpire_name", label: "Field Umpire", type: "text", width: "half" },
  {
    name: "field_umpire_rating",
    label: "Field Umpire Rating",
    type: "rating",
    width: "half",
    help: "1 (poor) — 5 (excellent)",
  },
  {
    name: "field_umpire_comments",
    label: "Field Umpire Comments",
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

export default function UmpireEvaluationPage() {
  return (
    <LeagueForm
      kind="umpire_evaluation"
      title="Umpire Evaluation"
      description="Use this form to grade the umpires from your most recent game. The league reviews every submission."
      intro={[
        "Be specific and constructive. Patterns across multiple submissions inform umpire assignments next season.",
      ]}
      fields={FIELDS}
      submitLabel="Submit Evaluation"
      successMessage="Thanks for the feedback. The league office reads every evaluation."
    />
  );
}
