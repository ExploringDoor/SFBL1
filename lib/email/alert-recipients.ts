// Shared loader for a league's opted-in alert email list.
//
// One source of truth: /leagues/{id}/form_submissions/alerts_signup/items,
// the public "Get Game Alerts" signup. Used by the rainout email fan-out
// and the weekly digest so both send to exactly the same audience.
// "text"-only subscribers are excluded (they asked not to get email).

export async function loadAlertEmails(
  db: FirebaseFirestore.Firestore,
  leagueId: string,
): Promise<string[]> {
  const snap = await db
    .collection(`leagues/${leagueId}/form_submissions/alerts_signup/items`)
    .get();
  const emails: string[] = [];
  for (const doc of snap.docs) {
    const x = doc.data() as { email?: unknown; notify_by?: unknown };
    const email = typeof x.email === "string" ? x.email.trim() : "";
    if (email && x.notify_by !== "text") emails.push(email.toLowerCase());
  }
  return [...new Set(emails)];
}
