"use client";

// Captains Chat tab — thin wrapper around TeamChatTab passing
// `collection="captain_chat"` so it shares all the listener / render /
// composer / delete / reset logic.
//
// Difference from team chat (handled by TeamChatTab's `collection` prop):
//   - Listener uses `asc + limit(200)` instead of `where('team_id') +
//     limit(100)` — no team filter, league-wide thread. The asc + limit
//     trick avoids needing a `desc` Firestore index (DVSL profile.html:4920).
//   - Bubble sender label is `"<short> — <captain name>"` instead of
//     just the name.
//   - Push category is `captains_chat` (plural). Server filter requires
//     `is_captain_authed === true`; ignores team filter.
//
// Captains-only access is enforced server-side in /api/chat-message:
// callers must have `captain:<team_id>` or `admin` claim. The teamId
// prop is still passed because the captain's team metadata (color,
// short code) gets stamped on outgoing messages for bubble-rendering.

import { TeamChatTab } from "./TeamChatTab";

interface Props {
  leagueId: string;
  teamId: string;
}

export function CaptainsChatTab({ leagueId, teamId }: Props) {
  return (
    <TeamChatTab
      leagueId={leagueId}
      teamId={teamId}
      collection="captain_chat"
    />
  );
}
