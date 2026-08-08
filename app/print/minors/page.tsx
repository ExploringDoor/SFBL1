"use client";

// /print/minors — admin-only minors & parental-consent sheet.
//
// WHY THIS PAGE EXISTS
// Helena's commissioner, verbatim: "We don't have anything flagging it and it
// makes it difficult to keep track of our minors that are playing." Their
// published rule is 15 by December 31 to play at all, and a signed permission
// form for anyone under 18. This is the sheet that answers "who are they, and
// whose form is missing" — printable, because what a volunteer commissioner
// actually wants is a page in a binder at the field.
//
// WHY IT IS A PRINT PAGE AND NOT A PUBLIC TAB
// Nothing about minor status is public. The public player doc is
// world-readable and enumerable, so an age or a flag there would be a
// machine-queryable list of the children in an adult league (see lib/minors.ts
// for the full reasoning). This page is admin-gated and flows through the
// authed /api/admin-contacts endpoint, so an unauthenticated visitor gets the
// gate rather than a half-rendered list of minors.
//
// WHY "NO DOB" LEADS
// On day one almost every player will be "no DOB on file", because rosters are
// imported without birthdates. A screen that opened with "0 minors" would read
// as "nothing to do" when the truth is "nothing is known yet". The unknown
// count is therefore the first thing on the page and the chase list is the
// biggest table.

import { useEffect, useState } from "react";
import { useTenant } from "@/lib/tenant-context";
import { useLeagueRole, useUser } from "@/lib/auth-client";
import { statusLabel, type MinorStatus } from "@/lib/minors";
import "../print.css";
import { PrintToolbar } from "../PrintToolbar";

interface Team {
  id: string;
  name: string;
  division: string;
}

interface Player {
  id: string;
  team_id: string;
  name: string;
  jersey: string;
  minor_status?: MinorStatus;
  age_at_cutoff?: number | null;
  cutoff_date?: string | null;
  needs_consent?: boolean;
  consent_on_file?: boolean;
}

interface MinorsPolicyView {
  age_of_majority: number;
  cutoff: string;
  min_age?: number;
  requires_consent?: boolean;
}

export default function PrintMinorsPage() {
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [policy, setPolicy] = useState<MinorsPolicyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "admin" || !tenantId || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/admin-contacts?leagueId=${encodeURIComponent(tenantId)}`,
          { headers: { authorization: `Bearer ${idToken}` } },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          teams?: Team[];
          players?: Player[];
          minors_policy?: MinorsPolicyView | null;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setTeams(data.teams ?? []);
        setPlayers(data.players ?? []);
        setPolicy(data.minors_policy ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, role, user]);

  if (!tenantId) {
    return (
      <div className="print-page">
        <p>No tenant. Visit on a tenant subdomain.</p>
      </div>
    );
  }
  if (user === undefined || role === "loading") {
    return (
      <div className="print-page">
        <p>Loading…</p>
      </div>
    );
  }
  if (user === null) {
    return (
      <div className="print-page">
        <p>
          You&rsquo;re not signed in. <a href="/login">Sign in</a> as an admin to
          view this sheet.
        </p>
      </div>
    );
  }
  if (role !== "admin") {
    return (
      <div className="print-page">
        <p>Admin only. Your role on this league is {role}.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="print-page">
        <PrintToolbar />
        <p>Error: {error}</p>
      </div>
    );
  }
  if (!teams || !players) {
    return (
      <div className="print-page">
        <p>Loading roster…</p>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="print-page">
        <PrintToolbar />
        <h1>Minors &amp; Consent</h1>
        <p>
          This league has no minor policy configured, so no player can be
          assessed. Set <code>minors</code> on the league config (age of
          majority, cutoff date, and optional minimum age) and this sheet will
          populate.
        </p>
      </div>
    );
  }

  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const teamLabel = (id: string) => {
    const t = teamsById.get(id);
    if (!t) return "— no team —";
    return t.division ? `${t.name} (${t.division})` : t.name;
  };

  const byStatus = (s: MinorStatus) =>
    players
      .filter((p) => (p.minor_status ?? "unknown") === s)
      .sort(
        (a, b) =>
          teamLabel(a.team_id).localeCompare(teamLabel(b.team_id)) ||
          a.name.localeCompare(b.name),
      );

  const underMin = byStatus("under_minimum");
  const minors = byStatus("minor");
  const unknown = byStatus("unknown");
  const adults = byStatus("adult");
  const consentMissing = [...minors, ...underMin].filter(
    (p) => p.needs_consent && !p.consent_on_file,
  );
  const cutoffDate = players.find((p) => p.cutoff_date)?.cutoff_date ?? null;

  const Row = ({ p }: { p: Player }) => (
    <tr>
      <td>{p.name}</td>
      <td className="print-num">{p.jersey || "—"}</td>
      <td>{teamLabel(p.team_id)}</td>
      <td className="print-num">{p.age_at_cutoff ?? "—"}</td>
      <td>
        {p.needs_consent
          ? p.consent_on_file
            ? "On file"
            : "MISSING"
          : "—"}
      </td>
      <td style={{ minWidth: 110 }}></td>
    </tr>
  );

  const Table = ({ rows }: { rows: Player[] }) => (
    <table className="print-table">
      <thead>
        <tr>
          <th>Player</th>
          <th className="print-num">#</th>
          <th>Team</th>
          <th className="print-num">Age</th>
          <th>Consent</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <Row key={p.id} p={p} />
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="print-page">
      <PrintToolbar />
      <h1>Minors &amp; Parental Consent</h1>
      <p className="print-sub">
        {config?.name ?? tenantId} &middot; Confidential &mdash; league officers
        only. Ages are calculated as of{" "}
        <strong>{cutoffDate ?? policy.cutoff}</strong>. A player must be{" "}
        {policy.min_age ?? "—"} by that date to play
        {policy.requires_consent !== false
          ? `, and anyone under ${policy.age_of_majority} needs a signed parental consent form on file`
          : ""}
        . Dates of birth are deliberately not printed.
      </p>

      <table className="print-table" style={{ maxWidth: 520 }}>
        <tbody>
          <tr>
            <td>
              <strong>No date of birth on file</strong>
            </td>
            <td className="print-num">
              <strong>{unknown.length}</strong>
            </td>
            <td>age cannot be confirmed</td>
          </tr>
          <tr>
            <td>Minors (under {policy.age_of_majority})</td>
            <td className="print-num">{minors.length}</td>
            <td>consent form required</td>
          </tr>
          {policy.min_age != null && (
            <tr>
              <td>Below minimum age ({policy.min_age})</td>
              <td className="print-num">{underMin.length}</td>
              <td>not eligible to play</td>
            </tr>
          )}
          <tr>
            <td>Consent forms missing</td>
            <td className="print-num">{consentMissing.length}</td>
            <td>action needed</td>
          </tr>
          <tr>
            <td>Adults</td>
            <td className="print-num">{adults.length}</td>
            <td>no action</td>
          </tr>
        </tbody>
      </table>

      {underMin.length > 0 && (
        <>
          <h2>Below minimum age &mdash; not eligible</h2>
          <p className="print-sub">
            These players are under {policy.min_age} as of {cutoffDate}. Check
            for a mistyped birth year before acting.
          </p>
          <Table rows={underMin} />
        </>
      )}

      {minors.length > 0 && (
        <>
          <h2>Minors ({minors.length})</h2>
          <Table rows={minors} />
        </>
      )}

      <h2>No date of birth on file ({unknown.length})</h2>
      <p className="print-sub">
        These are not confirmed adults &mdash; they are players whose age the
        league does not know. Collect a birth date to clear each one.
      </p>
      {unknown.length > 0 ? (
        <Table rows={unknown} />
      ) : (
        <p>Every active player has a birth date on file.</p>
      )}
    </div>
  );
}
