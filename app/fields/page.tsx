// SFBL fields directory. Public list of every park/field used by the
// league with addresses + Google-Maps deep-links. Mirrors the
// content of sfbl.com/sfbl-fields/ but as a real, native page so it's
// indexed and bookmarkable on the new site.

import { headers } from "next/headers";

export const dynamic = "force-dynamic";

interface Field {
  name: string;
  address: string;
}

// Same list as sfbl.com/sfbl-fields/ as of 2026-05-08. If the league
// adds or drops a field, edit this array — no Firestore round-trip.
// (Fields are de-facto static for SFBL; making them admin-editable
// is a future task if/when the list churns.)
const FIELDS: Field[] = [
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
  { name: "Floyd Hull Stadium", address: "2800 SW 8th Ave, Fort Lauderdale FL 33315" },
  { name: "Little Fenway at Miller Park", address: "1905 SW 4th Ave, Delray Beach FL 33444" },
  { name: "Lynn University", address: "3601 North Military Trail, Boca Raton FL 33431" },
  { name: "Margate Sports Complex #3", address: "1695 Banks Rd, Margate FL 33063" },
  { name: "McArthur High School", address: "6501 Hollywood Blvd, Hollywood FL 33024" },
  { name: "Miami Christian School", address: "200 NW 109th Ave, Miami FL 33172" },
  { name: "Mullins Park", address: "10000 Ben Geiger Dr, Coral Springs FL 33065" },
  { name: "Northeast High School", address: "700 NE 56th Street, Oakland Park FL 33334" },
  { name: "Nova High School", address: "3600 College Ave, Fort Lauderdale FL 33314" },
  { name: "Pompey Park", address: "1101 NW 2nd St, Delray Beach FL 33444" },
  { name: "Sabal Pines Park", address: "5005 NW 39th Ave, Coconut Creek FL 33073" },
  { name: "South Broward High School", address: "1901 North Federal Highway, Hollywood FL 33020" },
  { name: "South Miami High School", address: "6856 SW 53 Street, Miami FL 33155" },
  { name: "Sugar Sand Park", address: "300 South Military Trail, Boca Raton FL 33486" },
  { name: "Sunset Park", address: "10600 Cleary Blvd, Plantation FL 33324" },
  { name: "West Perrine Park", address: "17121 SW 104th Ave, Miami FL 33157" },
  { name: "Weston Tequesta Park", address: "600 Indian Trace, Weston FL 33326" },
];

export default function FieldsPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

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
          Every park and field SFBL plays at. Tap any address to open
          directions in your phone&rsquo;s map app.
        </p>
      </header>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {FIELDS.map((f) => {
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.address)}`;
          return (
            <li
              key={f.name}
              style={{
                background: "white",
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 12,
                padding: "14px 16px",
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              <h3
                className="font-display"
                style={{
                  margin: 0,
                  fontSize: 17,
                  color: "var(--text-strong)",
                  letterSpacing: "-0.01em",
                }}
              >
                {f.name}
              </h3>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginTop: 6,
                  display: "block",
                  color: "var(--brand-primary)",
                  fontSize: 13,
                  textDecoration: "none",
                  lineHeight: 1.4,
                }}
              >
                {f.address}
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
