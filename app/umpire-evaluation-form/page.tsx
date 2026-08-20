// Public umpire evaluation form. Mirrors sfbl.com/umpire-evaluation-form/.
// Captains/managers grade the plate + field umpires after a game on a
// 1–5 star scale with optional comments. Submissions land in
// /form_submissions/umpire_evaluation for league review.
//
// Server component (async) so we hydrate the three team-name fields
// (Your Team / Visiting / Home) with real roster data. Matches the
// player-registration pattern, including the part where a tenant hiding its
// field gets typed names instead: this page carried the roster three times
// over in view-source while /teams was showing the private notice.

import { headers } from "next/headers";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { loadTeamOptions, teamNameField, teamsHidden } from "@/lib/team-options";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const OTHER = "Other / Not listed";

export default async function UmpireEvaluationPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  // The whole config, not just the abbrev: the three team fields below need
  // flags.hide_teams off the same header.
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
    // All three are required, so a sentinel-only dropdown would land every
    // evaluation in the admin as "Other / Not listed @ Other / Not listed",
    // which is the only index the office has for these (see summaryLine in
    // components/admin/FormSubmissionsViewer.tsx). Typed names instead.
    teamNameField({
      name: "team_affiliation",
      label: "Your Team",
      teams,
      hidden,
      required: true,
      width: "half",
      trailingOptions: [{ value: OTHER, label: OTHER }],
      placeholder: "Your team name",
      hiddenHelp:
        "Type the team names. The team list goes up when the schedule is released.",
    }),
    { name: "phone", label: "Cell Phone", type: "tel", width: "half" },
    { name: "game_date", label: "Game Date", type: "date", required: true, width: "half" },
    { name: "game_time", label: "Game Time", type: "text", placeholder: "e.g. 9:30 AM", width: "half" },
    { name: "field", label: "Field", type: "text", width: "half" },
    teamNameField({
      name: "visiting_team",
      label: "Visiting Team",
      teams,
      hidden,
      required: true,
      width: "half",
      trailingOptions: [{ value: OTHER, label: OTHER }],
      placeholder: "Team name",
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

  return (
    <LeagueForm
      kind="umpire_evaluation"
      eyebrow={abbrev}
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
