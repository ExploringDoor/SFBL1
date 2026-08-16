// Hide or show the Island team list.
//
//   ON=1 …  hide  (public sees a "list goes up with the schedule" notice)
//   (unset) show  (normal team listing and team pages)
//
//   SA_PATH=~/Desktop/island-fastpitch-site/firebase/island-service-account.json \
//     ON=1 npx tsx scripts/island-hide-teams.ts
//
// Only the flag. The nav link stays either way: nav.hide does not actually
// filter the rendered nav, and a link to an explanation beats a menu item
// that silently disappears. See components/ui/TeamsHiddenNotice.tsx.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { existsSync } from "node:fs";

const { SA_PATH } = process.env;
if (!SA_PATH || !existsSync(SA_PATH)) {
  console.error("SA_PATH required (island service account json)");
  process.exit(1);
}
const ON = process.env.ON === "1";

initializeApp({ credential: cert(SA_PATH) });

(async () => {
  const ref = getFirestore().doc("leagues/island");
  await ref.set({ flags: { hide_teams: ON } }, { merge: true });
  const after = (await ref.get()).data() ?? {};
  const flags = (after as { flags?: Record<string, unknown> }).flags ?? {};
  console.log(`hide_teams is now ${flags.hide_teams === true}`);
  console.log(
    flags.hide_teams === true
      ? "Public sees the notice. The office still sees everything in the admin."
      : "Team list is public again.",
  );
  process.exit(0);
})();
