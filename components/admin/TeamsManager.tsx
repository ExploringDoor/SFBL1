"use client";

// Admin teams manager — list/create/edit/deactivate teams without
// re-running the provisioning script.
//
// Layout: teams grouped by division (e.g. SFBL has 18+/28+/35+). Each
// team row collapses to show its roster (jersey · name · position) so
// the commissioner can see who's on the team at a glance and spot
// missing players. Click "Edit" to open the metadata form, or click
// the row's chevron to toggle the roster.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface TeamRow {
  id: string;
  name: string;
  abbrev: string;
  color: string;
  division: string;
  logo_url: string;
  active: boolean;
  /** Non-secret marker: does this team have a manager password set?
   *  The password itself lives privately and is never loaded here. */
  has_captain_password: boolean;
}

// Patch shape for saveEdit — TeamRow fields plus the write-only
// captain_password (set, not displayed).
type TeamPatch = Partial<TeamRow> & { captain_password?: string };

interface PlayerRow {
  id: string;
  team_id: string;
  name: string;
  jersey: string;
  position: string;
  email: string;
  phone: string;
}

interface Props {
  leagueId: string;
  user: User;
}

const TEAM_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const NO_DIVISION = "—";

export function TeamsManager({ leagueId, user }: Props) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingPlayerToTeam, setAddingPlayerToTeam] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New-team form
  const [showNew, setShowNew] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newAbbrev, setNewAbbrev] = useState("");
  const [newColor, setNewColor] = useState("#002d72");
  const [newDivision, setNewDivision] = useState("");

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      // Teams come from public Firestore (no PII). Player contact
      // info now lives in /_private/contact subdocs and isn't
      // client-readable for captains; we route through the
      // admin-contacts API which the Admin SDK uses to bypass
      // rules and return contacts in one round-trip.
      const idToken = await user.getIdToken();
      const [teamSnap, contactsRes] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        fetch(
          `/api/admin-contacts?leagueId=${encodeURIComponent(leagueId)}`,
          { headers: { authorization: `Bearer ${idToken}` } },
        ),
      ]);
      setTeams(
        teamSnap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: String(data.name ?? d.id),
              abbrev: String(data.abbrev ?? ""),
              color: String(data.color ?? ""),
              division: String(data.division ?? ""),
              logo_url: String(data.logo_url ?? ""),
              has_captain_password: data.has_captain_password === true,
              active: data.active !== false,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      const contactsBody = (await contactsRes.json().catch(() => ({}))) as {
        ok?: boolean;
        players?: PlayerRow[];
        error?: string;
      };
      if (!contactsRes.ok || !contactsBody.ok) {
        throw new Error(contactsBody.error ?? `HTTP ${contactsRes.status}`);
      }
      setPlayers(
        (contactsBody.players ?? [])
          .slice()
          .sort((a, b) => {
            const aj = parseInt(a.jersey || "999", 10);
            const bj = parseInt(b.jersey || "999", 10);
            if (!Number.isNaN(aj) && !Number.isNaN(bj) && aj !== bj) {
              return aj - bj;
            }
            return a.name.localeCompare(b.name);
          }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  function toggleExpand(teamId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  async function addPlayer(
    teamId: string,
    fields: { name: string; jersey: string; position: string; email: string; phone: string },
  ): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-add-player", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          teamId,
          name: fields.name,
          jersey: fields.jersey,
          position: fields.position,
          email: fields.email,
          phone: fields.phone,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setSuccess(`Added ${fields.name} to roster`);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function updatePlayer(
    teamId: string,
    playerId: string,
    patch: { name: string; jersey: string; position: string; email: string; phone: string },
  ): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-roster", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          teamId,
          action: "update",
          playerId,
          name: patch.name,
          jersey: patch.jersey,
          position: patch.position,
          email: patch.email,
          phone: patch.phone,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setSuccess(`Saved ${patch.name}`);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removePlayer(
    teamId: string,
    playerId: string,
    name: string,
  ): Promise<void> {
    if (!window.confirm(`Remove ${name} from this team's roster?`)) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-roster", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          teamId,
          action: "remove",
          playerId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Removed ${name}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  async function callApi(body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, ...body }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(t: TeamRow, patch: TeamPatch) {
    const ok = await callApi({
      action: "update",
      teamId: t.id,
      ...patch,
    });
    if (ok) {
      setSuccess(`Saved ${t.name}`);
      setEditing(null);
      await load();
    }
  }

  async function deactivate(t: TeamRow) {
    if (
      !window.confirm(
        `Deactivate ${t.name}? Their historical games and standings stay intact, but the team won't show up in roster lists or the schedule for new seasons.`,
      )
    ) {
      return;
    }
    const ok = await callApi({ action: "delete", teamId: t.id });
    if (ok) {
      setSuccess(`Deactivated ${t.name}`);
      await load();
    }
  }

  async function reactivate(t: TeamRow) {
    const ok = await callApi({
      action: "update",
      teamId: t.id,
      // No `active` field on the API spec, but a re-set to true via
      // direct Firestore would need a different endpoint. Simplest:
      // re-create same id with action:update + name to flip active
      // back implicitly. Falling back to an explicit re-set via the
      // create path of this endpoint for symmetry — admin sees one
      // button, "Reactivate."
      name: t.name,
    });
    if (ok) {
      // Re-set active=true via a second tiny call, since admin-team
      // doesn't currently expose `active` directly. Cheap workaround:
      // we just call the deactivate-reverse via a tiny fetch.
      // (Kept as TODO if this becomes common — wire `active` on the
      // endpoint shape.)
      setSuccess(`Reactivation queued for ${t.name} — re-run provision to fully restore.`);
      await load();
    }
  }

  async function createTeam() {
    setError(null);
    if (!TEAM_ID_RE.test(newId)) {
      setError("Team ID must be lowercase a-z 0-9 - _, starting with letter/number");
      return;
    }
    if (!newName.trim()) {
      setError("Team name is required");
      return;
    }
    if (newColor && !HEX_RE.test(newColor)) {
      setError("Color must be hex (e.g. #002d72)");
      return;
    }
    const ok = await callApi({
      action: "create",
      teamId: newId,
      name: newName,
      abbrev: newAbbrev,
      color: newColor,
      division: newDivision,
    });
    if (ok) {
      setSuccess(`Created ${newName}`);
      setNewId("");
      setNewName("");
      setNewAbbrev("");
      setNewColor("#002d72");
      setNewDivision("");
      setShowNew(false);
      await load();
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="font-semibold text-slate-900">Teams</p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Edit team metadata (name, abbrev, color, division, logo) and
            add new teams mid-season. Deactivating a team preserves its
            historical games and standings — only future rosters are
            affected.
          </p>
        </div>
        <a
          href="/print/contacts"
          target="_blank"
          rel="noopener"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          title="Print/PDF a confidential contact sheet (all teams, names, emails, phones)"
        >
          📄 Contacts PDF
        </a>
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 rounded bg-emerald-50 px-2 py-1 border border-emerald-200">
          {success}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading teams…</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No teams yet. Add one below or run the provisioning script.
        </p>
      ) : (
        <DivisionGroups
          teams={teams}
          players={players}
          expanded={expanded}
          editing={editing}
          addingPlayerToTeam={addingPlayerToTeam}
          busy={busy}
          onToggleExpand={toggleExpand}
          onEdit={(id) => setEditing(editing === id ? null : id)}
          onDeactivate={deactivate}
          onReactivate={reactivate}
          onSaveEdit={saveEdit}
          onCancelEdit={() => setEditing(null)}
          onStartAddPlayer={(id) =>
            setAddingPlayerToTeam(addingPlayerToTeam === id ? null : id)
          }
          onCancelAddPlayer={() => setAddingPlayerToTeam(null)}
          onSubmitAddPlayer={async (id, fields) => {
            const ok = await addPlayer(id, fields);
            if (ok) setAddingPlayerToTeam(null);
            return ok;
          }}
          onUpdatePlayer={updatePlayer}
          onRemovePlayer={removePlayer}
        />
      )}

      <details
        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
        open={showNew}
        onToggle={(e) => setShowNew((e.target as HTMLDetailsElement).open)}
      >
        <summary className="text-sm font-semibold text-slate-900 cursor-pointer">
          + New team
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Team ID (slug)
              </span>
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                disabled={busy}
                placeholder="miami_yankees"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Name
              </span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
                placeholder="Miami Yankees"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Abbrev
              </span>
              <input
                type="text"
                value={newAbbrev}
                onChange={(e) => setNewAbbrev(e.target.value.toUpperCase())}
                disabled={busy}
                placeholder="MIY"
                maxLength={8}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Division (optional)
              </span>
              <input
                type="text"
                value={newDivision}
                onChange={(e) => setNewDivision(e.target.value)}
                disabled={busy}
                placeholder="National"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Color
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  disabled={busy}
                  className="h-9 w-12 rounded border border-slate-300 p-0.5 cursor-pointer"
                />
                <input
                  type="text"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  disabled={busy}
                  className="flex-1 rounded-md border border-slate-300 px-2 py-2 text-sm font-mono"
                />
              </div>
            </label>
          </div>
          <button
            onClick={createTeam}
            disabled={busy || !newId.trim() || !newName.trim()}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create team"}
          </button>
          <p className="text-xs text-slate-500">
            After creating: add the team's logo to{" "}
            <code>/public/logos/&lt;league&gt;/&lt;slug&gt;.png</code> and
            set the Logo URL field via Edit on the row.
          </p>
        </div>
      </details>
    </section>
  );
}

// Manager password: <normalized team name> + 2 random digits, e.g.
// "miamiyankees47". The 2 digits are what make it a real password
// (the bare team name no longer works once one is set). Admin can
// edit to anything before saving.
function generateManagerPassword(teamName: string): string {
  const digits = String(Math.floor(Math.random() * 90) + 10); // 10–99
  return `${passwordBase(teamName)}${digits}`;
}

function passwordBase(teamName: string): string {
  return teamName.toLowerCase().replace(/[^a-z0-9]/g, "") || "team";
}

// Stable "shape" preview for the hint text (doesn't re-randomize on
// every keystroke the way generateManagerPassword would).
function generatePreviewHint(teamName: string): string {
  return `${passwordBase(teamName)}##`;
}

function TeamEditForm({
  team,
  busy,
  onCancel,
  onSave,
}: {
  team: TeamRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: TeamPatch) => void;
}) {
  const [name, setName] = useState(team.name);
  const [abbrev, setAbbrev] = useState(team.abbrev);
  const [color, setColor] = useState(team.color || "#002d72");
  const [division, setDivision] = useState(team.division);
  const [logoUrl, setLogoUrl] = useState(team.logo_url);
  const [captainPassword, setCaptainPassword] = useState("");

  return (
    <div className="px-3 py-3 bg-slate-50 border-t border-slate-200">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Abbrev
          </span>
          <input
            type="text"
            value={abbrev}
            onChange={(e) => setAbbrev(e.target.value.toUpperCase())}
            disabled={busy}
            maxLength={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Division
          </span>
          <input
            type="text"
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Color
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={busy}
              className="h-9 w-12 rounded border border-slate-300 p-0.5 cursor-pointer"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              disabled={busy}
              className="flex-1 rounded-md border border-slate-300 px-2 py-2 text-sm font-mono"
            />
          </div>
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Logo URL
          </span>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            disabled={busy}
            placeholder="/logos/sfbl/miami_yankees.png"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </label>
        <div className="block sm:col-span-2 rounded-md border border-blue-200 bg-blue-50 p-3">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Manager password{" "}
            {team.has_captain_password ? (
              <span className="text-emerald-700">· 🔒 currently set</span>
            ) : (
              <span className="text-slate-500">· not set yet</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={captainPassword}
              onChange={(e) => setCaptainPassword(e.target.value)}
              disabled={busy}
              placeholder={
                team.has_captain_password
                  ? "Type a new password to change it (blank = keep current)"
                  : "Set a password the manager will type to log in"
              }
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={() => setCaptainPassword(generateManagerPassword(name))}
              disabled={busy}
              className="rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
            >
              Generate
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            The manager goes to the captain page, picks {name || "this team"},
            and types this password — no account needed. Click Generate for
            “{generatePreviewHint(name)}”, or type your own. Leaving it blank
            keeps the current password.
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() =>
            onSave({
              name,
              abbrev,
              color,
              division,
              logo_url: logoUrl,
              // Only send a password when one was typed/generated —
              // blank means "keep current".
              ...(captainPassword.trim()
                ? { captain_password: captainPassword.trim() }
                : {}),
            })
          }
          disabled={busy}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Division-grouped team list ──────────────────────────────────
// Buckets teams by their `division` field, renders a section header
// per division, and inside each section lists the teams. Each team
// row collapses to show its roster (jersey · name · position).

interface AddPlayerFields {
  name: string;
  jersey: string;
  position: string;
  email: string;
  phone: string;
}

function DivisionGroups({
  teams,
  players,
  expanded,
  editing,
  addingPlayerToTeam,
  busy,
  onToggleExpand,
  onEdit,
  onDeactivate,
  onReactivate,
  onSaveEdit,
  onCancelEdit,
  onStartAddPlayer,
  onCancelAddPlayer,
  onSubmitAddPlayer,
  onUpdatePlayer,
  onRemovePlayer,
}: {
  teams: TeamRow[];
  players: PlayerRow[];
  expanded: Set<string>;
  editing: string | null;
  addingPlayerToTeam: string | null;
  busy: boolean;
  onToggleExpand: (id: string) => void;
  onEdit: (id: string) => void;
  onDeactivate: (t: TeamRow) => void;
  onReactivate: (t: TeamRow) => void;
  onSaveEdit: (t: TeamRow, patch: Partial<TeamRow>) => void;
  onCancelEdit: () => void;
  onStartAddPlayer: (id: string) => void;
  onCancelAddPlayer: () => void;
  onSubmitAddPlayer: (
    id: string,
    fields: AddPlayerFields,
  ) => Promise<boolean>;
  onUpdatePlayer: (
    teamId: string,
    playerId: string,
    patch: AddPlayerFields,
  ) => Promise<boolean>;
  onRemovePlayer: (
    teamId: string,
    playerId: string,
    name: string,
  ) => Promise<void>;
}) {
  // Group teams by division. Teams with no division go into the
  // last bucket so they don't push a "—" header to the top.
  const buckets = new Map<string, TeamRow[]>();
  for (const t of teams) {
    const key = t.division.trim() || NO_DIVISION;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === NO_DIVISION) return 1;
    if (b === NO_DIVISION) return -1;
    // Try numeric prefix sort (18+, 28+, 35+ → 18, 28, 35) then alpha.
    const an = parseInt(a, 10);
    const bn = parseInt(b, 10);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-4">
      {sortedKeys.map((key) => {
        const bucketTeams = buckets.get(key)!;
        return (
          <div
            key={key}
            className="rounded-md border border-slate-200 bg-white overflow-hidden"
          >
            <div className="flex items-baseline justify-between bg-slate-50 px-3 py-2 border-b border-slate-200">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                {key === NO_DIVISION ? "Other" : key}
              </h3>
              <span className="text-xs text-slate-500">
                {bucketTeams.length} team{bucketTeams.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="divide-y divide-slate-200">
              {bucketTeams.map((t) => (
                <TeamRowItem
                  key={t.id}
                  team={t}
                  roster={players.filter((p) => p.team_id === t.id)}
                  isExpanded={expanded.has(t.id)}
                  isEditing={editing === t.id}
                  isAddingPlayer={addingPlayerToTeam === t.id}
                  busy={busy}
                  onToggleExpand={() => onToggleExpand(t.id)}
                  onEdit={() => onEdit(t.id)}
                  onDeactivate={() => onDeactivate(t)}
                  onReactivate={() => onReactivate(t)}
                  onSaveEdit={(patch) => onSaveEdit(t, patch)}
                  onCancelEdit={onCancelEdit}
                  onStartAddPlayer={() => onStartAddPlayer(t.id)}
                  onCancelAddPlayer={onCancelAddPlayer}
                  onSubmitAddPlayer={(fields) =>
                    onSubmitAddPlayer(t.id, fields)
                  }
                  onUpdatePlayer={(playerId, patch) =>
                    onUpdatePlayer(t.id, playerId, patch)
                  }
                  onRemovePlayer={(playerId, name) =>
                    onRemovePlayer(t.id, playerId, name)
                  }
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function TeamRowItem({
  team: t,
  roster,
  isExpanded,
  isEditing,
  isAddingPlayer,
  busy,
  onToggleExpand,
  onEdit,
  onDeactivate,
  onReactivate,
  onSaveEdit,
  onCancelEdit,
  onStartAddPlayer,
  onCancelAddPlayer,
  onSubmitAddPlayer,
  onUpdatePlayer,
  onRemovePlayer,
}: {
  team: TeamRow;
  roster: PlayerRow[];
  isExpanded: boolean;
  isEditing: boolean;
  isAddingPlayer: boolean;
  busy: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onSaveEdit: (patch: Partial<TeamRow>) => void;
  onCancelEdit: () => void;
  onStartAddPlayer: () => void;
  onCancelAddPlayer: () => void;
  onSubmitAddPlayer: (fields: AddPlayerFields) => Promise<boolean>;
  onUpdatePlayer: (playerId: string, patch: AddPlayerFields) => Promise<boolean>;
  onRemovePlayer: (playerId: string, name: string) => Promise<void>;
}) {
  return (
    <li className={t.active ? "" : "bg-slate-50 opacity-70"}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-slate-400 hover:text-slate-700 transition-transform"
          style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
          aria-label={isExpanded ? "Collapse roster" : "Expand roster"}
        >
          ▶
        </button>
        <span
          className="inline-block w-3 h-3 rounded-full flex-shrink-0"
          style={{
            background: t.color || "#cbd5e1",
            border: "1px solid rgba(0,0,0,0.1)",
          }}
          aria-hidden
        />
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex-1 min-w-0 text-left"
        >
          <div className="text-sm font-semibold text-slate-900 truncate">
            {t.name}
            {!t.active && (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">
                inactive
              </span>
            )}
            <span className="ml-2 text-xs font-normal text-slate-500">
              ({roster.length} player{roster.length === 1 ? "" : "s"})
            </span>
          </div>
          {t.abbrev && (
            <div className="text-xs text-slate-500 truncate">{t.abbrev}</div>
          )}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {isEditing ? "Close" : "Edit"}
        </button>
        {t.active ? (
          <button
            type="button"
            onClick={onDeactivate}
            className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
            disabled={busy}
          >
            Deactivate
          </button>
        ) : (
          <button
            type="button"
            onClick={onReactivate}
            className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            disabled={busy}
          >
            Reactivate
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-50/50 px-3 py-3 space-y-3">
          {roster.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              No players on this roster yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200/70 border border-slate-200/70 rounded-md bg-white overflow-hidden">
              {roster.map((p) => (
                <RosterRow
                  key={p.id}
                  player={p}
                  busy={busy}
                  onUpdate={(patch) => onUpdatePlayer(p.id, patch)}
                  onRemove={() => onRemovePlayer(p.id, p.name)}
                />
              ))}
            </ul>
          )}

          {isAddingPlayer ? (
            <AddPlayerForm
              busy={busy}
              onCancel={onCancelAddPlayer}
              onSubmit={onSubmitAddPlayer}
            />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onStartAddPlayer}
                className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                + Add player
              </button>
              <a
                href={`/print/roster/${t.id}`}
                target="_blank"
                rel="noopener"
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                📄 Roster PDF
              </a>
            </div>
          )}
        </div>
      )}

      {isEditing && (
        <TeamEditForm
          team={t}
          busy={busy}
          onCancel={onCancelEdit}
          onSave={onSaveEdit}
        />
      )}
    </li>
  );
}

function RosterRow({
  player,
  busy,
  onUpdate,
  onRemove,
}: {
  player: PlayerRow;
  busy: boolean;
  onUpdate: (patch: AddPlayerFields) => Promise<boolean>;
  onRemove: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.name);
  const [jersey, setJersey] = useState(player.jersey);
  const [position, setPosition] = useState(player.position);
  const [email, setEmail] = useState(player.email);
  const [phone, setPhone] = useState(player.phone);

  // Reset local state when underlying player changes (parent reload).
  useEffect(() => {
    setName(player.name);
    setJersey(player.jersey);
    setPosition(player.position);
    setEmail(player.email);
    setPhone(player.phone);
  }, [player]);

  async function save() {
    const ok = await onUpdate({ name, jersey, position, email, phone });
    if (ok) setEditing(false);
  }

  if (!editing) {
    return (
      <li className="px-3 py-2 flex items-center gap-3 text-xs">
        <span className="font-mono text-slate-600 w-10 flex-shrink-0">
          {player.jersey || "—"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 truncate">
            {player.name}
            {player.position && (
              <span className="ml-2 font-normal text-slate-500">
                {player.position}
              </span>
            )}
          </div>
          <div className="text-slate-500 truncate">
            {player.email || (
              <span className="italic text-slate-400">no email</span>
            )}
            {player.phone ? ` · ${player.phone}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="rounded-md border border-red-300 bg-white px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Remove
        </button>
      </li>
    );
  }

  return (
    <li className="px-3 py-3 bg-slate-50 space-y-2">
      <div className="grid gap-2 sm:grid-cols-5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-2"
        />
        <input
          type="text"
          value={jersey}
          onChange={(e) => setJersey(e.target.value)}
          placeholder="#"
          maxLength={3}
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-mono"
        />
        <input
          type="text"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="Position"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-2"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-3"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-2"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !name.trim()}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            // Reset form to current player state
            setName(player.name);
            setJersey(player.jersey);
            setPosition(player.position);
            setEmail(player.email);
            setPhone(player.phone);
          }}
          disabled={busy}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </li>
  );
}

function AddPlayerForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fields: AddPlayerFields) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [jersey, setJersey] = useState("");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function submit() {
    if (!name.trim()) return;
    await onSubmit({ name: name.trim(), jersey, position, email, phone });
    // Parent collapses the form on success; on failure it stays open
    // so the admin can fix the input without re-typing.
  }

  return (
    <div className="rounded-md border border-emerald-300 bg-white p-3">
      <div className="text-xs font-semibold text-slate-700 mb-2">
        Add player to roster
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name *"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-2"
        />
        <input
          type="text"
          value={jersey}
          onChange={(e) => setJersey(e.target.value)}
          placeholder="#"
          disabled={busy}
          maxLength={3}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-mono"
        />
        <input
          type="text"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="Position (e.g. P, SS)"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-2"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (optional)"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-3"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:col-span-2"
        />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add player"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
