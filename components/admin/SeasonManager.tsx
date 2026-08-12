"use client";

// Season manager — the commissioner's control panel for seasons.
//   • Switch the ACTIVE season (what the public sees by default) — toggle
//     back and forth freely.
//   • Reveal / hide a season from the public season switcher (build a
//     future season privately, publish it when ready).
//   • Add a new season.
//
// Games are filed under a season in the Schedule editor (each game has a
// Season picker). This panel governs which season is live + visible.

import { useEffect, useState } from "react";
import { getDoc, doc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";

interface SeasonRow {
  id: string;
  label: string;
  published?: boolean;
}

export function SeasonManager({ leagueId }: { leagueId: string }) {
  const user = useUser();
  const [current, setCurrent] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");

  async function load() {
    setLoading(true);
    try {
      const snap = await getDoc(doc(getDb(), `leagues/${leagueId}`));
      const d = snap.exists() ? snap.data() : {};
      setCurrent(typeof d?.current_season === "string" ? d.current_season : null);
      setSeasons(
        Array.isArray(d?.seasons)
          ? (d!.seasons as SeasonRow[]).map((s) => ({
              id: String(s.id),
              label: String(s.label ?? s.id),
              published: s.published === false ? false : true,
            }))
          : [],
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  async function call(payload: Record<string, unknown>, okMsg: string) {
    if (!user) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-season", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, ...payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setMsg(okMsg);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading seasons…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Seasons</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          The <b>active</b> season is what the public sees by default on
          standings, scores and schedule. Switch it whenever you like — past
          seasons stay viewable via the season switcher. Build a future season
          quietly by leaving it <b>hidden</b>, then reveal it when ready.
        </p>
      </div>

      {err && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-3 py-2 border border-red-200">
          {err}
        </p>
      )}
      {msg && (
        <p className="text-sm text-emerald-700 rounded bg-emerald-50 px-3 py-2 border border-emerald-200">
          {msg}
        </p>
      )}

      <div className="space-y-2">
        {seasons.length === 0 && (
          <p className="text-sm text-slate-500">No seasons yet — add one below.</p>
        )}
        {seasons.map((s) => {
          const isCurrent = s.id === current;
          return (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex-1 min-w-[180px]">
                <div className="font-semibold text-slate-800">
                  {s.label}
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 align-middle">
                      ● ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  id: {s.id} ·{" "}
                  {s.published === false ? "hidden from public" : "visible to public"}
                </div>
              </div>

              {!isCurrent && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    call(
                      { action: "set_current", season: s.id },
                      `“${s.label}” is now the active season.`,
                    )
                  }
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Make active
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  call(
                    {
                      action: "set_published",
                      season: s.id,
                      published: s.published === false,
                    },
                    s.published === false
                      ? `“${s.label}” is now visible to the public.`
                      : `“${s.label}” is now hidden from the public.`,
                  )
                }
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {s.published === false ? "Reveal" : "Hide"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-xs font-semibold text-slate-700 mb-2">
          Add a season
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-1">
              Id (short, e.g. 68)
            </span>
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              disabled={busy}
              placeholder="68"
              className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
            />
          </label>
          <label className="block flex-1 min-w-[200px]">
            <span className="block text-[11px] text-slate-500 mb-1">
              Label (shown to fans)
            </span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              disabled={busy}
              placeholder="Season 68 · Spring 2027"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={busy || !newId.trim() || !newLabel.trim()}
            onClick={async () => {
              await call(
                { action: "add_season", id: newId.trim(), label: newLabel.trim() },
                `Added “${newLabel.trim()}” (hidden — reveal it when ready).`,
              );
              setNewId("");
              setNewLabel("");
            }}
            className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Add (hidden)
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          New seasons start hidden. File games under a season in the Schedule
          tab, then <b>Reveal</b> and <b>Make active</b> here when it&apos;s time.
        </p>
      </div>
    </div>
  );
}
