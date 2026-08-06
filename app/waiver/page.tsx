// Public parent-signed liability release, ONE PER PLAYER.
//
// Deliberately not the existing /team-waiver-form. That one is SFBL's adult
// model: a manager types their name once on behalf of an entire roster, under
// text that asserts "every team member is at least 18 years of age". Pointing
// it at a 7U-to-14U league would have a coach releasing claims for twelve
// children he has no authority to sign for. So this is per player, and the
// person signing has to say who they are and how they are related to the
// child.
//
// THE RELEASE TEXT IS NOT WRITTEN HERE. It comes from the tenant's own
// page_content/waiver document. If the league has not published one, this page
// REFUSES to collect signatures rather than inventing wording — a release is a
// legal document and its text is the league's (and its insurer's) to decide.
// An empty waiver that looks signed is worse than no waiver at all, because it
// creates a false record.
//
// Submissions land in form_submissions/player_waiver and show in the admin
// Form submissions tab under "Signed waivers".

import { headers } from "next/headers";
import Link from "next/link";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

const OTHER = "Other / not listed";

async function loadTeams(tenantId: string | null) {
  if (!tenantId) return [] as { value: string; label: string }[];
  try {
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/teams`)
      .get();
    return snap.docs
      .filter((d) => d.data().active !== false)
      .map((d) => {
        const name = String(d.data().name ?? d.id);
        const age = String(d.data().ageGroup ?? "");
        return { value: name, label: age ? `${name} (${age})` : name };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

/** The league's own release wording, or "" when it has not published one. */
async function loadWaiverText(tenantId: string | null): Promise<string> {
  if (!tenantId) return "";
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${tenantId}/page_content/waiver`)
      .get();
    return snap.exists ? String(snap.data()?.markdown ?? "").trim() : "";
  } catch {
    return "";
  }
}

export default async function PlayerWaiverPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  let abbrev = "the league";
  let leagueName = "the league";
  try {
    const cfg = JSON.parse(h.get("x-tenant-config-json") ?? "{}") as {
      abbrev?: string;
      name?: string;
    };
    abbrev = cfg.abbrev ?? cfg.name ?? "the league";
    leagueName = cfg.name ?? abbrev;
  } catch {
    /* defaults */
  }

  const [teams, waiverText] = await Promise.all([
    loadTeams(tenantId),
    loadWaiverText(tenantId),
  ]);

  // No published release means no signatures. Collecting a typed name against
  // blank terms would produce records that look like waivers and are not.
  if (!waiverText) {
    return (
      <main className="container py-12">
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          {abbrev}
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(32px, 5vw, 52px)",
            lineHeight: 1,
            color: "var(--text-strong)",
            margin: "0 0 14px",
          }}
        >
          Liability release
        </h1>
        <p style={{ color: "var(--muted)", maxWidth: 620 }}>
          {leagueName} hasn&rsquo;t published its liability release yet, so
          there is nothing to sign here.
        </p>
        <p style={{ color: "var(--muted)", maxWidth: 620, marginTop: 10 }}>
          If you have been asked to sign one, contact the league office and
          they will tell you how.
        </p>
        <p style={{ marginTop: 18 }}>
          <Link
            href="/content/contact"
            style={{ color: "var(--brand-primary)", fontWeight: 700 }}
          >
            League contacts &rarr;
          </Link>
        </p>
      </main>
    );
  }

  const teamOptions = [...teams, { value: OTHER, label: OTHER }];

  const FIELDS: FormField[] = [
    {
      name: "player_first_name",
      label: "Player First Name",
      type: "text",
      required: true,
      width: "half",
    },
    {
      name: "player_last_name",
      label: "Player Last Name",
      type: "text",
      required: true,
      width: "half",
    },
    {
      name: "player_dob",
      label: "Player Date of Birth",
      type: "date",
      required: true,
      width: "half",
    },
    {
      name: "team_name",
      label: "Team",
      type: "select",
      required: true,
      options: teamOptions,
      width: "half",
      help: "Pick your child's team. If it isn't listed yet, choose Other.",
    },

    {
      name: "parent_first_name",
      label: "Your First Name",
      type: "text",
      required: true,
      width: "half",
    },
    {
      name: "parent_last_name",
      label: "Your Last Name",
      type: "text",
      required: true,
      width: "half",
    },
    {
      name: "relationship",
      label: "You are the player's…",
      type: "select",
      required: true,
      width: "half",
      options: [
        { value: "Parent", label: "Parent" },
        { value: "Legal guardian", label: "Legal guardian" },
      ],
      help: "Only a parent or legal guardian can sign for a minor.",
    },
    {
      name: "email",
      label: "Your Email",
      type: "email",
      required: true,
      width: "half",
    },
    {
      name: "phone",
      label: "Your Cell Phone",
      type: "tel",
      required: true,
      width: "half",
    },

    {
      name: "emergency_name",
      label: "Emergency Contact Name",
      type: "text",
      width: "half",
      help: "Someone else we can reach at a game if we cannot reach you.",
    },
    {
      name: "emergency_phone",
      label: "Emergency Contact Phone",
      type: "tel",
      width: "half",
    },
    {
      name: "medical_notes",
      label: "Allergies or medical notes coaches should know (optional)",
      type: "textarea",
      width: "full",
    },

    {
      name: "signature",
      label: "Type your full name as your signature",
      type: "text",
      required: true,
      width: "half",
      help: "Typing your name here has the same effect as signing on paper.",
    },
    {
      name: "signature_date",
      label: "Date",
      type: "date",
      width: "half",
    },
    {
      name: "agreed_to_terms",
      label:
        "I am the parent or legal guardian of the player named above. I have read the release in full and I agree to it on their behalf.",
      type: "checkbox",
      required: true,
      width: "full",
    },
  ];

  return (
    <LeagueForm
      kind="player_waiver"
      eyebrow={abbrev}
      title="Liability release"
      description={`One release per player, signed by a parent or legal guardian. If you have more than one child in ${abbrev}, fill this in once for each of them.`}
      intro={[
        "Read the release below in full before signing. If anything in it is unclear, ask the league office before you agree.",
      ]}
      waiverText={waiverText}
      fields={FIELDS}
      submitLabel="Sign and submit"
      successMessage="Thanks. Your signed release has been recorded and the league office can see it. If you have another child in the league, fill this in again for them."
    />
  );
}
