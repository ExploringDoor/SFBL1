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

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldsDirectory, type Field } from "@/components/FieldsDirectory";

export const dynamic = "force-dynamic";


// SFBL field directory — authoritative list supplied by Adam
// (2026-05-18), alphabetical. SFBL serves from this hardcoded
// fallback (no /leagues/sfbl/site_config/fields doc); LBDC + future
// tenants supply their own via site_config/fields. The page
// synthesizes Google + Apple Maps deep-links from `address` when
// mapsUrl/appleMapsUrl aren't set, so name + address is all we need
// here — same rendered result as LBDC's richer rows.
const SFBL_FIELDS: Field[] = [
  { name: "American High School", address: "18350 NW 67th Avenue, Miami Lakes FL 33015" },
  { name: "Barbara Goleman High School", address: "14100 NW 89th Avenue, Miami Lakes FL 33018" },
  { name: "Braddock High School", address: "3601 SW 147 Avenue, Miami FL 33185" },
  { name: "Coral Gables High School", address: "450 Bird Road, Coral Gables FL 33146" },
  { name: "Coral Glades Sportsplex", address: "2700 Sportsplex Drive, Coral Springs FL 33065" },
  { name: "Coral Springs High School", address: "7201 West Sample Road, Coral Springs FL 33065" },
  { name: "Cypress Bay High School", address: "18600 Vista Park Blvd, Weston FL 33332" },
  { name: "Cypress Park", address: "1301 Coral Springs Dr, Coral Springs FL 33071" },
  { name: "Flamingo Park", address: "1435 Michigan Ave, Miami Beach FL 33139" },
  { name: "Florida Memorial University", address: "15800 NW 42nd Ave, Miami FL 33054" },
  { name: "Floyd Hull Stadium", address: "2800 SW 8th Ave, Fort Lauderdale, FL 33315" },
  { name: "Little Fenway at Miller Park", address: "1905 SW 4th Ave, Delray Beach FL 33444" },
  { name: "Lynn University", address: "3601 North Military Trail, Boca Raton FL 33431" },
  { name: "Margate Sports Complex #3", address: "1695 Banks Rd, Margate, FL 33063" },
  { name: "McArthur High School", address: "6501 Hollywood Blvd, Hollywood FL 33024" },
  { name: "Miami Christian School", address: "200 NW 109th Ave, Miami FL 33172" },
  { name: "Mullins Park", address: "10000 Ben Geiger Dr, Coral Springs FL 33065" },
  { name: "Northeast High School", address: "700 NE 56th Street, Oakland Park FL 33334" },
  { name: "Nova High School", address: "3600 College Ave, Fort Lauderdale FL 33314" },
  { name: "Pompey Park", address: "1101 NW 2nd St, Delray Beach, FL 33444" },
  { name: "Sabal Pines Park", address: "5005 NW 39th Ave, Coconut Creek FL 33073" },
  { name: "South Broward High School", address: "1901 North Federal Highway, Hollywood FL 33020" },
  { name: "South Miami High School", address: "6856 SW 53 Street, Miami FL 33155" },
  { name: "Sugar Sand Park", address: "300 South Military Trail, Boca Raton FL 33486" },
  { name: "Sunset Park", address: "10600 Cleary Blvd, Plantation FL 33324" },
  { name: "West Perrine Park", address: "17121 SW 104th Ave, Miami FL 33157" },
];

async function loadFields(tenantId: string): Promise<Field[]> {
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${tenantId}/site_config/fields`)
      .get();
    if (!snap.exists) return SFBL_FIELDS;
    const data = snap.data() ?? {};
    // Either { data: [...] } shape (used by LBDC migration) or a
    // top-level array if a future writer sets the doc directly.
    const arr = Array.isArray(data.data)
      ? (data.data as Field[])
      : Array.isArray(data)
        ? (data as unknown as Field[])
        : null;
    if (!arr || arr.length === 0) return SFBL_FIELDS;
    return arr;
  } catch {
    return SFBL_FIELDS;
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
          Every park and field the league plays at. Tap a button to
          open directions in Google Maps or Apple Maps.
        </p>
      </header>

      <FieldsDirectory fields={fields} />

    </main>
  );
}
