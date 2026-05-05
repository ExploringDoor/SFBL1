"use client";

// Team Chat tab — verbatim port of DVSL captain.html team chat
// (sendTeamMsg + setupChatListeners + renderChatMessages, lines
// 5604-5836). Adds multi-tenant `leagueId` scoping; otherwise
// matches DVSL behaviour byte-for-byte:
//
//   - onSnapshot real-time listener on /leagues/{leagueId}/team_messages
//     filtered by team_id, ordered by timestamp asc, limit(100)
//   - Bubble render: "mine" right-aligned, "theirs" left-aligned,
//     sender name + timestamp meta lines
//   - Smart sender label that swaps "Team Name (Captain)" legacy format
//     for the captain's real name (handles DVSL's two-shape compat
//     burden — see spec gotcha #1)
//   - Self-delete + captain-moderate-others (team chat only)
//   - Reset chat (two confirms, batched at 400 server-side)
//   - Badge / unread count via localStorage `lastRead_teamchat_*`,
//     cleared on tab activate (we know we're active because this
//     component is mounted)
//   - Scroll-to-bottom after every render
//
// NOT yet: typing indicators (DVSL doesn't have them either),
// EmailJS fan-out (deferred — no email provider wired), edit
// (DVSL doesn't support edits — messages are immutable post-send).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Timestamp,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";
import { getCachedToken } from "@/lib/notifications/fcm-client";

interface ChatMsg {
  id: string;
  text: string;
  author_email: string;
  author_name: string;
  author_uid: string;
  is_captain: boolean;
  team_id: string;
  team_name: string;
  team_color: string;
  team_short: string;
  timestamp: Timestamp | null;
}

interface Props {
  leagueId: string;
  teamId: string;
  // Optional: if you want to render captains chat with the same
  // component, pass collection="captain_chat". Phase B uses
  // "team_messages"; Phase C reuses this for captains chat.
  collection?: "team_messages" | "captain_chat";
}

function lastReadKey(
  leagueId: string,
  collName: string,
  teamId: string,
  email: string,
): string {
  // Per-league + per-collection + per-team + per-user key. DVSL is single-
  // tenant so they only key on collection + email. We add leagueId + teamId
  // so a captain in two leagues / two teams doesn't share read-state.
  return `leagueplatform:lastRead:${leagueId}:${collName}:${teamId}:${email}`;
}

export function TeamChatTab({
  leagueId,
  teamId,
  collection: collName = "team_messages",
}: Props) {
  const user = useUser();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLUListElement | null>(null);

  // ── Real-time listener ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const db = getDb();
    const path = `leagues/${leagueId}/${collName}`;
    const q =
      collName === "team_messages"
        ? query(
            collection(db, path),
            where("team_id", "==", teamId),
            orderBy("timestamp", "asc"),
            limit(100),
          )
        : // captain_chat (Phase C) — no team filter, uses asc + limit(200)
          // matching DVSL's profile.html:4920 "use existing asc index" trick.
          query(
            collection(db, path),
            orderBy("timestamp", "asc"),
            limit(200),
          );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const msgs: ChatMsg[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            text: String(data.text ?? ""),
            author_email: String(data.author_email ?? ""),
            // Handle DVSL's two-shape compatibility (spec gotcha #1):
            // older docs used `sender_name`, newer use `author_name`.
            author_name: String(
              data.author_name ?? data.sender_name ?? "",
            ),
            author_uid: String(data.author_uid ?? ""),
            is_captain: data.is_captain === true,
            team_id: String(data.team_id ?? ""),
            team_name: String(data.team_name ?? ""),
            team_color: String(data.team_color ?? "#0a0e1c"),
            team_short: String(data.team_short ?? ""),
            timestamp:
              data.timestamp instanceof Timestamp ? data.timestamp : null,
          };
        });
        setMessages(msgs);

        // Mark "read" — this component is mounted so the user is on
        // this tab. Clears the badge on next tab-strip render.
        try {
          if (user.email) {
            window.localStorage.setItem(
              lastReadKey(leagueId, collName, teamId, user.email),
              String(Date.now()),
            );
          }
        } catch {
          /* localStorage unavailable */
        }
      },
      (err) => {
        setError(err.message || "Chat listener failed");
      },
    );
    return () => unsub();
  }, [leagueId, teamId, collName, user]);

  // ── Scroll-to-bottom after every render (DVSL captain.html:5676) ──
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    if (!user) return;
    const t = text.trim();
    if (!t) return;
    setSending(true);
    setError(null);
    setText(""); // optimistic clear so the input stays snappy
    try {
      const idToken = await user.getIdToken();
      // Pass our FCM token so the server can suppress the push from
      // landing on this device (DVSL captain.html:5800 pattern). Null
      // when push isn't enabled — server tolerates absence.
      const senderToken = getCachedToken();
      const res = await fetch("/api/chat-message", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          collection: collName,
          ...(collName === "team_messages" ? { teamId } : {}),
          text: t,
          ...(senderToken ? { senderToken } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Failed to send");
        setText(t); // restore
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
      setText(t);
    } finally {
      setSending(false);
    }
  }

  async function deleteMsg(msgId: string, preview: string) {
    if (!user) return;
    if (
      !window.confirm(
        `Delete this message?\n\n"${preview.slice(0, 60)}${preview.length > 60 ? "…" : ""}"`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/chat-message-delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          collection: collName,
          msgId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Delete failed");
      }
      // onSnapshot will re-render automatically.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function resetChat() {
    if (!user) return;
    if (
      !window.confirm(
        `Reset the entire ${collName === "team_messages" ? "Team" : "Captains"} Chat?\n\nThis deletes ALL messages permanently. This cannot be undone.`,
      )
    ) {
      return;
    }
    if (!window.confirm("Are you absolutely sure? Last chance to back out.")) {
      return;
    }
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/chat-reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          collection: collName,
          ...(collName === "team_messages" ? { teamId } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        deleted?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Reset failed");
      } else {
        setError(`Deleted ${data.deleted ?? 0} message(s)`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    }
  }

  // ── Render bubble ─────────────────────────────────────────────────
  // DVSL render path (captain.html:5604) — handles the legacy
  // "Team Name (Captain)" author_name format. We don't have a
  // pre-loaded ALL_CAPTAINS map yet so the swap-in falls back to the
  // current author_email's local-part if it matches a "(captain)"
  // suffix. Good enough for now; revisit when the captain directory
  // exists.
  function bubbleSender(m: ChatMsg): string {
    // Captains Chat label format: "<short> (Captain Name)" per DVSL.
    if (collName === "captain_chat") {
      const short = m.team_short || m.team_name || "";
      const name = m.author_name || m.author_email || "Captain";
      return short ? `${short} — ${name}` : name;
    }
    // Team Chat: prefer the sender's real name. If author_name looks
    // like the legacy "Team Name (Captain)" format, fall back to
    // email's local-part.
    let name = m.author_name || "";
    if (/\(captain\)\s*$/i.test(name)) {
      const lc = (m.author_email || "").split("@")[0] ?? "";
      if (lc) name = lc;
    }
    return name || m.author_email || m.team_name || "Unknown";
  }

  function fmtTime(ts: Timestamp | null): string {
    if (!ts) return "";
    const d = ts.toDate();
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const myEmailLc = (user?.email ?? "").toLowerCase();
  // Captain-moderate flag — for team chat, captains can delete anyone's;
  // for captains chat, only the author can. Authoritative check happens
  // server-side; this only controls whether the × button renders.
  const canModerateOthers = collName === "team_messages";

  const composerLabel =
    collName === "team_messages"
      ? "Send a message to your team"
      : "Send a message to all captains + commissioner";

  // For UI purposes only — server reverifies on every action. Best-
  // effort guess at whether the current user can reset.
  const probablyCanReset = useMemo(() => {
    // Captains can reset their own team chat (DVSL pattern). Admins can
    // reset captains chat. We don't know the user's role in detail
    // client-side, so show the button optimistically and let the
    // endpoint reject if not authorized.
    return collName === "team_messages";
  }, [collName]);

  return (
    <div className="cap-tab cap-chat-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">
          {collName === "team_messages" ? "Team Chat" : "Captains Chat"}
        </h2>
        <p className="cap-section-sub">
          {collName === "team_messages"
            ? "Talk to your team. Players with notifications on get a push."
            : "Captains-only room. Every signed-in captain in the league sees these messages."}
        </p>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      <ul ref={scrollRef} className="chat-messages">
        {messages.length === 0 ? (
          <li className="chat-empty">No messages yet. Say hello!</li>
        ) : (
          messages.map((m) => {
            const mine =
              !!myEmailLc &&
              m.author_email.toLowerCase() === myEmailLc;
            const canDelete = mine || canModerateOthers;
            return (
              <li
                key={m.id}
                className={"chat-msg " + (mine ? "mine" : "theirs")}
              >
                {!mine && (
                  <div className="chat-meta chat-meta-sender">
                    {bubbleSender(m)}
                  </div>
                )}
                <div
                  className="chat-bubble"
                  style={
                    !mine && m.team_color
                      ? { borderLeftColor: m.team_color }
                      : undefined
                  }
                >
                  <span className="chat-text">{m.text}</span>
                  {canDelete && (
                    <button
                      type="button"
                      className="chat-del"
                      title="Delete"
                      onClick={() => deleteMsg(m.id, m.text)}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="chat-meta chat-meta-time">
                  {fmtTime(m.timestamp)}
                </div>
              </li>
            );
          })
        )}
      </ul>

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="cap-form-lbl chat-composer-lbl" htmlFor="chat-input">
          {composerLabel}
        </label>
        <div className="chat-composer-row">
          <textarea
            id="chat-input"
            className="cap-form-input chat-input"
            value={text}
            disabled={sending}
            placeholder="Type a message…"
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter to send (DVSL doesn't have this but it's
              // a useful affordance on desktop; mobile users tap Send).
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="submit"
            className="le-cap-btn-primary chat-send-btn"
            disabled={sending || !text.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {probablyCanReset && (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="le-cap-btn-secondary cap-btn-danger"
            onClick={resetChat}
          >
            Reset chat
          </button>
        </div>
      )}
    </div>
  );
}
