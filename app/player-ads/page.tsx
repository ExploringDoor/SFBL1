// Public Player Ads board + post form.
//
// Replaces Island's Facebook group: coaches with roster spots and players
// looking for a team post here, ads appear once the league office approves
// them, and answering an ad relays through /api/player-ad-contact so nobody's
// contact details are published.
//
// Reads the PUBLIC projection at /leagues/{id}/player_ads — approved, redacted
// ads only. The submitted originals (with name/email/phone) live in
// /form_submissions/player_ad, which is default-deny; this page never touches
// them. See /api/admin-player-ads for the boundary.
//
// The intro copy tells posters their contact stays private, because otherwise
// people paste a phone number into the message body, which IS published.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { PlayerAdBoard, type PlayerAd } from "@/components/PlayerAdBoard";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { markdownToHtml } from "@/lib/markdown";
import { extractLeadingH1 } from "@/components/ContentSections";

export const dynamic = "force-dynamic";

const FIELDS: FormField[] = [
  {
    name: "posted_by",
    label: "I am",
    type: "radio",
    required: true,
    options: [
      { value: "coach", label: "A coach with roster spots to fill" },
      { value: "player", label: "A player or parent looking for a team" },
    ],
    width: "full",
  },
  {
    name: "age_group",
    label: "Age Group",
    type: "select",
    required: true,
    options: ["8U", "10U", "12U", "14U", "16U", "18U"].map((a) => ({
      value: a,
      label: a,
    })),
    width: "half",
  },
  {
    name: "position",
    label: "Position",
    type: "text",
    placeholder: "Catcher, pitcher, middle infield…",
    help: "Coaches: what you need. Players: what you play.",
    width: "half",
  },
  {
    name: "town",
    label: "Town",
    type: "text",
    placeholder: "Smithtown",
    help: "Shown publicly so people can judge travel.",
    width: "half",
  },
  {
    name: "team_name",
    label: "Team Name",
    type: "text",
    help: "Coaches only. Shown publicly on your ad.",
    width: "half",
  },
  {
    name: "message",
    label: "Your Ad",
    type: "textarea",
    required: true,
    placeholder:
      "Tell people what you are looking for. Practice nights, travel, tryout dates.",
    help: "This text is published. Do NOT put a phone number or email here — responses reach you through the league.",
    width: "full",
  },
  {
    name: "contact_name",
    label: "Your Name",
    type: "text",
    required: true,
    help: "Kept private. The league office sees it; the board does not.",
    width: "half",
  },
  {
    name: "email",
    label: "Your Email",
    type: "email",
    required: true,
    help: "Kept private. Replies are relayed to you here.",
    width: "half",
  },
  {
    name: "phone",
    label: "Your Phone",
    type: "tel",
    help: "Optional, kept private. For the league office only.",
    width: "half",
  },
  {
    name: "agreed_to_terms",
    label:
      "I understand my ad is reviewed before it appears, and that my name, email and phone are not published on the site.",
    type: "checkbox",
    required: true,
    width: "full",
  },
];

// Island already has a Player Ads Facebook group with people in it, and that
// community does not move just because we shipped a board. If the tenant has a
// page_content/player-ads doc, its body renders as a note under the header so
// that link survives. Generic on purpose: any tenant can put a note here.
async function loadNote(tenantId: string): Promise<string> {
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${tenantId}/page_content/player-ads`)
      .get();
    if (!snap.exists) return "";
    const d = snap.data() ?? {};
    const raw =
      (typeof d.html === "string" && d.html) ||
      markdownToHtml(String(d.markdown ?? ""));
    // Drop the leading "# Player Ads" — the page already has that heading.
    return extractLeadingH1(raw).body;
  } catch {
    return "";
  }
}

async function loadAds(tenantId: string): Promise<PlayerAd[]> {
  try {
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/player_ads`)
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<PlayerAd, "id">) }))
      .sort((a, b) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
      );
  } catch {
    return [];
  }
}

export default async function PlayerAdsPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Player ads are tenant-scoped. Visit a tenant subdomain.</p>
      </main>
    );
  }

  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  const [ads, note] = await Promise.all([loadAds(tenantId), loadNote(tenantId)]);

  return (
    <main className="container py-10">
      <header style={{ marginBottom: 22 }}>
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          {config?.abbrev ?? "League"}
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            lineHeight: 0.95,
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Player Ads
        </h1>
        <p style={{ marginTop: 10, color: "var(--muted)", maxWidth: 680 }}>
          Where coaches seeking players and parents and players in search of
          teams can post. Browse the board, or post your own below. Contact
          details are never shown publicly, responses come to you through the
          league.
        </p>
      </header>

      {note && (
        <div
          className="prose prose-slate max-w-none [&_p]:my-2 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold"
          style={{
            borderLeft: "3px solid var(--brand-accent, #35afea)",
            paddingLeft: 16,
            marginBottom: 24,
            fontSize: 15,
            color: "var(--text-body)",
          }}
          dangerouslySetInnerHTML={{ __html: note }}
        />
      )}

      <PlayerAdBoard ads={ads} />

      <div style={{ marginTop: 40 }}>
        <LeagueForm
          kind="player_ad"
          title="Post an Ad"
          description="Ads are reviewed by the league office before they appear on the board."
          fields={FIELDS}
          submitLabel="Post My Ad"
          successMessage="Got it. Your ad goes up once the league office approves it."
        />
      </div>
    </main>
  );
}
