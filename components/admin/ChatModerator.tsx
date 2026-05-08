"use client";

// Admin "Chat moderation" panel.
//
// Lets the commissioner view recent messages in any chat (team or
// league-wide captains chat), delete individual messages, or clear
// the chat entirely. Mirrors DVSL's admin "Captain Chat" pane
// (admin.html ~6760–6850) — refresh + clear-all + per-row delete.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface ChatMsg {
  id: string;
  body: string;
  author_uid: string;
  author_email: string;
  author_name: string;
  team_id: string;
  created_at: string;
}

interface TeamOpt {
  id: string;
  name: string;
}

type ChatKind = "captain_chat" | "team_messages";

interface Props {
  leagueId: string;
  user: User;
}

export function ChatModerator({ leagueId, user }: Props) {
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [kind, setKind] = useState<ChatKind>("captain_chat");
  const [teamId, setTeamId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load teams once for the team-chat picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const snap = await getDocs(
        collection(db, `leagues/${leagueId}/teams`),
      );
      if (cancelled) return;
      setTeams(
        snap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const fetchTarget = useMemo(
    () => ({
      kind,
      teamId: kind === "team_messages" ? teamId : "",
    }),
    [kind, teamId],
  );

  async function fetchMessages() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const db = getDb();
      let q;
      if (kind === "captain_chat") {
        q = query(
          collection(db, `leagues/${leagueId}/captain_chat`),
          orderBy("created_at", "desc"),
          limit(100),
        );
      } else {
        if (!teamId) {
          setMessages([]);
          setLoading(false);
          return;
        }
        q = query(
          collection(db, `leagues/${leagueId}/team_messages`),
          where("team_id", "==", teamId),
          orderBy("created_at", "desc"),
          limit(100),
        );
      }
      const snap = await getDocs(q);
      setMessages(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            body: String(data.body ?? data.text ?? ""),
            author_uid: String(data.author_uid ?? ""),
            author_email: String(data.author_email ?? ""),
            author_name: String(data.author_name ?? data.author ?? ""),
            team_id: String(data.team_id ?? ""),
            created_at: String(data.created_at ?? ""),
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch whenever the target changes.
  useEffect(() => {
    if (kind === "team_messages" && !teamId) {
      setMessages(null);
      return;
    }
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTarget.kind, fetchTarget.teamId]);

  async function deleteOne(msg: ChatMsg) {
    if (
      !window.confirm(
        `Delete this message from ${msg.author_name || msg.author_email || "user"}?`,
      )
    )
      return;
    setBusy(msg.id);
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
          collection: kind,
          msgId: msg.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess("Deleted");
      await fetchMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    const target =
      kind === "captain_chat"
        ? "EVERY captains-chat message"
        : `every message in ${teams.find((t) => t.id === teamId)?.name ?? teamId}'s team chat`;
    if (
      !window.confirm(
        `Permanently delete ${target}? This is a moderation hammer — use it sparingly.`,
      )
    )
      return;
    setBusy("clear-all");
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ leagueId, collection: kind });
      if (kind === "team_messages") params.set("teamId", teamId);
      const res = await fetch(
        `/api/chat-message-delete?${params.toString()}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${idToken}` },
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        deleted?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Cleared ${data.deleted ?? 0} messages.`);
      await fetchMessages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <p className="font-semibold text-slate-900">Chat moderation</p>
        <p className="text-xs text-slate-600 mt-1">
          Browse and delete messages in the captains chat (league-wide,
          captains only) or any team's chat. Deletions are audited.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ChatKind);
            setMessages(null);
          }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="captain_chat">Captains chat (league-wide)</option>
          <option value="team_messages">A team's chat</option>
        </select>
        {kind === "team_messages" && (
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          >
            <option value="">— pick a team —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={fetchMessages}
          disabled={
            loading || (kind === "team_messages" && !teamId)
          }
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
        {messages && messages.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            disabled={busy != null}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 ml-auto"
          >
            {busy === "clear-all" ? "Clearing…" : "Clear all"}
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 rounded bg-emerald-50 px-2 py-1 border border-emerald-200">
          {success}
        </p>
      )}

      {messages == null ? (
        kind === "team_messages" && !teamId ? (
          <p className="text-sm text-slate-500 italic">
            Pick a team to view its chat.
          </p>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )
      ) : messages.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No messages in this chat.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden max-h-[600px] overflow-y-auto">
          {messages.map((m) => (
            <li
              key={m.id}
              className="px-3 py-2 flex items-start gap-3 hover:bg-slate-50"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">
                    {m.author_name || m.author_email || "Unknown"}
                  </span>
                  {m.team_id && kind === "team_messages" && (
                    <span className="ml-2">
                      ({teams.find((t) => t.id === m.team_id)?.name ??
                        m.team_id})
                    </span>
                  )}
                  <span className="ml-2 font-mono">
                    {fmtAgo(m.created_at)}
                  </span>
                </div>
                <div className="text-sm text-slate-900 whitespace-pre-wrap break-words">
                  {m.body || (
                    <span className="italic text-slate-400">(empty)</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteOne(m)}
                disabled={busy != null}
                className="rounded-md border border-red-300 bg-white px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
              >
                {busy === m.id ? "…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmtAgo(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}
