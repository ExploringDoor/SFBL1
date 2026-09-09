// Public game-day volunteer board — every job.
//
// A youth basketball game needs someone on the clock, someone keeping the
// scorebook and a couple of people in the snack bar. This is the board a
// league links from its nav when parents crew the games; /snack-bar remains
// the snack-bar-only view. Same component, no login, same PII boundary.

import { VolunteerBoardPage } from "../snack-bar/VolunteerBoardPage";

export const dynamic = "force-dynamic";

// Per-page title -> "Volunteers · <abbrev>" via the layout template.
export const metadata = { title: "Volunteers" };

export default function VolunteersPage() {
  return (
    <VolunteerBoardPage
      eyebrow="Volunteer"
      title="Game-Day Jobs"
      intro="Every game needs someone on the clock, someone keeping the scorebook and a couple of people in the snack bar. Pick a game and a job — you only need to leave a name and a way to reach you."
    />
  );
}
