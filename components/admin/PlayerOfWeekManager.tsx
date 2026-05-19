"use client";

// Admin tab for Player of the Week. Manually curated by the
// commissioner (no auto-from-stats path — Adam, 2026-05-18). Full
// CRUD over /leagues/{id}/player_of_week. Pattern mirrors
// NewsManager: client-side Firestore read, mutate via
// /api/admin-player-of-week (idToken-auth'd). Blurb is HTML
// (sanitized server-side).
//
// The most recent entry (by award_date, then created_at) is the
// current spotlight on the public /player-of-the-week page; the
// rest are the dated archive.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { RichEditor } from "./RichEditor";

interface PotwEntry {
  id: string;
  player_name: string;
  team_name: string;
  week_label: string;
  award_date: string | null;
  stat_line: string;
  blurb: string;
  photo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Props {
  leagueId: string;
  user: User;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: PotwEntry = {
  id: "",
  player_name: "",
  team_name: "",
  week_label: "",
  award_date: null,
  stat_line: "",
  blurb: "",
  photo_url: null,
  created_at: null,
  updated_at: null,
};

// Sort key: award_date desc, then created_at desc. Mirrors the
// public page so the admin list order matches what subscribers see.
function sortKey(e: PotwEntry): string {
  return `${e.award_date ?? "0000-00-00"}T${e.created_at ?? ""}`;
}

export function PlayerOfWeekManager({ leagueId, user }: Props) {
  const [entries, setEntries] = useState<PotwEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PotwEntry | null>(null);
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    const db = getDb();
    const snap = await getDocs(
      query(
        collection(db, `leagues/${leagueId}/player_of_week`),
        orderBy("created_at", "desc"),
      ),
    );
    const list: PotwEntry[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: String(data.id ?? d.id),
        player_name: String(data.player_name ?? ""),
        team_name: String(data.team_name ?? ""),
        week_label: String(data.week_label ?? ""),
        award_date: data.award_date ? String(data.award_date) : null,
        stat_line: String(data.stat_line ?? ""),
        blurb: String(data.blurb ?? ""),
        photo_url: data.photo_url ? String(data.photo_url) : null,
        created_at: data.created_at ? String(data.created_at) : null,
        updated_at: data.updated_at ? String(data.updated_at) : null,
      };
    });
    list.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    setEntries(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [leagueId]);

  async function save(entry: PotwEntry) {
    setBusy("save");
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-player-of-week", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          action: "save",
          id: entry.id || undefined,
          player_name: entry.player_name,
          team_name: entry.team_name,
          week_label: entry.week_label,
          award_date: entry.award_date,
          stat_line: entry.stat_line,
          blurb: entry.blurb,
          photo_url: entry.photo_url,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: "Saved." });
        setEditing(null);
        await refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this Player of the Week entry? This cannot be undone."))
      return;
    setBusy("delete");
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-player-of-week", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, action: "delete", id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: "Deleted." });
        await refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          The most recent entry shows as the big spotlight on{" "}
          <code className="rounded bg-slate-100 px-1">
            /player-of-the-week
          </code>
          ; older ones become the dated archive below it.
        </p>
        <button
          type="button"
          onClick={() =>
            setEditing({ ...EMPTY, award_date: todayIso() })
          }
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          + New honoree
        </button>
      </div>

      {msg && (
        <div
          className={
            "rounded-md p-3 text-sm " +
            (msg.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700")
          }
        >
          {msg.text}
        </div>
      )}

      {editing && (
        <Editor
          entry={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onChange={setEditing}
          onSave={() => save(editing)}
        />
      )}

      <ul className="space-y-3">
        {entries.length === 0 && (
          <li className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
            No Player of the Week entries yet. Click "+ New honoree" to
            add the first one.
          </li>
        )}
        {entries.map((e, i) => (
          <li
            key={e.id}
            className="rounded-md border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {e.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={e.photo_url}
                    alt={e.player_name}
                    className="h-16 w-16 flex-shrink-0 rounded-md object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    {i === 0 && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                        ★ Current
                      </span>
                    )}
                    {e.week_label && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                        {e.week_label}
                      </span>
                    )}
                    {e.award_date && (
                      <span className="text-slate-400">
                        {new Date(
                          e.award_date + "T12:00:00",
                        ).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-slate-900">
                    {e.player_name}
                    {e.team_name && (
                      <span className="ml-2 text-sm font-medium text-slate-500">
                        · {e.team_name}
                      </span>
                    )}
                  </h3>
                  {e.stat_line && (
                    <p className="mt-0.5 text-sm font-semibold text-slate-600">
                      {e.stat_line}
                    </p>
                  )}
                  {e.blurb && (
                    <div
                      className="prose prose-sm mt-1 max-w-none text-slate-700"
                      dangerouslySetInnerHTML={{ __html: e.blurb }}
                    />
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setEditing({ ...e })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => del(e.id)}
                  disabled={busy !== null}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Editor({
  entry,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  entry: PotwEntry;
  busy: null | "save" | "delete";
  onChange: (e: PotwEntry) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">
        {entry.id ? "Edit honoree" : "New honoree"}
      </h3>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Player name *
            </label>
            <input
              type="text"
              value={entry.player_name}
              onChange={(e) =>
                onChange({ ...entry, player_name: e.target.value })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g. Carlos Mendez"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Team (optional)
            </label>
            <input
              type="text"
              value={entry.team_name}
              onChange={(e) =>
                onChange({ ...entry, team_name: e.target.value })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g. Miami Yankees"
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Week label (optional)
            </label>
            <input
              type="text"
              value={entry.week_label}
              onChange={(e) =>
                onChange({ ...entry, week_label: e.target.value })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="e.g. Week 6 · May 12–18"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Award date (orders current vs archive)
            </label>
            <input
              type="date"
              value={entry.award_date ?? ""}
              onChange={(e) =>
                onChange({
                  ...entry,
                  award_date: e.target.value || null,
                })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Stat line (optional)
          </label>
          <input
            type="text"
            value={entry.stat_line}
            onChange={(e) =>
              onChange({ ...entry, stat_line: e.target.value })
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="e.g. 6-for-9, 2 HR, 7 RBI, 4 R"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Photo URL (optional)
          </label>
          <input
            type="url"
            value={entry.photo_url ?? ""}
            onChange={(e) =>
              onChange({ ...entry, photo_url: e.target.value || null })
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="https://… (paste a hosted image URL)"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Write-up (optional)
          </label>
          <RichEditor
            initialHtml={entry.blurb}
            onChange={(html) => onChange({ ...entry, blurb: html })}
            placeholder="Why did they earn it? Game highlights, the moment…"
          />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy === "save" || !entry.player_name.trim()}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "save"
            ? "Saving…"
            : entry.id
              ? "Save changes"
              : "Publish"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
