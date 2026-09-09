// A field's street address, by name.
//
// Island keeps the venue name on the game and the address on
// site_config/fields, so a game page can say WHERE a field is only by joining
// the two. Jim asked for it on 2026-09-09: an umpire opening their assignment
// wants to tap the field and get directions, not read a name they may not
// know.
//
// Returns "" when there is no fields document or no matching address, and the
// caller then renders the field as plain text.

import { getAdminDb } from "@/lib/firebase-admin";

export async function fieldAddressFor(
  tenantId: string,
  fieldName: string | null | undefined,
): Promise<string> {
  const want = String(fieldName ?? "").trim().toLowerCase();
  if (!want) return "";
  try {
    const d = (
      await getAdminDb().doc(`leagues/${tenantId}/site_config/fields`).get()
    ).data() as { data?: unknown } | undefined;
    const arr = Array.isArray(d?.data) ? (d!.data as Record<string, unknown>[]) : [];
    for (const f of arr) {
      if (String(f?.name ?? "").trim().toLowerCase() === want) {
        return String(f?.address ?? "").trim();
      }
    }
  } catch {
    /* no fields doc: the page shows the field as plain text */
  }
  return "";
}
