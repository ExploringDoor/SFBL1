"use client";

// In-app notification bell — DVSL parity for "I missed the push, did
// I miss the message?" The OS push tray works while the device is
// listening, but pushes get dismissed, lock-screen-cleared, etc.
// The bell shows recent push history scoped to the active league.
//
// Mounts in the site nav for any signed-in user. Polls
// /api/check-pending-nav every 60s + on focus + on hashchange. Shows
// a red dot + count when unread > 0. Click opens a dropdown of
// recent items; tapping an item navigates + dismisses; "Clear all"
// dismisses everything unread.
//
// Per-tenant: queries scoped by leagueId. Empty for users on the
// bare apex (no tenant context).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@/lib/auth-client";

interface PendingItem {
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

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell({ leagueId }: Props) {
  const user = useUser();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const fetchItems = useCallback(async () => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/check-pending-nav?leagueId=${encodeURIComponent(leagueId)}&limit=20`,
        {
          headers: { authorization: `Bearer ${idToken}` },
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { items?: PendingItem[] };
      setItems(data.items ?? []);
    } catch {
      /* network blip — keep prior state */
    }
  }, [user, leagueId]);

  // Initial fetch + poll loop + refresh on tab focus + hash change
  // (push tap routes via SwNavigateListener which fires hashchange).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (cancelled) return;
      fetchItems();
    };
    tick(); // initial
    timer = setInterval(tick, POLL_INTERVAL_MS);

    const onFocus = () => tick();
    const onHash = () => tick();
    window.addEventListener("focus", onFocus);
    window.addEventListener("hashchange", onHash);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("hashchange", onHash);
    };
  }, [user, fetchItems]);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function dismiss(ids: string[]) {
    if (!user || !ids.length) return;
    setLoading(true);
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
      // Optimistic local update — remove dismissed from the unread
      // view. The next poll will reconcile if anything's off.
      setItems((cur) =>
        cur.map((it) =>
          ids.includes(it.id)
            ? { ...it, dismissed_at: new Date().toISOString() }
            : it,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function dismissAll() {
    if (!user) return;
    setLoading(true);
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
      setItems((cur) =>
        cur.map((it) => ({
          ...it,
          dismissed_at: it.dismissed_at ?? new Date().toISOString(),
        })),
      );
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  const unreadItems = items.filter((i) => !i.dismissed_at);
  const unreadCount = unreadItems.length;

  return (
    <div className="notif-bell" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="notif-bell-btn"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
            : "Notifications"
        }
      >
        <span aria-hidden>🔔</span>
        {unreadCount > 0 && (
          <span className="notif-bell-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-bell-panel" role="dialog" aria-label="Notifications">
          <div className="notif-bell-head">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={dismissAll}
                disabled={loading}
                className="notif-bell-clear"
              >
                Clear all
              </button>
            )}
          </div>

          {unreadItems.length === 0 ? (
            <p className="notif-bell-empty">
              You're all caught up.{" "}
              <Link href="/profile#notif" onClick={() => setOpen(false)}>
                Manage notifications
              </Link>
            </p>
          ) : (
            <ul className="notif-bell-list">
              {unreadItems.map((it) => (
                <li key={it.id} className="notif-bell-item">
                  <Link
                    href={it.url || "/"}
                    className="notif-bell-link"
                    onClick={() => {
                      dismiss([it.id]);
                      setOpen(false);
                    }}
                  >
                    <div className="notif-bell-title">{it.title}</div>
                    {it.body && (
                      <div className="notif-bell-body">{it.body}</div>
                    )}
                    <div className="notif-bell-meta">
                      {fmtRelative(it.ts)} · {it.category}
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="notif-bell-dismiss"
                    onClick={() => dismiss([it.id])}
                    aria-label="Dismiss"
                    disabled={loading}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="notif-bell-foot">
            <Link
              href="/profile#notif"
              onClick={() => setOpen(false)}
              className="notif-bell-foot-link"
            >
              ⚙ Settings
            </Link>
          </div>
        </div>
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
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
