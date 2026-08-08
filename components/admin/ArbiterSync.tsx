"use client";

// Arbiter round-trip, for leagues that keep ArbiterSports as their schedule
// master and want the website to follow it rather than replace it.
//
// Flow:
//   1. Paste or upload the Arbiter export.
//   2. "Preview" parses it, matches team names, and audits conflicts. Nothing
//      is written.
//   3. Any team name that could not be matched with certainty is listed with a
//      dropdown. Confirmed mappings are remembered, so this is a one-time job
//      per team rather than a chore on every import.
//   4. "Import" writes. Keyed on the Arbiter game number, so re-importing an
//      updated export UPDATES games instead of duplicating the season.
//
// Conflicts do NOT block the import. Arbiter is upstream and authoritative; if
// it says two games share a field, that is the league's real situation and
// refusing would leave the website empty. They are reported instead, which
// makes this a free audit of the Arbiter schedule.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface TeamOpt {
  id: string;
  name: string;
}

interface Props {
  leagueId: string;
  user: User;
}

interface Conflict {
  kind: string;
  severity: "error" | "warning";
  message: string;
}

interface Unresolved {
  name: string;
  confidence: string;
  candidates: { id: string; name: string }[];
}

interface Preview {
  summary: {
    parsedRows: number;
    importable: number;
    skipped: number;
    unresolvedTeams: number;
    conflicts: number;
    warningConflicts: number;
    newGames: number;
    delimiter: string;
    ignoredColumns: string[];
  };
  unresolved: Unresolved[];
  skipped: { line: number; reason: string }[];
  parseErrors: { line: number; message: string }[];
  parseWarnings: string[];
  conflicts: Conflict[];
  sample: Record<string, unknown>[];
}

const BOX: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 10,
  padding: 14,
  marginTop: 14,
  background: "#fff",
};

export function ArbiterSync({ leagueId, user }: Props) {
  // Teams are loaded here rather than passed in: the admin shell holds no team
  // state, and the only consumer is the unresolved-name dropdown.
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState<"preview" | "import" | "export" | "aliases" | null>(
    null,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(
          collection(getDb(), `leagues/${leagueId}/teams`),
        );
        const rows: TeamOpt[] = [];
        snap.forEach((d) => {
          const t = d.data() as Record<string, unknown>;
          if (t.active === false) return;
          rows.push({ id: d.id, name: String(t.name ?? d.id) });
        });
        setTeams(rows);
      } catch {
        /* dropdowns just stay empty; the rest of the panel still works */
      }
    })();
  }, [leagueId]);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  // Every unresolved name must be mapped (or deliberately left) before the
  // import can be complete; surfaced so the admin knows what will be skipped.
  const stillUnmapped = (preview?.unresolved ?? []).filter(
    (u) => !mapping[u.name],
  ).length;

  async function post(body: Record<string, unknown>) {
    const token = await user.getIdToken();
    const res = await fetch("/api/admin-arbiter", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ leagueId, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`));
    return data;
  }

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCsv(reader.result);
        setPreview(null);
        setDone(null);
      }
    };
    reader.readAsText(file);
  }

  async function run(action: "preview_import" | "commit_import") {
    setBusy(action === "preview_import" ? "preview" : "import");
    setError(null);
    setDone(null);
    try {
      const data = await post({ action, csv, mapping });
      if (action === "preview_import") {
        setPreview(data as unknown as Preview);
      } else {
        setDone(`Imported ${data.imported} games from Arbiter.`);
        setPreview(null);
        setCsv("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveAliases() {
    setBusy("aliases");
    setError(null);
    try {
      const data = await post({ action: "save_aliases", aliases: mapping });
      setDone(`Remembered ${data.saved} team name(s) for next time.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setBusy("export");
    setError(null);
    setDone(null);
    try {
      const data = await post({ action: "export" });
      // Build the download client-side so the file never needs a server route
      // and the browser names it sensibly.
      const blob = new Blob([String(data.csv ?? "")], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = String(data.filename ?? "schedule.csv");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(`Exported ${data.count} games.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginTop: 0 }}>
        Keep Arbiter as your schedule master. Paste an Arbiter export to update
        the website, or export the website&rsquo;s schedule back out in the same
        format. Games are matched on Arbiter&rsquo;s game number, so importing an
        updated export updates the same games instead of creating duplicates.
      </p>

      {/* ── export ───────────────────────────────────────────── */}
      <div style={BOX}>
        <p style={{ fontWeight: 800, margin: "0 0 8px" }}>Send to Arbiter</p>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
          Downloads every game as a CSV with Arbiter&rsquo;s own column names,
          dates and times.
        </p>
        <button type="button" onClick={exportCsv} disabled={busy !== null} style={BTN}>
          {busy === "export" ? "Preparing…" : "Download schedule CSV"}
        </button>
      </div>

      {/* ── import ───────────────────────────────────────────── */}
      <div style={BOX}>
        <p style={{ fontWeight: 800, margin: "0 0 8px" }}>Bring in from Arbiter</p>
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
          }}
          style={{ fontSize: 13, marginBottom: 8, display: "block" }}
        />
        <textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          placeholder={
            "…or paste here. Copying straight out of Excel works too.\n\n" +
            "Game,Date,Time,Site,Away Team,Away Score,Home Team,Home Score\n" +
            "372,13-Apr-26,6:00PM,Fuhrman Park #2,Donegal Green,12,Cedar Crest,2"
          }
          rows={7}
          style={{
            width: "100%",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12.5,
            padding: 10,
            borderRadius: 8,
            border: "1px solid rgba(0,0,0,0.15)",
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => run("preview_import")}
            disabled={busy !== null || !csv.trim()}
            style={BTN}
          >
            {busy === "preview" ? "Checking…" : "Preview"}
          </button>
          {preview && preview.summary.importable > 0 && (
            <button
              type="button"
              onClick={() => run("commit_import")}
              disabled={busy !== null}
              style={{ ...BTN, background: "var(--green,#22c55e)", color: "#fff", border: "none" }}
            >
              {busy === "import"
                ? "Importing…"
                : `Import ${preview.summary.importable} games`}
            </button>
          )}
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {done && <Banner tone="ok">{done}</Banner>}

      {preview && (
        <>
          <div style={BOX}>
            <p style={{ fontWeight: 800, margin: "0 0 8px" }}>What this will do</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
              <li>
                <strong>{preview.summary.parsedRows}</strong> rows read
                {preview.summary.delimiter === "\t" && " (tab-separated)"}
              </li>
              <li>
                <strong>{preview.summary.importable}</strong> games ready ·{" "}
                {preview.summary.newGames} new, the rest update existing games
              </li>
              {preview.summary.skipped > 0 && (
                <li>
                  <strong>{preview.summary.skipped}</strong> rows skipped
                </li>
              )}
              {preview.summary.ignoredColumns.length > 0 && (
                <li style={{ color: "var(--muted)" }}>
                  Columns ignored: {preview.summary.ignoredColumns.join(", ")}
                </li>
              )}
            </ul>
          </div>

          {preview.unresolved.length > 0 && (
            <div style={BOX}>
              <p style={{ fontWeight: 800, margin: "0 0 4px" }}>
                Which team is this? ({stillUnmapped} left)
              </p>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
                These names in the Arbiter file did not match a team here with
                certainty. Nothing is guessed — an unmatched game is skipped
                rather than assigned to the wrong club. Match them once and
                press Remember.
              </p>
              {preview.unresolved.map((u) => (
                <div
                  key={u.name}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                    flexWrap: "wrap",
                  }}
                >
                  <strong style={{ minWidth: 190, fontSize: 13.5 }}>{u.name}</strong>
                  <select
                    value={mapping[u.name] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [u.name]: e.target.value }))
                    }
                    style={{ ...INPUT, minWidth: 240 }}
                  >
                    <option value="">— skip these games —</option>
                    {sortedTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {u.confidence === "ambiguous" && (
                    <span style={{ fontSize: 12, color: "#8a5300" }}>
                      matched {u.candidates.length} teams equally
                    </span>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={saveAliases}
                  disabled={busy !== null || Object.keys(mapping).length === 0}
                  style={BTN}
                >
                  {busy === "aliases" ? "Saving…" : "Remember these names"}
                </button>
                <button
                  type="button"
                  onClick={() => run("preview_import")}
                  disabled={busy !== null}
                  style={BTN}
                >
                  Re-check with these matches
                </button>
              </div>
            </div>
          )}

          {preview.conflicts.length > 0 && (
            <div style={BOX}>
              <p style={{ fontWeight: 800, margin: "0 0 4px" }}>
                Schedule conflicts in the Arbiter file ({preview.summary.conflicts})
              </p>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>
                These do not stop the import — Arbiter is your master schedule,
                so this is what it currently says. Worth fixing there.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.65 }}>
                {preview.conflicts.slice(0, 25).map((c, i) => (
                  <li key={i} style={{ color: c.severity === "error" ? "#7f1d1d" : "#7a4b00" }}>
                    {c.message}
                  </li>
                ))}
              </ul>
              {preview.conflicts.length > 25 && (
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  …and {preview.conflicts.length - 25} more.
                </p>
              )}
            </div>
          )}

          {(preview.parseErrors.length > 0 || preview.skipped.length > 0) && (
            <div style={BOX}>
              <p style={{ fontWeight: 800, margin: "0 0 8px" }}>Rows not imported</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                {preview.parseErrors.slice(0, 15).map((e, i) => (
                  <li key={`e${i}`}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
                {preview.skipped.slice(0, 15).map((s, i) => (
                  <li key={`s${i}`}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const BTN: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 9,
  border: "1px solid rgba(0,0,0,0.18)",
  background: "#fff",
  fontWeight: 700,
  fontSize: 13.5,
  cursor: "pointer",
};

const INPUT: React.CSSProperties = {
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.15)",
  fontSize: 13.5,
  background: "#fff",
};

function Banner({
  tone,
  children,
}: {
  tone: "error" | "ok";
  children: React.ReactNode;
}) {
  const err = tone === "error";
  return (
    <p
      style={{
        marginTop: 12,
        padding: "10px 13px",
        borderRadius: 9,
        fontSize: 13.5,
        background: err ? "rgba(220,38,38,0.08)" : "rgba(34,197,94,0.1)",
        border: `1px solid ${err ? "rgba(220,38,38,0.4)" : "rgba(34,197,94,0.4)"}`,
        color: err ? "#7f1d1d" : "#14532d",
      }}
    >
      {children}
    </p>
  );
}
