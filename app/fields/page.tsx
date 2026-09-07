// Public fields directory. Tenant-scoped: first tries to read the
// rich field list out of /leagues/<id>/site_config/fields (set by
// admin or a migration script), falls back to the hardcoded SFBL
// list when no doc exists.
//
// Tenant-doc shape (matches LBDC's lbdc_fields source):
//   { data: Array<{
//       name: string,
//       location?: string,
//       address: string,
//       mapsUrl?: string,        // Google Maps deep-link
//       appleMapsUrl?: string,   // Apple Maps deep-link
//       notes?: string[],        // optional bullet list / description
//       color?: string,          // accent color for the card
//     }> }

import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldsDirectory, type Field } from "@/components/FieldsDirectory";
import { FieldsByClub } from "@/components/FieldsByClub";
import { FieldsMap } from "@/components/FieldsMap";
import FieldsWindmill, { type WindmillField } from "@/components/FieldsWindmill";
import { defaultFieldsFor } from "@/lib/tenant-default-fields";

export const dynamic = "force-dynamic";


// SFBL field directory — authoritative list supplied by Adam
// (2026-05-18), alphabetical. SFBL serves from this hardcoded
// fallback (no /leagues/sfbl/site_config/fields doc); LBDC + future
// tenants supply their own via site_config/fields. The page
// synthesizes Google + Apple Maps deep-links from `address` when
// mapsUrl/appleMapsUrl aren't set, so name + address is all we need
// here — same rendered result as LBDC's richer rows.

async function loadFields(tenantId: string): Promise<Field[]> {
  // SFBL_FIELDS is SFBL's OWN venue list, so it must never be served to
  // another tenant. COYBL has no site_config/fields doc, and every one of
  // these fallbacks was handing a COYBL coach 26 South Florida ballparks
  // as "every park and field the league plays at" - linked from COYBL's
  // own nav. Other tenants now fall back to empty and render a real
  // empty state instead.
  const fallback = defaultFieldsFor(tenantId);
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${tenantId}/site_config/fields`)
      .get();
    if (!snap.exists) return fallback;
    const data = snap.data() ?? {};
    // Either { data: [...] } shape (used by LBDC migration) or a
    // top-level array if a future writer sets the doc directly.
    const arr = Array.isArray(data.data)
      ? (data.data as Field[])
      : Array.isArray(data)
        ? (data as unknown as Field[])
        : null;
    if (!arr || arr.length === 0) return fallback;
    return arr;
  } catch {
    return fallback;
  }
}

export default async function FieldsPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const fields = await loadFields(tenantId);

  // Windmill gets its own town-grouped compact directory (union-find dedup,
  // home-plate count badges, search, town chips, ?f= deep-link) ported from its
  // static site. It renders its own full-width hero, so return before the
  // standard page header. Data carries extra { town, teams, variants } keys that
  // loadFields passes through untouched (other tenants' rows lack them).
  if (tenantId === "windmill") {
    // Team names on each field card link to their team page; pass a lightweight
    // id+name index (name field only) for the component to match against.
    const teamsSnap = await getAdminDb()
      .collection(`leagues/${tenantId}/teams`)
      .select("name")
      .get();
    const teamIndex = teamsSnap.docs.map((d) => ({
      id: d.id,
      name: String((d.data() as { name?: unknown }).name ?? d.id),
    }));
    return (
      <FieldsWindmill
        fields={fields as unknown as WindmillField[]}
        teamIndex={teamIndex}
      />
    );
  }

  const clubGrouped =
    fields.filter((f) => (f.location ?? "").trim()).length >= 20;

  return (
    <main className="container py-10">
      <header className="mb-6">
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          League
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
          Fields
        </h1>
        <p style={{ marginTop: 8, color: "var(--muted)", maxWidth: 680 }}>
          {fields.length > 0
            ? "Every diamond the league plays at on one interactive map. Search the list or tap a pin for one-tap driving directions."
            : "Field locations are posted here once the league adds them."}
        </p>
      </header>

      {/* LCYBL: the LMLL interactive map — every field pinned, plus a searchable
          list that flies the map to a field on tap. Falls back to the club-grouped
          directory (and the town-grouped card grid) for other tenants. */}
      {fields.length > 0 ? (
        tenantId === "lcybl" ? (
          <FieldsMap fields={fields} />
        ) : clubGrouped ? (
          <FieldsByClub fields={fields} />
        ) : (
          <FieldsDirectory fields={fields} />
        )
      ) : (
        <p style={{ color: "var(--muted)" }}>
          No fields have been added yet. Game locations are listed on the{" "}
          <Link href="/schedule" style={{ color: "var(--brand-primary)" }}>
            schedule
          </Link>
          .
        </p>
      )}
    </main>
  );
}
