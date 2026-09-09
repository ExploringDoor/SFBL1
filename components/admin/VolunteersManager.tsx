"use client";

// Admin "Volunteers" — the game-day jobs board (ETBL, 2026-09).
//
// Three things on one screen, in the order a commissioner uses them:
//
//   1. Generate from schedule — pick a date range (and optionally one gym),
//      tick the jobs, and one shift per game per job appears on the public
//      board. Deterministic ids mean running it again after a schedule
//      change MERGES: slots, claims and notes the admin edited survive.
//   2. The shift list — edit or delete any shift, add a one-off by hand.
//   3. Who signed up — the contact sheet. Names, emails and phones never
//      touch the public board (lib/volunteer-shifts); this is the one place
//      they come out, and only /api/snack-bar's list_claims serves them.
//
// Reads snackbar_shifts straight from Firestore (it is world-readable) and
// posts every change to /api/snack-bar, which checks the "volunteers" scope —
// the league admin and the town commissioners both have it.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { formatTime12 } from "@/lib/format-time";
import {
  DEFAULT_JOBS,
  jobOf,
  jobOrder,
  openSlots,
  type PublicClaim,
  type Shift,
} from "@/lib/volunteer-shifts";

interface Props {
  leagueId: string;
  user: User;
}

interface Contact {
  display_name: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
}

interface SheetRow {
  id: string;
  date: string;
  start: string;
  end: string;
  location: string;
  job: string;
  game_label: string;
  slots: number;
  claims: PublicClaim[];
  contacts: Contact[];
}

/** Editable copy of a shift. Strings throughout so inputs stay controlled. */
interface Draft {
  id: string;
  date: string;
  start: string;
  end: string;
  location: string;
  slots: string;
  note: string;
  job: string;
  game_id: string;
  game_label: string;
}

const INPUT =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
const BTN =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const BTN_GO =
  "rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50";

function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA");
}

function toDraft(s: Shift): Draft {
  return {
    id: s.id,
    date: s.date,
    start: s.start,
    end: s.end ?? "",
    location: s.location ?? "",
    slots: String(s.slots),
    note: s.note ?? "",
    job: jobOf(s),
    game_id: s.game_id ?? "",
    game_label: s.game_label ?? "",
  };
}

function blankDraft(): Draft {
  return {
    id: "",
    date: localDay(1),
    start: "09:00",
    end: "",
    location: "",
    slots: "1",
    note: "",
    job: DEFAULT_JOBS[0],
    game_id: "",
    game_label: "",
  };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export function VolunteersManager({ leagueId, user }: Props) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [gyms, setGyms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [sheet, setSheet] = useState<SheetRow[] | null>(null);

  // Generator form.
  const [from, setFrom] = useState(localDay(0));
  const [to, setTo] = useState(localDay(14));
  const [gym, setGym] = useState("");
  const [jobRows, setJobRows] = useState<
    { job: string; slots: string; on: boolean; custom: boolean }[]
  >([
    { job: "Clock", slots: "1", on: true, custom: false },
    { job: "Scorebook", slots: "1", on: true, custom: false },
    { job: "Snack Bar", slots: "2", on: true, custom: false },
    { job: "", slots: "1", on: false, custom: true },
  ]);

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      const [shiftSnap, gameSnap] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/snackbar_shifts`)),
        getDocs(collection(db, `leagues/${leagueId}/games`)),
      ]);
      const list: Shift[] = [];
      shiftSnap.forEach((d) => {
        const t = d.data() as Record<string, unknown>;
        const date = String(t.date ?? "");
        if (!date) return;
        list.push({
          id: d.id,
          date,
          start: String(t.start ?? ""),
          end: t.end ? String(t.end) : undefined,
          location: t.location ? String(t.location) : undefined,
          slots: Number(t.slots) || 1,
          claims: Array.isArray(t.claims) ? (t.claims as PublicClaim[]) : [],
          note: t.note ? String(t.note) : undefined,
          job: t.job ? String(t.job) : undefined,
          game_id: t.game_id ? String(t.game_id) : undefined,
          game_label: t.game_label ? String(t.game_label) : undefined,
        });
      });
      list.sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.start.localeCompare(b.start) ||
          (a.game_label ?? "").localeCompare(b.game_label ?? "") ||
          jobOrder(jobOf(a)) - jobOrder(jobOf(b)),
      );
      setShifts(list);
      // Gyms come from the schedule: every distinct place a game is played.
      const g = new Set<string>();
      gameSnap.forEach((d) => {
        const f = String((d.data() as { field?: unknown }).field ?? "").trim();
        if (f) g.add(f);
      });
      setGyms([...g].sort((a, b) => a.localeCompare(b)));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Load failed" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Upcoming by default; a past shift is only interesting for the contact
  // sheet, so "show past" is a checkbox rather than the default view.
  const today = localDay(0);
  const visible = useMemo(
    () => (showPast ? shifts : shifts.filter((s) => s.date >= today)),
    [shifts, showPast, today],
  );
  const listFrom = visible[0]?.date ?? today;
  const listTo = visible[visible.length - 1]?.date ?? today;
  const openTotal = visible.reduce((n, s) => n + openSlots(s), 0);

  async function call<T extends Record<string, unknown>>(
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<T | null> {
    setBusy(true);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/snack-bar", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
        return null;
      }
      return data;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    const jobs = jobRows
      .filter((r) => r.on && r.job.trim())
      .map((r) => ({ job: r.job.trim(), slots: Number(r.slots) || 1 }));
    if (jobs.length === 0) {
      setMsg({ ok: false, text: "Tick at least one job." });
      return;
    }
    const data = await call<{ games: number; created: number; updated: number }>(
      "generate_from_schedule",
      { from, to, gym: gym || undefined, jobs },
    );
    if (!data) return;
    setMsg({
      ok: true,
      text: `Created ${data.created}, updated ${data.updated} shift${
        data.created + data.updated === 1 ? "" : "s"
      } across ${data.games} game${data.games === 1 ? "" : "s"}.`,
    });
    await load();
  }

  async function saveDraft() {
    if (!editing) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editing.date) || !/^\d{1,2}:\d{2}$/.test(editing.start)) {
      setMsg({ ok: false, text: "A shift needs a date and a start time (HH:MM)." });
      return;
    }
    const data = await call<{ saved: number }>("save_shifts", {
      shifts: [
        {
          ...(editing.id ? { id: editing.id } : {}),
          date: editing.date,
          start: editing.start,
          end: editing.end,
          location: editing.location,
          slots: Number(editing.slots) || 1,
          note: editing.note,
          job: editing.job,
          ...(editing.game_id ? { game_id: editing.game_id } : {}),
          game_label: editing.game_label,
        },
      ],
    });
    if (!data) return;
    setMsg({ ok: true, text: editing.id ? "Shift saved." : "Shift added." });
    setEditing(null);
    await load();
  }

  async function remove(s: Shift) {
    const who = s.claims.length ? ` ${s.claims.length} volunteer(s) are signed up.` : "";
    if (!window.confirm(`Delete this ${jobOf(s)} shift on ${s.date}?${who}`)) return;
    const data = await call<{ ok: boolean }>("delete_shift", { shiftId: s.id });
    if (!data) return;
    setMsg({ ok: true, text: "Shift deleted." });
    await load();
  }

  async function whoSignedUp(shiftId?: string) {
    const data = await call<{ shifts: SheetRow[] }>(
      "list_claims",
      shiftId ? { shiftId } : { from: listFrom, to: listTo },
    );
    if (!data) return;
    setSheet(data.shifts);
  }

  function sheetCsv(): string {
    if (!sheet) return "";
    const lines = [
      ["Date", "Start", "Job", "Game", "Location", "Name", "Email", "Phone"].join(","),
    ];
    for (const r of sheet) {
      for (const c of r.contacts) {
        lines.push(
          [r.date, r.start, r.job, r.game_label, r.location, c.name, c.email, c.phone]
            .map(csvCell)
            .join(","),
        );
      }
    }
    return lines.join("\n");
  }

  function printSheet() {
    if (!sheet) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rows = sheet
      .flatMap((r) =>
        (r.contacts.length ? r.contacts : [null]).map(
          (c) =>
            `<tr><td>${esc(r.date)} ${esc(formatTime12(r.start))}</td><td>${esc(r.job)}</td><td>${esc(
              r.game_label || r.location,
            )}</td><td>${c ? esc(c.name) : "<em>open</em>"}</td><td>${
              c ? esc(c.email) : ""
            }</td><td>${c ? esc(c.phone) : ""}</td></tr>`,
        ),
      )
      .join("");
    w.document.write(
      `<title>Volunteer sheet</title><style>body{font:13px system-ui;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f1f5f9}</style><h2>Volunteer contact sheet</h2><table><thead><tr><th>When</th><th>Job</th><th>Game / gym</th><th>Name</th><th>Email</th><th>Phone</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="space-y-6">
      {msg && (
        <p
          className={`rounded px-2 py-1 text-sm border ${
            msg.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* ── 1. Generate from schedule ─────────────────────────────── */}
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p className="font-semibold text-slate-900">Generate from the schedule</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          One shift per game per job, for every game in the range. Safe to run
          again after the schedule changes: shifts that already exist keep their
          slots, notes and sign-ups.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">Gym</span>
            <select value={gym} onChange={(e) => setGym(e.target.value)} className={INPUT}>
              <option value="">All gyms</option>
              {gyms.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {jobRows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={r.on}
                onChange={(e) =>
                  setJobRows((cur) => cur.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))
                }
                aria-label={r.custom ? "Custom job" : r.job}
              />
              {r.custom ? (
                <input
                  value={r.job}
                  placeholder="Another job (e.g. Gate table)"
                  onChange={(e) =>
                    setJobRows((cur) => cur.map((x, j) => (j === i ? { ...x, job: e.target.value } : x)))
                  }
                  className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              ) : (
                <span className="w-56 font-medium text-slate-800">{r.job}</span>
              )}
              <label className="flex items-center gap-1 text-xs text-slate-600">
                slots
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={r.slots}
                  onChange={(e) =>
                    setJobRows((cur) => cur.map((x, j) => (j === i ? { ...x, slots: e.target.value } : x)))
                  }
                  className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
          ))}
        </div>
        <button type="button" onClick={generate} disabled={busy} className={`mt-3 ${BTN_GO}`}>
          {busy ? "Working…" : "Generate shifts"}
        </button>
      </section>

      {/* ── 2. Shifts ─────────────────────────────────────────────── */}
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-semibold text-slate-900">Shifts</p>
            <p className="mt-1 text-xs text-slate-600">
              {visible.length} shift{visible.length === 1 ? "" : "s"}, {openTotal} open slot
              {openTotal === 1 ? "" : "s"}. Parents sign up at <span className="font-mono">/volunteers</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
              show past
            </label>
            <button type="button" onClick={() => whoSignedUp()} disabled={busy || visible.length === 0} className={BTN}>
              Contact sheet for shown dates
            </button>
            <button type="button" onClick={() => setEditing(blankDraft())} disabled={busy} className={BTN}>
              + Add shift
            </button>
          </div>
        </div>

        {editing && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">
              {editing.id ? "Edit shift" : "New shift"}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} className={INPUT} aria-label="Date" />
              <input value={editing.start} placeholder="Start HH:MM" onChange={(e) => setEditing({ ...editing, start: e.target.value })} className={INPUT} aria-label="Start" />
              <input value={editing.end} placeholder="End HH:MM (optional)" onChange={(e) => setEditing({ ...editing, end: e.target.value })} className={INPUT} aria-label="End" />
              <input type="number" min={1} max={20} value={editing.slots} onChange={(e) => setEditing({ ...editing, slots: e.target.value })} className={INPUT} aria-label="Slots" />
              <input value={editing.job} list="le-volunteer-jobs" placeholder="Job" onChange={(e) => setEditing({ ...editing, job: e.target.value })} className={INPUT} aria-label="Job" />
              <datalist id="le-volunteer-jobs">
                {DEFAULT_JOBS.map((j) => (
                  <option key={j} value={j} />
                ))}
              </datalist>
              <input value={editing.location} list="le-volunteer-gyms" placeholder="Gym / location" onChange={(e) => setEditing({ ...editing, location: e.target.value })} className={INPUT} aria-label="Location" />
              <datalist id="le-volunteer-gyms">
                {gyms.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <input value={editing.game_label} placeholder="Game (e.g. Mineola vs Quitman — 4th Grade)" onChange={(e) => setEditing({ ...editing, game_label: e.target.value })} className={`${INPUT} sm:col-span-2`} aria-label="Game" />
              <input value={editing.note} placeholder="Note shown on the card (optional)" onChange={(e) => setEditing({ ...editing, note: e.target.value })} className={`${INPUT} sm:col-span-4`} aria-label="Note" />
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={saveDraft} disabled={busy} className={BTN_GO}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setEditing(null)} disabled={busy} className={BTN}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading shifts…</p>
        ) : visible.length === 0 ? (
          <p className="mt-3 text-sm italic text-slate-500">
            No upcoming shifts. Generate them from the schedule above, or add one by hand.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-2">When</th>
                  <th className="py-1 pr-2">Job</th>
                  <th className="py-1 pr-2">Game / gym</th>
                  <th className="py-1 pr-2">Filled</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((s) => {
                  const open = openSlots(s);
                  return (
                    <tr key={s.id}>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {s.date} <span className="text-slate-500">{formatTime12(s.start)}</span>
                      </td>
                      <td className="py-1.5 pr-2 font-medium">{jobOf(s)}</td>
                      <td className="py-1.5 pr-2">
                        {s.game_label && <div>{s.game_label}</div>}
                        {s.location && <div className="text-xs text-slate-500">{s.location}</div>}
                        {s.note && <div className="text-xs italic text-slate-500">{s.note}</div>}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <span className={open === 0 ? "font-semibold text-emerald-700" : ""}>
                          {s.claims.length}/{s.slots}
                        </span>
                        {s.claims.length > 0 && (
                          <span className="ml-1 text-xs text-slate-500">
                            {s.claims.map((c) => c.display_name).join(", ")}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 whitespace-nowrap text-right">
                        <button type="button" onClick={() => setEditing(toDraft(s))} disabled={busy} className={`${BTN} mr-1`}>
                          Edit
                        </button>
                        <button type="button" onClick={() => whoSignedUp(s.id)} disabled={busy || s.claims.length === 0} className={`${BTN} mr-1`}>
                          Who signed up
                        </button>
                        <button type="button" onClick={() => remove(s)} disabled={busy} className={`${BTN} text-red-700`}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 3. Who signed up ──────────────────────────────────────── */}
      {sheet && (
        <section className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">Who signed up</p>
              <p className="mt-1 text-xs text-slate-600">
                Contact details for the league only — they are never shown on the website.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(sheetCsv()).then(
                    () => setMsg({ ok: true, text: "Copied as CSV." }),
                    () => setMsg({ ok: false, text: "Could not copy." }),
                  );
                }}
                className={BTN}
              >
                Copy CSV
              </button>
              <button type="button" onClick={printSheet} className={BTN}>
                Print
              </button>
              <button type="button" onClick={() => setSheet(null)} className={BTN}>
                Close
              </button>
            </div>
          </div>
          {sheet.every((r) => r.contacts.length === 0) ? (
            <p className="mt-3 text-sm italic text-slate-500">Nobody has signed up yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-2">When</th>
                    <th className="py-1 pr-2">Job</th>
                    <th className="py-1 pr-2">Game / gym</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Email</th>
                    <th className="py-1">Phone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sheet.flatMap((r) =>
                    r.contacts.map((c) => (
                      <tr key={`${r.id}:${c.display_name}`}>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {r.date} {formatTime12(r.start)}
                        </td>
                        <td className="py-1.5 pr-2">{r.job}</td>
                        <td className="py-1.5 pr-2">{r.game_label || r.location}</td>
                        <td className="py-1.5 pr-2 font-medium">{c.name}</td>
                        <td className="py-1.5 pr-2">
                          {c.email ? <a href={`mailto:${c.email}`} className="text-blue-700 underline">{c.email}</a> : ""}
                        </td>
                        <td className="py-1.5">
                          {c.phone ? <a href={`tel:${c.phone}`} className="text-blue-700 underline">{c.phone}</a> : ""}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
