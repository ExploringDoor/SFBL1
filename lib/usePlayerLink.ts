"use client";

// usePlayerLink — auto-link the signed-in user's auth_uid to their
// /players record on the active league via /api/player-link, and
// expose the resulting state.
//
// Used by both /profile#avail (PlayerAvailabilityPanel) and
// /profile#teamchat (PlayerTeamChatPanel). Each panel calls the
// endpoint independently — the result is fast (~1 small Firestore
// query) and the endpoint itself is idempotent, so duplicate calls
// just re-confirm the link. Could share state via React context if
// it ever became a perf concern, but two extra-small reads per page
// load is fine.
//
// State shape mirrors the panels' needs:
//   - loading             — initial state, until the endpoint responds
//   - no-match            — endpoint returned 0 matches (user has no
//                           player record on this league; fan / guest)
//   - ambiguous           — multiple player records match (sub board,
//                           old seasons, etc.) — UI tells user to ask
//                           the captain to clean up
//   - linked              — exactly one match, user is authed against
//                           a specific player_id + team_id

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";

export type PlayerLinkState =
  | { kind: "loading" }
  | { kind: "no-match" }
  | { kind: "ambiguous"; candidates: { id: string; team_id: string }[] }
  | { kind: "linked"; playerId: string; teamId: string };

export function usePlayerLink(
  leagueId: string | null,
  user: User | null | undefined,
): PlayerLinkState {
  const [state, setState] = useState<PlayerLinkState>({ kind: "loading" });

  useEffect(() => {
    if (!user || !leagueId) {
      setState({ kind: "loading" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/player-link", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ leagueId }),
        });
        if (cancelled) return;
        if (!res.ok) {
          // 401/403/etc → treat as no-match. Most common cause is a
          // user who doesn't have a player record on this league.
          // Don't error-spam them.
          setState({ kind: "no-match" });
          return;
        }
        const data = (await res.json()) as {
          matches?: number;
          linked?: string;
          alreadyLinked?: boolean;
          ambiguous?: boolean;
          player_id?: string;
          team_id?: string;
          candidates?: { id: string; team_id: string }[];
        };
        if (data.matches === 0) {
          setState({ kind: "no-match" });
        } else if (data.ambiguous) {
          setState({
            kind: "ambiguous",
            candidates: data.candidates ?? [],
          });
        } else {
          const playerId = data.linked ?? data.player_id;
          const teamId = data.team_id;
          if (!playerId || !teamId) {
            setState({ kind: "no-match" });
            return;
          }
          setState({ kind: "linked", playerId, teamId });
        }
      } catch {
        if (!cancelled) setState({ kind: "no-match" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, user]);

  return state;
}
