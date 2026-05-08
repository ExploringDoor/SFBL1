"use client";

// Admin sponsors panel.
//
// Manages the league's `sponsors` array. Each sponsor has a name,
// a logo (uploaded as a base64 data URL), and an optional URL the
// logo links to.
//
// The footer renders these on every public page in a horizontal
// strip. Empty list = no strip rendered.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Sponsor {
  name: string;
  logo_url: string;
  url?: string;
}

interface Props {
  leagueId: string;
  user: User;
}

export function SponsorsManager({ leagueId, user }: Props) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const snap = await getDoc(doc(db, `leagues/${leagueId}`));
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : null;
        const list = Array.isArray(data?.sponsors)
          ? (data!.sponsors as Sponsor[]).filter(
              (s) => s && typeof s.name === "string" && typeof s.logo_url === "string",
            )
          : [];
        setSponsors(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  function update(i: number, patch: Partial<Sponsor>) {
    setSponsors((cur) =>
      cur.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }

  function move(i: number, dir: -1 | 1) {
    setSponsors((cur) => {
      const next = [...cur];
      const target = i + dir;
      if (target < 0 || target >= next.length) return cur;
      [next[i], next[target]] = [next[target]!, next[i]!];
      return next;
    });
  }

  function remove(i: number) {
    if (!window.confirm(`Remove ${sponsors[i]?.name || "this sponsor"}?`))
      return;
    setSponsors((cur) => cur.filter((_, idx) => idx !== i));
  }

  function addEmpty() {
    setSponsors((cur) => [...cur, { name: "", logo_url: "" }]);
  }

  function handleFile(i: number, file: File) {
    if (!file.type.startsWith("image/")) {
      setMsg({ ok: false, text: "Pick an image file (PNG, JPG, SVG)." });
      return;
    }
    if (file.size > 1_500_000) {
      setMsg({
        ok: false,
        text: `Logo is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep originals under 1.5 MB.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        update(i, { logo_url: reader.result });
        setMsg(null);
      }
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-sponsors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, sponsors }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        count?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setMsg({
        ok: true,
        text: `Saved. ${data.count ?? 0} sponsor${data.count === 1 ? "" : "s"} live in the footer.`,
      });
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p className="font-semibold text-slate-900">Sponsors</p>
        <p className="text-sm text-slate-500 mt-2">Loading…</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-lg font-bold text-slate-900">Sponsors</p>
          <p className="text-sm text-slate-600 mt-1">
            Logos render as a row at the bottom of every public page.
            Upload PNG with a transparent background — looks best on the
            dark footer.
          </p>
        </div>
        <a
          href="/"
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-500 underline hover:text-slate-900"
        >
          View live →
        </a>
      </div>

      {sponsors.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No sponsors yet. Add the first below — they'll appear on the
          public site as soon as you save.
        </p>
      ) : (
        <ul className="space-y-3">
          {sponsors.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 flex-wrap"
            >
              {s.logo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={s.logo_url}
                  alt={s.name || "Sponsor logo"}
                  className="h-12 w-24 rounded border border-slate-200 object-contain bg-white p-1 flex-shrink-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              ) : (
                <label className="flex h-12 w-24 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-slate-300 bg-white text-[10px] font-semibold text-slate-500 hover:bg-slate-100 flex-shrink-0">
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(i, f);
                      e.currentTarget.value = "";
                    }}
                    disabled={saving}
                  />
                </label>
              )}
              <div className="flex-1 min-w-[200px] grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Sponsor name"
                  disabled={saving}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <input
                  type="url"
                  value={s.url ?? ""}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder="https://sponsor-website.com"
                  disabled={saving}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {s.logo_url && (
                  <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    Replace
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(i, f);
                        e.currentTarget.value = "";
                      }}
                      disabled={saving}
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || saving}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-30"
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === sponsors.length - 1 || saving}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-30"
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={saving}
                  className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={addEmpty}
          disabled={saving}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          + Add sponsor
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ml-auto"
        >
          {saving ? "Saving…" : "Save sponsors"}
        </button>
      </div>

      {msg && (
        <div
          className={
            "text-sm rounded-md px-3 py-2 " +
            (msg.ok
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-800")
          }
        >
          {msg.ok ? "✓ " : "✗ "}
          {msg.text}
        </div>
      )}
    </section>
  );
}
