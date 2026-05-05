"use client";

// Full notification archive for /profile#inbox.
//
// The bell dropdown in the nav shows last 20 unread for quick
// glance. This panel shows the full history — unread + read — so
// captains and players can scroll back through league activity
// (e.g. "what was that final score push from last week?").
//
// Filter: "Unread" (default) / "All". Each item is the same shape
// as the bell entry: title, body, time, category. Tapping
// navigates + marks-read. Per-item × dismisses without navigating.
// "Mark all read" button at top.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/lib/auth-client";

interface InboxItem {
  id: string;
  title: string;
  body: string;
  url: string;
  category: string;
  ts: string;
  dismissed_at: string | null;
}

interface Props {
  leagueId: string;
}

export function InboxPanel({ leagueId }: Props) {
  const user = useUser();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/check-pending-nav?leagueId=${encodeURIComponent(leagueId)}&limit=200&includeDismissed=true`,
        {
          headers: { authorization: `Bearer ${idToken}` },
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Couldn't load inbox");
        return;
      }
      const data = (await res.json()) as { items?: InboxItem[] };
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [user, leagueId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function dismiss(ids: string[]) {
    if (!user || !ids.length) return;
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      await fetch("/api/dismiss-pending-nav", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, ids }),
      });
      const now = new Date().toISOString();
      setItems((cur) =>
        cur.map((it) =>
          ids.includes(it.id) ? { ...it, dismissed_at: now } : it,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function dismissAll() {
    if (!user) return;
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      await fetch("/api/dismiss-pending-nav", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, all: true }),
      });
      const now = new Date().toISOString();
      setItems((cur) =>
        cur.map((it) => ({
          ...it,
          dismissed_at: it.dismissed_at ?? now,
        })),
      );
    } finally {
      setBusy(false);
    }
  }

  const visible =
    filter === "unread"
      ? items.filter((it) => !it.dismissed_at)
      : items;
  const unreadCount = items.filter((it) => !it.dismissed_at).length;

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Inbox</h2>
        <p className="cap-section-sub">
          Every push notification this device has received for this
          league. Tap an item to jump to where it points.
        </p>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      <div className="inbox-toolbar">
        <div className="inbox-filter">
          <button
            type="button"
            className={
              "inbox-filter-btn" + (filter === "unread" ? " active" : "")
            }
            onClick={() => setFilter("unread")}
          >
            Unread {unreadCount > 0 && <span>({unreadCount})</span>}
          </button>
          <button
            type="button"
            className={
              "inbox-filter-btn" + (filter === "all" ? " active" : "")
            }
            onClick={() => setFilter("all")}
          >
            All
          </button>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            className="le-cap-btn-secondary inbox-mark-all"
            onClick={dismissAll}
            disabled={busy}
          >
            {busy ? "Marking…" : "Mark all read"}
          </button>
        )}
      </div>

      {loading ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p
          style={{
            color: "var(--muted)",
            fontSize: 13,
            padding: "32px 16px",
            textAlign: "center",
          }}
        >
          {filter === "unread"
            ? "You're all caught up."
            : "No notifications yet. Push history will show up here once you receive your first one."}
        </p>
      ) : (
        <ul className="inbox-list">
          {visible.map((it) => (
            <li
              key={it.id}
              className={
                "inbox-item" + (it.dismissed_at ? " inbox-item-read" : "")
              }
            >
              <Link
                href={it.url || "/"}
                className="inbox-link"
                onClick={() => {
                  if (!it.dismissed_at) dismiss([it.id]);
                }}
              >
                <div className="inbox-row1">
                  <span className="inbox-title">{it.title}</span>
                  {!it.dismissed_at && <span className="inbox-dot" />}
                </div>
                {it.body && <div className="inbox-body">{it.body}</div>}
                <div className="inbox-meta">
                  {fmtRelative(it.ts)} · {it.category}
                </div>
              </Link>
              {!it.dismissed_at && (
                <button
                  type="button"
                  className="inbox-dismiss"
                  onClick={() => dismiss([it.id])}
                  disabled={busy}
                  aria-label="Mark read"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtRelative(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
