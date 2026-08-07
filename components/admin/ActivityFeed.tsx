"use client";

// Admin → Activity. One chronological feed of everything happening in the
// league, modelled on the Small Town Select / Texas Select admins.
//
// Read state is PER ITEM, kept in localStorage. STS learned this the hard way
// with a single "last seen" timestamp: opening the tab marked everything read
// at once, so anything you had not got to yet vanished from the unread count.
// Here you mark rows off one at a time and the rest stay waiting.

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@/lib/auth-client";

interface Item {
  id: string;
  kind: string;
  at: string;
  title: string;
  detail?: string;
  tab?: string;
}

interface Props {
  leagueId: string;
  /** Lets a row jump to the tab where it is actioned. */
  onNavigate?: (tab: string) => void;
}

// Icon + accent per event type. SVG rather than emoji: emoji render at
// different sizes per platform and look like clip-art next to the rest of the
// panel.
const META: Record<string, { color: string; bg: string; path: string; label: string }> = {
  registration: { color: "#1d4ed8", bg: "#eff6ff", label: "Registration", path: "M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.6L19 9.4V19a2 2 0 0 1-2 2Z" },
  payment: { color: "#15803d", bg: "#f0fdf4", label: "Payment", path: "M3 10h18M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" },
  score: { color: "#b45309", bg: "#fffbeb", label: "Score", path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-7 5c3 1 5 4 5 7m9-7c-3 1-5 4-5 7" },
  game: { color: "#0369a1", bg: "#f0f9ff", label: "Game", path: "M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" },
  roster: { color: "#7c3aed", bg: "#faf5ff", label: "Roster", path: "M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-2a4 4 0 0 0-3-3.9" },
  message: { color: "#be185d", bg: "#fdf2f8", label: "Message", path: "M4 4h16v12H7l-3 3V4Z" },
  feedback: { color: "#0f766e", bg: "#f0fdfa", label: "Feedback", path: "M12 17h.01M12 7v5m9 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  ad: { color: "#9a3412", bg: "#fff7ed", label: "Board post", path: "M3 11l18-8v18l-18-8v-2Zm0 0v5a2 2 0 0 0 2 2h2" },
};
const FALLBACK = { color: "#475569", bg: "#f8fafc", label: "Activity", path: "M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" };
const metaFor = (k: string) => META[k] ?? FALLBACK;

function ago(iso: string) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 90) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityFeed({ leagueId, onNavigate }: Props) {
  const user = useUser();
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [read, setRead] = useState<Set<string>>(new Set());

  const KEY = `le-activity-read:${leagueId}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setRead(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* private mode — read state just won't persist */
    }
  }, [KEY]);

  function persist(next: Set<string>) {
    setRead(new Set(next));
    // Cap it: unbounded growth would eventually blow the 5MB localStorage quota.
    try {
      localStorage.setItem(KEY, JSON.stringify([...next].slice(-3000)));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!user) return;
    let dead = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/admin-activity?leagueId=${encodeURIComponent(leagueId)}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        const j = (await res.json()) as { items?: Item[]; error?: string };
        if (dead) return;
        if (j.error) setErr(j.error);
        setItems(j.items ?? []);
      } catch {
        if (!dead) {
          setErr("Couldn't load activity.");
          setItems([]);
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [leagueId, user]);

  const kinds = useMemo(() => {
    const c = new Map<string, number>();
    (items ?? []).forEach((i) => c.set(i.kind, (c.get(i.kind) ?? 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const shown = useMemo(
    () => (items ?? []).filter((i) => !filter || i.kind === filter),
    [items, filter],
  );
  const unread = (items ?? []).filter((i) => !read.has(i.id)).length;

  if (!items) return <p className="text-sm text-slate-500">Loading activity…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm font-semibold text-slate-700">
          {unread ? `${unread} new` : "All caught up"}
        </span>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => persist(new Set((items ?? []).map((i) => i.id)))}
            className="text-xs text-blue-700 underline-offset-2 hover:underline"
          >
            Mark all read
          </button>
        )}
        <span className="flex-1" />
        <FilterChip on={!filter} onClick={() => setFilter("")} label={`All ${items.length}`} />
        {kinds.map(([k, n]) => (
          <FilterChip
            key={k}
            on={filter === k}
            onClick={() => setFilter(filter === k ? "" : k)}
            label={`${metaFor(k).label} ${n}`}
          />
        ))}
      </div>

      {err && <p className="text-sm text-red-700 mb-3">{err}</p>}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-slate-600 font-medium">Nothing here yet</p>
          <p className="text-slate-500 text-sm mt-1">
            Registrations, payments, scores, roster changes and coach messages
            all show up on this page as they happen.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden bg-white">
          {shown.map((i) => {
            const m = metaFor(i.kind);
            const isNew = !read.has(i.id);
            return (
              <li
                key={i.id}
                className="flex items-start gap-3 px-3 py-2.5"
                style={{ background: isNew ? "#fff" : "#fcfdfe", opacity: isNew ? 1 : 0.62 }}
              >
                <span
                  aria-hidden
                  className="mt-0.5 grid place-items-center rounded-md shrink-0"
                  style={{ width: 26, height: 26, background: m.bg, color: m.color }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={m.path} />
                  </svg>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-slate-900 font-medium leading-snug">
                    {isNew && (
                      <span
                        aria-label="unread"
                        className="inline-block rounded-full align-middle mr-1.5"
                        style={{ width: 6, height: 6, background: m.color }}
                      />
                    )}
                    {i.title}
                  </span>
                  {i.detail && (
                    <span className="block text-[12px] text-slate-500 truncate">{i.detail}</span>
                  )}
                </span>

                <span className="shrink-0 text-[11px] text-slate-400 tabular-nums whitespace-nowrap mt-0.5">
                  {ago(i.at)}
                </span>

                {i.tab && onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate(i.tab!)}
                    className="shrink-0 text-[11px] text-blue-700 underline-offset-2 hover:underline mt-0.5"
                  >
                    Open
                  </button>
                )}

                <button
                  type="button"
                  title={isNew ? "Mark read" : "Mark unread"}
                  onClick={() => {
                    const next = new Set(read);
                    if (isNew) next.add(i.id);
                    else next.delete(i.id);
                    persist(next);
                  }}
                  className="shrink-0 text-[11px] text-slate-400 hover:text-slate-700 mt-0.5"
                >
                  {isNew ? "✓" : "↺"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2 py-1 rounded-full border transition-colors"
      style={{
        borderColor: on ? "#1d4ed8" : "#e2e8f0",
        background: on ? "#eff6ff" : "#fff",
        color: on ? "#1d4ed8" : "#475569",
        fontWeight: on ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}
