"use client";

// Admin form-submission inbox. Tabs across the four public forms
// (player registration, team registration, team waiver, umpire
// evaluation), reverse-chronological table per kind, click a row to
// expand and see every field.
//
// No mutate / delete — review and act outside the system (email,
// payment confirmation, roster grant). Submissions sit in Firestore
// indefinitely as a paper trail.
//
// Reads via /api/admin-form-submissions which gates on the admin
// claim. Same auth pattern as the audit-log + signups viewers.

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Kind =
  | "player_registration"
  | "team_registration"
  | "team_waiver"
  | "umpire_evaluation";

const KIND_TABS: { key: Kind; label: string }[] = [
  { key: "player_registration", label: "Player registration" },
  { key: "team_registration", label: "Team registration" },
  { key: "team_waiver", label: "Team waiver" },
  { key: "umpire_evaluation", label: "Umpire evaluation" },
];

interface Submission {
  id: string;
  submitted_at: string;
  [k: string]: unknown;
}

interface Props {
  leagueId: string;
  user: User;
}

export function FormSubmissionsViewer({ leagueId, user }: Props) {
  const [kind, setKind] = useState<Kind>("player_registration");
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ leagueId, kind, limit: "100" });
      const res = await fetch(
        `/api/admin-form-submissions?${params.toString()}`,
        { headers: { authorization: `Bearer ${idToken}` } },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items?: Submission[] };
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [user, leagueId, kind]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-slate-900">Form submissions</p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Public-facing forms write here. Review entries to confirm
            payment, grant roster access, or assign a team.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchItems}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {KIND_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setKind(t.key);
              setExpanded(null);
            }}
            className={
              "px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap " +
              (kind === t.key
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No {KIND_TABS.find((t) => t.key === kind)?.label.toLowerCase()}{" "}
          submissions yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
          {items.map((it) => (
            <li key={it.id} className="text-xs">
              <button
                type="button"
                onClick={() =>
                  setExpanded((cur) => (cur === it.id ? null : it.id))
                }
                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-semibold text-slate-900">
                    {summaryLine(kind, it)}
                  </span>
                </span>
                <span className="text-[11px] text-slate-500 font-mono whitespace-nowrap">
                  {fmtTime(String(it.submitted_at ?? ""))}
                </span>
              </button>
              {expanded === it.id && (
                <SubmissionDetail submission={it} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// One-line preview per submission kind. Surfaces the most useful
// identifying field(s) so the admin can scan a list of 50 at a glance.
function summaryLine(kind: Kind, s: Submission): string {
  if (kind === "player_registration") {
    const fn = s.first_name ?? "";
    const ln = s.last_name ?? "";
    const div = s.division ?? "";
    const team = s.team_name ?? "";
    return [
      `${fn} ${ln}`.trim() || "(unnamed)",
      div && `· ${div}`,
      team && `· ${team}`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (kind === "team_registration") {
    const team = s.team_name ?? "(unnamed team)";
    const mgr = `${s.manager_first_name ?? ""} ${s.manager_last_name ?? ""}`.trim();
    return mgr ? `${team} — ${mgr}` : String(team);
  }
  if (kind === "team_waiver") {
    return String(s.team_name ?? "(unnamed team)") +
      (s.signature ? ` — signed by ${s.signature}` : "");
  }
  if (kind === "umpire_evaluation") {
    const ev = s.evaluator_name ?? "";
    const date = s.game_date ?? "";
    const matchup = `${s.visiting_team ?? "?"} @ ${s.home_team ?? "?"}`;
    return `${matchup}${date ? ` (${date})` : ""}${ev ? ` — ${ev}` : ""}`;
  }
  return s.id;
}

// Render an expanded submission as a labeled table instead of raw JSON.
// Adam's feedback: "let make it actually lookk readable and nice." We
// turn snake_case keys into Title Case, format dates / phones / emails
// into tappable links, and prettify booleans. Unknown keys fall through
// to a plain string render rather than being dropped, so a future
// schema addition still appears (just without the prettifier).
function SubmissionDetail({ submission }: { submission: Submission }) {
  // Fields we never want to show in the body — already surfaced in the
  // row header (submitted_at + id) or pure plumbing.
  const HIDE = new Set(["id", "submitted_at"]);
  const entries = Object.entries(submission).filter(
    ([k]) => !HIDE.has(k),
  );
  return (
    <div className="px-3 py-3 bg-slate-50 border-t border-slate-200">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        {entries.map(([key, value]) => (
          <FieldRow key={key} fieldKey={key} value={value} />
        ))}
      </dl>
    </div>
  );
}

function FieldRow({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  const label = humanLabel(fieldKey);
  return (
    <>
      <dt className="text-slate-500 font-medium uppercase tracking-wider text-[10px] self-center">
        {label}
      </dt>
      <dd className="text-slate-900 break-words min-w-0">
        <FieldValue fieldKey={fieldKey} value={value} />
      </dd>
    </>
  );
}

function FieldValue({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  // Empty / missing → muted dash so the row doesn't look broken.
  if (value == null || value === "") {
    return <span className="text-slate-400">—</span>;
  }
  // Consent / waiver booleans get a real visual check, not just
  // "true". Other booleans fall through to the same treatment so
  // future yes/no fields don't need bespoke handling.
  if (typeof value === "boolean") {
    return value ? (
      <span className="text-emerald-700 font-semibold">✓ Yes</span>
    ) : (
      <span className="text-red-700 font-semibold">✗ No</span>
    );
  }
  if (typeof value === "string") {
    // Email — open in the admin's mail client.
    if (fieldKey === "email" || /^email_/.test(fieldKey)) {
      return (
        <a
          href={`mailto:${value}`}
          className="text-blue-700 underline-offset-2 hover:underline break-all"
        >
          {value}
        </a>
      );
    }
    // Phone — tappable on mobile, normalized digits in the href.
    if (fieldKey === "phone" || /_phone$/.test(fieldKey)) {
      const digits = value.replace(/[^\d+]/g, "");
      return (
        <a
          href={`tel:${digits}`}
          className="text-blue-700 underline-offset-2 hover:underline"
        >
          {value}
        </a>
      );
    }
    // Date of birth / game_date / signed_on — display in a friendly
    // way and include age when we recognize a DOB.
    if (/^date_|_date$|^dob$/.test(fieldKey) || fieldKey === "game_date") {
      const friendly = formatDate(value);
      if (fieldKey === "dob") {
        const age = ageFromDob(value);
        return (
          <span>
            {friendly}
            {age != null && (
              <span className="text-slate-500 ml-2">({age} yo)</span>
            )}
          </span>
        );
      }
      return <span>{friendly}</span>;
    }
    // Position abbreviations get expanded so "C" isn't ambiguous.
    if (fieldKey === "primary_position") {
      return <span>{expandPosition(value)}</span>;
    }
    // Long notes / signatures — preserve newlines.
    if (
      fieldKey === "notes" ||
      fieldKey === "signature" ||
      fieldKey === "comments"
    ) {
      return <span className="whitespace-pre-wrap">{value}</span>;
    }
    return <span>{value}</span>;
  }
  if (typeof value === "number") {
    return <span>{value}</span>;
  }
  // Arrays / objects / anything else — show the JSON inline; rare
  // enough that a generic fallback is fine.
  return (
    <code className="text-[11px] text-slate-700">
      {JSON.stringify(value)}
    </code>
  );
}

function humanLabel(key: string): string {
  // Hand-overrides where the auto title-case looks off.
  const OVERRIDES: Record<string, string> = {
    dob: "Date of birth",
    primary_position: "Position",
    agreed_to_terms: "Waiver agreed",
    team_name: "Team",
    manager_first_name: "Manager first",
    manager_last_name: "Manager last",
    evaluator_name: "Evaluator",
    visiting_team: "Visiting team",
    home_team: "Home team",
  };
  if (OVERRIDES[key]) return OVERRIDES[key];
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(s: string): string {
  // Accept YYYY-MM-DD or full ISO. Render in en-US "May 11, 1992".
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!ymd) return s;
  const d = new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ageFromDob(s: string): number | null {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!ymd) return null;
  const dob = new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const before =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() &&
      now.getUTCDate() < dob.getUTCDate());
  if (before) age--;
  return age;
}

function expandPosition(code: string): string {
  const MAP: Record<string, string> = {
    P: "Pitcher",
    C: "Catcher",
    "1B": "First Base",
    "2B": "Second Base",
    "3B": "Third Base",
    SS: "Shortstop",
    LF: "Left Field",
    CF: "Center Field",
    RF: "Right Field",
    OF: "Outfield",
    IF: "Infield",
    DH: "Designated Hitter",
    UT: "Utility",
  };
  return MAP[code.toUpperCase()] ?? code;
}

function fmtTime(iso: string): string {
  if (!iso) return "";
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
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
