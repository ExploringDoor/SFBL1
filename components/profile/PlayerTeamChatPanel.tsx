"use client";

// Player-side team chat panel for /profile#teamchat. Wraps the
// captain's TeamChatTab — same listener, same render path, same
// composer — but auto-detects the player's teamId via /api/player-link
// instead of taking it as a prop.
//
// Why we need a separate route from /captain#teamchat:
//   - Captains land on /captain#teamchat (their dashboard)
//   - Players don't have access to /captain at all
//   - team_chat push URL is set to /profile#teamchat so anyone who
//     taps the push lands somewhere they can actually reach
//     (server-side auth check in /api/chat-message gates writes;
//     either captain-of-team or player-on-team can post)

import { useUser } from "@/lib/auth-client";
import { usePlayerLink } from "@/lib/usePlayerLink";
import { TeamChatTab } from "@/components/captain/TeamChatTab";

interface Props {
  leagueId: string;
}

export function PlayerTeamChatPanel({ leagueId }: Props) {
  const user = useUser();
  const linkState = usePlayerLink(leagueId, user);

  if (linkState.kind === "loading") {
    return (
      <div className="cap-tab">
        <div className="cap-section-head">
          <h2 className="cap-section-title">Team Chat</h2>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      </div>
    );
  }

  if (linkState.kind === "no-match") {
    return (
      <div className="cap-tab">
        <div className="cap-section-head">
          <h2 className="cap-section-title">Team Chat</h2>
        </div>
        <div className="cap-pending-card">
          <div className="cap-pending-row">
            <div>
              <strong>You're not on a roster yet</strong>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  margin: "6px 0 0",
                  lineHeight: 1.55,
                }}
              >
                Team chat is for rostered players. Ask your captain to
                add you to the roster (using the email{" "}
                <strong>{user?.email}</strong>), then sign in again.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (linkState.kind === "ambiguous") {
    return (
      <div className="cap-tab">
        <div className="cap-section-head">
          <h2 className="cap-section-title">Team Chat</h2>
        </div>
        <div className="cap-pending-card">
          <div className="cap-pending-row">
            <div>
              <strong>Multiple roster matches for your email</strong>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  margin: "6px 0 0",
                  lineHeight: 1.55,
                }}
              >
                Looks like you're rostered on more than one team. Ask
                your captain or commissioner to clean up the duplicate
                records, then refresh.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Linked — render the same TeamChatTab the captain uses, with the
  // auto-detected teamId.
  return (
    <TeamChatTab leagueId={leagueId} teamId={linkState.teamId} />
  );
}
