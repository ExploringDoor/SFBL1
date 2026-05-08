"use client";

// Admin "Calendar" panel.
//
// Two layers:
//
// 1. Google Calendar real-time sync (primary).
//    Service-account-managed calendar. When admin saves a schedule
//    change, the schedule API patches the corresponding Calendar
//    event server-side. Subscribers see updates within seconds.
//    Setup: one-click "Set up sync" — creates a public calendar
//    owned by the service account and stores its id on
//    /leagues/{id}/site_config/gcal.
//
// 2. iCalendar (.ics) feeds (fallback).
//    For tenants who don't want / can't enable GCal API, or for
//    Apple Calendar users who already prefer ICS. Slower refresh
//    (Apple ~5-15 min, Google ~24h) but zero infra.
//
// Both are visible: admin picks which to share with players.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface TeamRow {
  id: string;
  name: string;
  division: string;
}

interface GcalConfig {
  enabled: boolean;
  calendar_id: string | null;
  public_url: string | null;
  last_synced_at: string | null;
}

interface Props {
  leagueId: string;
  user: User;
}

export function CalendarFeeds({ leagueId, user }: Props) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // GCal sync state.
  const [gcal, setGcal] = useState<GcalConfig | null>(null);
  const [gcalBusy, setGcalBusy] = useState<
    null | "setup" | "sync_all" | "disable"
  >(null);
  const [gcalMsg, setGcalMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const [teamSnap, gcalDoc] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        getDoc(doc(db, `leagues/${leagueId}/site_config/gcal`)),
      ]);
      if (cancelled) return;
      setTeams(
        teamSnap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? d.id),
            division: String(d.data().division ?? ""),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      if (gcalDoc.exists()) {
        const d = gcalDoc.data();
        setGcal({
          enabled: d.enabled === true,
          calendar_id: d.calendar_id ? String(d.calendar_id) : null,
          public_url: d.public_url ? String(d.public_url) : null,
          last_synced_at: d.last_synced_at
            ? String(d.last_synced_at)
            : null,
        });
      } else {
        setGcal({
          enabled: false,
          calendar_id: null,
          public_url: null,
          last_synced_at: null,
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  async function callGcal(action: "setup" | "sync_all" | "disable") {
    setGcalBusy(action);
    setGcalMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-gcal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        calendar_id?: string;
        public_url?: string;
        synced?: number;
        failed?: number;
        already_setup?: boolean;
      };
      if (!res.ok || !data.ok) {
        setGcalMsg({
          ok: false,
          text: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      if (action === "setup") {
        setGcal({
          enabled: true,
          calendar_id: data.calendar_id ?? null,
          public_url: data.public_url ?? null,
          last_synced_at: null,
        });
        setGcalMsg({
          ok: true,
          text: data.already_setup
            ? "Already set up."
            : `Calendar created. Players can subscribe at the link below — updates from now on auto-sync.`,
        });
      } else if (action === "sync_all") {
        setGcalMsg({
          ok: true,
          text: `Reconciled ${data.synced ?? 0} games${data.failed ? ` (${data.failed} failed)` : ""}.`,
        });
        setGcal((cur) =>
          cur
            ? { ...cur, last_synced_at: new Date().toISOString() }
            : cur,
        );
      } else if (action === "disable") {
        setGcal((cur) => (cur ? { ...cur, enabled: false } : cur));
        setGcalMsg({ ok: true, text: "Sync disabled." });
      }
    } catch (e) {
      setGcalMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setGcalBusy(null);
    }
  }

  function copy(url: string, label: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const leagueUrl = origin ? `${origin}/api/schedule.ics` : "/api/schedule.ics";

  // Group teams by division for cleaner browsing.
  const buckets = new Map<string, TeamRow[]>();
  for (const t of teams) {
    const k = t.division || "—";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }
  const sortedDivs = Array.from(buckets.keys()).sort((a, b) => {
    const an = parseInt(a, 10);
    const bn = parseInt(b, 10);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.localeCompare(b);
  });

  return (
    <section className="space-y-5 rounded-md border border-slate-200 bg-white p-5">
      <div>
        <p className="text-lg font-bold text-slate-900">Calendar</p>
        <p className="text-sm text-slate-600 mt-1">
          Get the schedule onto every player's phone calendar.
        </p>
      </div>

      {/* ── GCal sync (primary) ─── */}
      <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="font-bold text-slate-900">
              📅 Google Calendar — real-time sync
            </p>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Recommended. When you save a schedule change, the
              corresponding Calendar event updates within seconds for
              everyone who has subscribed. No re-sharing, no stale
              data.
            </p>
          </div>
          {gcal?.calendar_id ? (
            gcal.enabled ? (
              <span className="rounded-full bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1">
                ● Live
              </span>
            ) : (
              <span className="rounded-full bg-slate-300 text-slate-700 text-[10px] font-bold uppercase tracking-wider px-2 py-1">
                Disabled
              </span>
            )
          ) : (
            <span className="rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold uppercase tracking-wider px-2 py-1">
              Not set up
            </span>
          )}
        </div>

        {!gcal?.calendar_id ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              <strong>One-time setup needed:</strong> enable the Google
              Calendar API in your Google Cloud project (the same one
              hosting your Firebase service account). Go to{" "}
              <a
                href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                target="_blank"
                rel="noopener"
                className="underline text-blue-700"
              >
                Google Cloud Console → Calendar API → Enable
              </a>
              . Once enabled, click below.
            </p>
            <button
              type="button"
              onClick={() => callGcal("setup")}
              disabled={gcalBusy != null}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {gcalBusy === "setup"
                ? "Setting up…"
                : "🚀 Set up Google Calendar sync"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {gcal.public_url && (
              <FeedRow
                label="Subscribe URL — share with everyone"
                url={gcal.public_url}
                onCopy={() => copy(gcal.public_url!, "gcal-public")}
                copied={copied === "gcal-public"}
              />
            )}
            <p className="text-xs text-slate-500">
              {gcal.last_synced_at
                ? `Last full sync: ${new Date(gcal.last_synced_at).toLocaleString()}`
                : "Auto-syncing on every schedule edit. Click 'Sync now' for a full reconcile."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => callGcal("sync_all")}
                disabled={gcalBusy != null}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {gcalBusy === "sync_all" ? "Syncing…" : "↻ Sync all games now"}
              </button>
              {gcal.enabled ? (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Disable auto-sync? Schedule changes will stop updating the calendar (until you re-enable). The calendar itself stays put.",
                      )
                    ) {
                      callGcal("disable");
                    }
                  }}
                  disabled={gcalBusy != null}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  Disable auto-sync
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => callGcal("setup")}
                  disabled={gcalBusy != null}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Re-enable
                </button>
              )}
            </div>
          </div>
        )}

        {gcalMsg && (
          <div
            className={
              "text-sm rounded-md px-3 py-2 " +
              (gcalMsg.ok
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-red-200 bg-red-50 text-red-800")
            }
          >
            {gcalMsg.ok ? "✓ " : "✗ "}
            {gcalMsg.text}
          </div>
        )}
      </div>

      {/* ── ICS feeds (fallback) ─── */}
      <div className="rounded-md border border-slate-200 p-4 space-y-3">
        <div>
          <p className="font-bold text-slate-900">
            📂 iCalendar (.ics) feeds — fallback
          </p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Direct subscription URLs for Apple Calendar / Outlook /
            other calendar apps. Updates refresh on the calendar
            app's interval (Apple ~5–15 min, Google ~24h — slow, which
            is why GCal API sync above is the recommended path).
          </p>
        </div>

        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 leading-relaxed">
          <strong>How to subscribe:</strong>
          <ul className="mt-1 ml-4 list-disc">
            <li>
              <strong>Apple Calendar (iPhone/Mac):</strong> File → New
              Calendar Subscription → paste URL.
            </li>
            <li>
              <strong>Outlook:</strong> Add calendar → Subscribe from web
              → paste.
            </li>
          </ul>
        </div>

        <FeedRow
          label="League-wide (all teams)"
          url={leagueUrl}
          onCopy={() => copy(leagueUrl, "league")}
          copied={copied === "league"}
        />

      {loading ? (
        <p className="text-sm text-slate-500">Loading teams…</p>
      ) : (
        <div className="space-y-4">
          {sortedDivs.map((div) => (
            <div key={div}>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-2">
                {div === "—" ? "Other" : `${div} Division`}
              </h3>
              <div className="space-y-2">
                {(buckets.get(div) ?? []).map((t) => {
                  const url = `${origin || ""}/api/schedule.ics?team=${encodeURIComponent(t.id)}`;
                  return (
                    <FeedRow
                      key={t.id}
                      label={t.name}
                      url={url}
                      onCopy={() => copy(url, t.id)}
                      copied={copied === t.id}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}

function FeedRow({
  label,
  url,
  onCopy,
  copied,
}: {
  label: string;
  url: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 truncate">
          {label}
        </div>
        <code className="text-xs text-slate-600 truncate block">{url}</code>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex-shrink-0"
      >
        {copied ? "✓ Copied" : "Copy URL"}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex-shrink-0"
        title="View raw .ics feed"
      >
        Preview
      </a>
    </div>
  );
}
