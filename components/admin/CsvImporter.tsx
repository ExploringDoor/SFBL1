"use client";

// Admin CSV importer.
//
// Per-tenant feature flag: visible only when
// `flags.csv_schedule_import !== false`. SFBL is configured with
// false (their schedule lives in Firestore now and the script-based
// provision flow is fine for emergencies). New tenants in onboarding
// see this front-and-center.
//
// Flow:
//   1. Paste CSV (or upload file)
//   2. "Validate" runs the dryRun pass on the server, returns row
//      counts + any errors. Nothing is written.
//   3. "Import" runs the real write only if validation passed.

import { useState } from "react";
import type { User } from "firebase/auth";

interface Props {
  leagueId: string;
  user: User;
}

interface ValidateResult {
  ok: boolean;
  parsed_count?: number;
  written?: number;
  errors?: { line: number; message: string }[];
  warnings?: string[];
  message?: string;
  sample?: unknown[];
}

const SAMPLE_HEADER = `id,date,time,field,away_team_id,home_team_id,division,status,away_score,home_score`;
const SAMPLE_ROWS = [
  `g-9001,2026-05-15,19:00,Field 1,team_a,team_b,Open,scheduled,,`,
  `g-9002,2026-05-15,19:00,Field 2,team_c,team_d,Open,scheduled,,`,
];

export function CsvImporter({ leagueId, user }: Props) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState<"validate" | "import" | null>(null);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [validated, setValidated] = useState(false);

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") {
        setCsv(r);
        setValidated(false);
        setResult(null);
      }
    };
    reader.readAsText(file);
  }

  async function call(dryRun: boolean) {
    setBusy(dryRun ? "validate" : "import");
    setResult(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-csv-import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          kind: "schedule",
          csv,
          dryRun,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ValidateResult & {
        error?: string;
      };
      if (!res.ok && !data.errors) {
        setResult({
          ok: false,
          message: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setResult(data);
      if (dryRun && data.ok) setValidated(true);
      if (!dryRun && data.ok) {
        // Real write succeeded — clear textarea so a re-paste/re-import
        // is intentional.
        setCsv("");
        setValidated(false);
      }
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
      <div>
        <p className="text-lg font-bold text-slate-900">CSV import</p>
        <p className="text-sm text-slate-600 mt-1">
          Bulk-import a schedule from a spreadsheet. Validate first to
          catch errors before writing — no partial imports.
        </p>
      </div>

      <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="text-sm font-semibold text-slate-700 cursor-pointer">
          Format
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-600">
            First line is the header. Required columns:{" "}
            <code>id, date, away_team_id, home_team_id</code>. Optional:{" "}
            <code>time, field, division, status, away_score, home_score, week</code>.
          </p>
          <pre className="overflow-x-auto rounded bg-white border border-slate-200 p-2 text-[11px] font-mono text-slate-800">
            {SAMPLE_HEADER}
            {"\n"}
            {SAMPLE_ROWS.join("\n")}
          </pre>
          <p className="text-xs text-slate-500">
            <code>date</code> is YYYY-MM-DD. <code>time</code> is 24-hour
            HH:MM. <code>status</code> is scheduled / postponed /
            cancelled / final / approved.{" "}
            <code>team_id</code>s must be lowercase slugs from the Teams
            tab. Leave score columns blank for not-yet-played games.
          </p>
        </div>
      </details>

      <div>
        <label className="block">
          <span className="block text-sm font-semibold text-slate-800 mb-1.5">
            CSV content
          </span>
          <textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setValidated(false);
              setResult(null);
            }}
            disabled={busy != null}
            rows={10}
            placeholder={SAMPLE_HEADER + "\n…"}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
          />
        </label>
        <div className="mt-2 flex items-center gap-3">
          <label className="text-xs text-slate-600 cursor-pointer underline hover:text-slate-900">
            Or upload a .csv file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
              }}
              disabled={busy != null}
              className="hidden"
            />
          </label>
          <span className="text-xs text-slate-500">
            {csv.split(/\r?\n/).filter((l) => l.trim()).length} non-empty
            lines
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={() => call(true)}
          disabled={busy != null || !csv.trim()}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          {busy === "validate" ? "Validating…" : "Validate"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                "Run the import? This will write game docs to Firestore (overwriting any existing rows with the same id).",
              )
            )
              return;
            call(false);
          }}
          disabled={busy != null || !validated}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          title={
            !validated
              ? "Validate first — this button enables once your CSV is clean."
              : ""
          }
        >
          {busy === "import" ? "Importing…" : "Import"}
        </button>
      </div>

      {result && (
        <div
          className={
            "text-sm rounded-md px-3 py-2 " +
            (result.ok
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-800")
          }
        >
          {result.ok ? (
            <>
              ✓{" "}
              {result.written != null
                ? `Imported ${result.written} game${result.written === 1 ? "" : "s"}.`
                : `Validated ${result.parsed_count} row${result.parsed_count === 1 ? "" : "s"}. Click Import to write.`}
              {result.warnings && result.warnings.length > 0 && (
                <ul className="mt-2 ml-4 list-disc text-xs text-amber-800">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="font-semibold">
                ✗ {result.message ?? "Import failed."}
              </div>
              {result.errors && result.errors.length > 0 && (
                <ul className="mt-2 ml-4 list-disc text-xs">
                  {result.errors.map((er, i) => (
                    <li key={i}>
                      Line {er.line}: {er.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
