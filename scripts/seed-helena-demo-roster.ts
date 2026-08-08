// Loads a SAMPLE roster onto one Helena team so the minors feature can be
// demonstrated before the league hands over real rosters.
//
// EVERY NAME IN HERE IS INVENTED. LeagueLineup keeps HSA's real rosters behind
// its own login, and we deliberately did not scrape them — see the note at the
// top of scripts/scrape-helena.ts. These are obviously-fake placeholder names
// so nobody can mistake them for real people, and each one is tagged
// `demo_sample: true` on its player doc so they can be found and deleted in one
// query the moment real rosters arrive:
//
//   leagues/helena/players where demo_sample == true
//
// Run:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 \
//     npx tsx scripts/seed-helena-demo-roster.ts
//
//   --purge   remove every demo_sample player instead of adding

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LEAGUE = "helena";
const TEAM = "mothlod"; // Motherlode — the team used in the walkthrough

// The DOBs are chosen to hit every branch of the policy (15 by Dec 31 to play,
// consent under 18) so the report has something in each section.
const ROSTER: Array<{
  name: string;
  jersey: number;
  pos: string;
  dob?: string;
  consent?: boolean;
}> = [
  { name: "Sample Adult One", jersey: 3, pos: "P", dob: "1988-04-11" },
  { name: "Sample Adult Two", jersey: 7, pos: "C", dob: "1995-09-02" },
  { name: "Sample Adult Three", jersey: 11, pos: "1B", dob: "1979-01-23" },
  { name: "Sample Adult Four", jersey: 14, pos: "SS", dob: "2001-06-30" },
  // Turns 18 exactly on the cutoff — the boundary case that proves the math.
  { name: "Sample Boundary Eighteen", jersey: 18, pos: "OF", dob: "2008-12-31" },
  // A minor with the consent form already collected.
  { name: "Sample Minor Consented", jersey: 21, pos: "2B", dob: "2009-05-20", consent: true },
  // A minor with NO consent form — the row Justine needs to act on.
  { name: "Sample Minor No Consent", jersey: 24, pos: "OF", dob: "2010-08-14" },
  // Below the league minimum of 15 — should never have been rostered.
  { name: "Sample Under Minimum", jersey: 27, pos: "OF", dob: "2012-03-05" },
  // No DOB at all — the day-one majority case.
  { name: "Sample No Birthdate", jersey: 33, pos: "3B" },
  { name: "Sample No Birthdate Two", jersey: 41, pos: "OF" },
];

function db() {
  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT || "demo-provision"
    : process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("no project id resolved");
  if (useEmulator) {
    initializeApp({ projectId });
    console.log(`[demo-roster] emulator ${process.env.FIRESTORE_EMULATOR_HOST}`);
  } else {
    const key = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    if (!key || !email) throw new Error("missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
    initializeApp({ credential: cert({ projectId, clientEmail: email, privateKey: key }) });
    console.log(`[demo-roster] LIVE project ${projectId}`);
  }
  return getFirestore();
}

async function main() {
  const store = db();
  const purge = process.argv.includes("--purge");

  if (purge) {
    const snap = await store
      .collection(`leagues/${LEAGUE}/players`)
      .where("demo_sample", "==", true)
      .get();
    for (const d of snap.docs) {
      await store.doc(`${d.ref.path}/_private/contact`).delete().catch(() => {});
      await d.ref.delete();
    }
    console.log(`[demo-roster] purged ${snap.size} sample players`);
    return;
  }

  for (const p of ROSTER) {
    const id = `demo-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    await store.doc(`leagues/${LEAGUE}/players/${id}`).set(
      {
        name: p.name,
        team_id: TEAM,
        jersey: p.jersey,
        position: p.pos,
        active: true,
        status: "active",
        // The marker that makes these one query away from deletion.
        demo_sample: true,
        updated_at: new Date().toISOString(),
      },
      { merge: true },
    );
    // DOB and consent are PII → the admin/self-gated _private subdoc only.
    if (p.dob || p.consent) {
      await store.doc(`leagues/${LEAGUE}/players/${id}/_private/contact`).set(
        {
          ...(p.dob ? { dob: p.dob } : {}),
          ...(p.consent
            ? {
                consent_on_file: true,
                consent_recorded_at: "2026-04-14T18:30:00.000Z",
                consent_recorded_by_uid: "seed-script",
              }
            : {}),
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
    }
  }
  console.log(`[demo-roster] seeded ${ROSTER.length} SAMPLE players onto ${TEAM}`);
  console.log(`[demo-roster] remove them any time: --purge`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
