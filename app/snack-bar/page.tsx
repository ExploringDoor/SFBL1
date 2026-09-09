// Public snack-bar volunteer board.
//
// The original volunteer page. It shows snack-bar shifts only — a shift saved
// before jobs existed has no job and counts as one — so a league that never
// asked for game-crew sign-ups sees the board it always had. The all-jobs
// board lives at /volunteers. Both render VolunteerBoardPage.

import { VolunteerBoardPage } from "./VolunteerBoardPage";

export const dynamic = "force-dynamic";

export default function SnackBarPage() {
  return (
    <VolunteerBoardPage
      eyebrow="Volunteer"
      title="Snack Bar"
      intro="The snack bar runs on volunteers, and the money it takes goes straight back into the league. Pick a shift that suits you — you only need to leave a name and a way to reach you."
      onlyJob="Snack Bar"
    />
  );
}
