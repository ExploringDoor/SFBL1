// A tenant's venue list as it was BEFORE anyone edited it in the admin.
//
// SFBL's twenty six ballparks were hard coded in app/fields/page.tsx and used
// only while /leagues/sfbl/site_config/fields did not exist. That made adding a
// venue destructive in a way nobody could have predicted: Adam added Oriole
// Park through the Fields tab on 2026-09-07, which CREATED that document with
// one entry, which switched the fallback off, and twenty six ballparks and
// their maps came off sfbl.com. One addition, twenty six deletions, no warning.
//
// So the list lives here instead, where the admin can read it too. The Fields
// tab loads it when the document is empty, so the editor opens on the real
// list and adding a venue appends to it rather than replacing it.
//
// This is a STARTING POINT, not a source of truth. Once a league has saved its
// fields, the saved list is the only one that counts.

export interface DefaultField {
  name: string;
  address: string;
}

const SFBL: DefaultField[] = [
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
]

/** Venues a league starts with, before it has saved any of its own. */
export const DEFAULT_FIELDS: Record<string, DefaultField[]> = {
  sfbl: SFBL,
};

/** The starting list for a tenant, or an empty list for one with none. */
export function defaultFieldsFor(tenantId: string | null | undefined): DefaultField[] {
  return (tenantId && DEFAULT_FIELDS[tenantId]) || [];
}
