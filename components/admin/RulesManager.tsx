"use client";

// Admin "Rules" tab — edit the published rules page.
//
// Mike, 2026-09-03: "how do I edit the rules". Until now the answer was that he
// emailed me. The Pages tab claims to edit Rules but lists page_content docs,
// and Island's rules live in the STRUCTURED document that /rules prefers, so
// the rules were both missing from that list and unreachable from it.
//
// SHAPE, which drives the whole layout below. site_config/rules holds:
//   divisions: [{ key, label, sub? }]        the tabs across the top of /rules
//   data:      [ section, ... ]              the cards, in display order
// and a section is one of two things:
//   { section, icon?, divisions?, items:  ["a rule", ...] }        bullets
//   { section, icon?, divisions?, kind:"specs", specs:[{label,value}] }  tiles
// `divisions` omitted or empty means the section shows on every tab.
//
// ONE LINE PER BULLET, IN A TEXTAREA. The obvious design is an input box per
// rule with add and remove buttons, and it is wrong here: Conduct And Ejections
// alone is eleven bullets, so the page becomes fifty little boxes and editing a
// sentence costs a click to find it. A textarea lets him paste a block straight
// out of the email the change arrived in, which is how these edits actually
// turn up.
//
// SAVING IS ALL-OR-NOTHING, through /api/admin-rules, which snapshots the
// previous version before overwriting. The Undo control below reads those
// snapshots back into the form so a bad paste is a thirty-second fix.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  fromDraft,
  toDraft,
  type DraftSection as StoredDraft,
  type SpecPair,
} from "@/lib/rules-doc";

interface Props {
  leagueId: string;
  user: User;
}

interface DivisionDef {
  key: string;
  label: string;
  sub?: string;
}
/** A section as the form holds it. The shape is shared with the save path
 *  (lib/rules-doc.ts); the uid is local, and only there so React keys survive
 *  a reorder without inputs swapping their contents. */
interface DraftSection extends StoredDraft {
  uid: string;
}

interface HistoryEntry {
  at: string;
  by?: string;
  content_updated?: string | null;
  data?: unknown[];
  divisions?: DivisionDef[];
}

// The icon names the public renderer knows (components/RulesRichView.tsx).
// Anything else falls through as literal text, so this is a closed list.
const ICONS = [
  "book",
  "ball",
  "clipboard",
  "calendar",
  "warning",
  "roster",
  "trophy",
  "shield",
  "star",
] as const;

let seq = 0;
const nextUid = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The shared reader, plus the uid the list needs. */
function toRow(raw: unknown): DraftSection {
  return { uid: nextUid(), ...toDraft(raw) };
}

export function RulesManager({ leagueId, user }: Props) {
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [divisions, setDivisions] = useState<DivisionDef[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [contentUpdated, setContentUpdated] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Which rules page this league actually publishes. See the note by the
  // markdown panel below: this tab must not be an editor for the second kind.
  const [mode, setMode] = useState<"structured" | "markdown" | "none">("none");

  const patch = (uid: string, next: Partial<DraftSection>) => {
    setSections((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, ...next } : s)),
    );
    setDirty(true);
    setMsg(null);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const db = getDb();
        const [rulesSnap, histSnap, mdSnap] = await Promise.all([
          getDoc(doc(db, `leagues/${leagueId}/site_config/rules`)),
          getDoc(doc(db, `leagues/${leagueId}/site_config/rules_history`)),
          getDoc(doc(db, `leagues/${leagueId}/page_content/rules`)),
        ]);
        if (!alive) return;
        const d = rulesSnap.exists() ? rulesSnap.data() : null;
        const structured = Array.isArray(d?.data) ? (d!.data as unknown[]) : [];
        setMode(
          structured.length
            ? "structured"
            : mdSnap.exists()
              ? "markdown"
              : "none",
        );
        setSections(structured.map(toRow));
        setDivisions(
          Array.isArray(d?.divisions) ? (d!.divisions as DivisionDef[]) : [],
        );
        setContentUpdated(
          typeof d?.content_updated === "string" ? d!.content_updated : "",
        );
        const hv = histSnap.exists() ? histSnap.data()?.versions : null;
        setHistory(Array.isArray(hv) ? (hv as HistoryEntry[]) : []);
        setDirty(false);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Couldn't load the rules");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  // Warn before a reload or a tab close throws away unsaved work. These edits
  // arrive as long pastes and retyping one is a real cost.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const ruleCount = useMemo(
    () =>
      sections.reduce(
        (n, s) =>
          n +
          (s.kind === "specs"
            ? s.specs.filter((p) => p.label.trim() && p.value.trim()).length
            : s.text.split("\n").filter((l) => l.trim()).length),
        0,
      ),
    [sections],
  );

  function move(idx: number, dir: -1 | 1) {
    const to = idx + dir;
    if (to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [row] = next.splice(idx, 1);
    next.splice(to, 0, row!);
    setSections(next);
    setDirty(true);
    setMsg(null);
  }

  function addSection(kind: "rules" | "specs") {
    setSections((prev) => [
      ...prev,
      {
        uid: nextUid(),
        section: "",
        icon: kind === "specs" ? "clipboard" : "book",
        divisions: [],
        kind,
        text: "",
        specs: kind === "specs" ? [{ label: "", value: "" }] : [],
      },
    ]);
    setDirty(true);
    setMsg(null);
  }

  function removeSection(s: DraftSection) {
    const name = s.section.trim() || "this untitled section";
    if (!confirm(`Remove ${name} from the rules page?`)) return;
    setSections((prev) => prev.filter((x) => x.uid !== s.uid));
    setDirty(true);
    setMsg(null);
  }

  function loadVersion(h: HistoryEntry) {
    const when = new Date(h.at).toLocaleString();
    if (
      !confirm(
        `Load the version from ${when} into the form?\n\n` +
          `Nothing changes on the site until you press Save, so you can look ` +
          `it over first.`,
      )
    ) {
      return;
    }
    setSections(Array.isArray(h.data) ? h.data.map(toRow) : []);
    if (Array.isArray(h.divisions) && h.divisions.length) setDivisions(h.divisions);
    setDirty(true);
    setMsg(`Loaded the version from ${when}. Press Save to publish it.`);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-rules", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          sections: sections.map(fromDraft),
          divisions,
          // Blank means "stamp today", which is what an edit almost always
          // wants. Kept editable for a correction that should not move the date.
          contentUpdated: contentUpdated || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        sections?: number;
        dropped?: number;
        content_updated?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setDirty(false);
      if (data.content_updated) setContentUpdated(data.content_updated);
      setMsg(
        `Saved. ${data.sections} sections are live on the rules page` +
          (data.dropped
            ? `. ${data.dropped} empty ${data.dropped === 1 ? "section was" : "sections were"} skipped.`
            : "."),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none";

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">Rules</h2>
        <p className="text-sm text-slate-600">
          Everything on the public{" "}
          <a
            href="/rules"
            target="_blank"
            rel="noopener"
            className="font-semibold text-blue-700 underline"
          >
            rules page
          </a>
          . Edit the wording, add or remove a rule, then press Save. Changes go
          live straight away.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {msg && (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading the rules…</p>
      ) : mode !== "structured" ? (
        // NOT AN EDITOR FOR THIS LEAGUE, and the reason is worth stating plainly
        // because the failure it prevents is silent and expensive.
        //
        // /rules renders one of two things. Some leagues (Island, LBDC) publish
        // the STRUCTURED document this tab edits. Others (COYBL, SFBL, Windmill)
        // publish a markdown page from page_content, edited on the Pages tab.
        // app/rules/page.tsx PREFERS the structured document whenever it has
        // sections, so if someone here typed one section and pressed Save, that
        // single section would replace their entire rules page and the original
        // would still be sitting in page_content looking untouched.
        //
        // COYBL's rules page alone is the league rules plus a rulebook per age
        // group plus bats, baseballs and field dimensions. So this tab shows a
        // signpost, not a form, unless a structured rulebook already exists.
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            {mode === "markdown" ? (
              <>
                This league&rsquo;s rules page is written as one document, so it
                is edited on the{" "}
                <strong>Pages</strong> tab (under <strong>More</strong>) rather
                than here. Open Pages, find <strong>rules</strong> in the list,
                and press Edit.
              </>
            ) : (
              <>
                This league has no rules page set up yet. Ask Adam to build one
                and it will become editable here.
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Nothing on this tab can change your rules page.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {sections.map((s, i) => (
              <div
                key={s.uid}
                className="rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    value={s.section}
                    onChange={(e) => patch(s.uid, { section: e.target.value })}
                    placeholder="Section heading, e.g. Playing The Game"
                    className={`${input} sm:w-72`}
                  />
                  <select
                    value={s.icon}
                    onChange={(e) => patch(s.uid, { icon: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    aria-label="Icon"
                  >
                    {ICONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                    {s.kind === "specs" ? "At a glance" : "Rules"}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === sections.length - 1}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSection(s)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {divisions.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-500">Shows on:</span>
                    {divisions.map((d) => {
                      const on = s.divisions.includes(d.key);
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() =>
                            patch(s.uid, {
                              divisions: on
                                ? s.divisions.filter((k) => k !== d.key)
                                : [...s.divisions, d.key],
                            })
                          }
                          className={
                            on
                              ? "rounded-full border border-blue-600 bg-blue-600 px-2.5 py-1 font-semibold text-white"
                              : "rounded-full border border-slate-300 px-2.5 py-1 text-slate-600 hover:bg-slate-50"
                          }
                        >
                          {d.label}
                        </button>
                      );
                    })}
                    {s.divisions.length === 0 && (
                      <span className="font-semibold text-slate-600">
                        every division
                      </span>
                    )}
                  </div>
                )}

                {s.kind === "specs" ? (
                  <div className="space-y-1.5">
                    {s.specs.map((p, pi) => (
                      <div key={pi} className="flex flex-wrap items-center gap-2">
                        <input
                          value={p.label}
                          onChange={(e) => {
                            const next = [...s.specs];
                            next[pi] = { ...p, label: e.target.value };
                            patch(s.uid, { specs: next });
                          }}
                          placeholder="Pitching mound"
                          className={`${input} sm:w-56`}
                        />
                        <input
                          value={p.value}
                          onChange={(e) => {
                            const next = [...s.specs];
                            next[pi] = { ...p, value: e.target.value };
                            patch(s.uid, { specs: next });
                          }}
                          placeholder="35 ft"
                          className={`${input} sm:w-56`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            patch(s.uid, {
                              specs: s.specs.filter((_, k) => k !== pi),
                            })
                          }
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        patch(s.uid, { specs: [...s.specs, { label: "", value: "" }] })
                      }
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Add a line
                    </button>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={s.text}
                      onChange={(e) => patch(s.uid, { text: e.target.value })}
                      rows={Math.min(16, Math.max(3, s.text.split("\n").length + 1))}
                      placeholder="One rule per line."
                      className={`${input} font-mono leading-relaxed`}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      One rule per line. Each line becomes a bullet.
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => addSection("rules")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Add a rules section
            </button>
            <button
              type="button"
              onClick={() => addSection("specs")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Add an at-a-glance box
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save and publish"}
            </button>
            <label
              className="flex items-center gap-2 text-xs text-slate-600"
              title="Moves to today automatically whenever you change the wording. Set it by hand only if a correction should not move the date."
            >
              Updated date shown on the page
              <input
                type="date"
                value={contentUpdated}
                onChange={(e) => {
                  setContentUpdated(e.target.value);
                  setDirty(true);
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
            </label>
            <span className="text-xs text-slate-500">
              {sections.length} sections, {ruleCount} lines
              {dirty ? " · unsaved changes" : ""}
            </span>
          </div>

          {history.length > 0 && (
            <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Undo a change ({history.length} earlier{" "}
                {history.length === 1 ? "version" : "versions"})
              </summary>
              <p className="mt-2 text-xs text-slate-600">
                Every save keeps a copy of what the page looked like before it.
                Loading one fills the form in, and nothing changes on the site
                until you press Save.
              </p>
              <ul className="mt-2 space-y-1">
                {history.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => loadVersion(h)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      Load
                    </button>
                    <span className="text-slate-700">
                      {new Date(h.at).toLocaleString()}
                    </span>
                    <span className="text-slate-500">
                      {Array.isArray(h.data) ? `${h.data.length} sections` : ""}
                      {h.by ? ` · ${h.by}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
