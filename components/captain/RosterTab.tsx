"use client";

// Roster tab — verbatim port of DVSL captain.html `renderRoster` and
// associated handlers (lines 2458–2682).
//
// Renders:
//   • Pending-approval banner (yellow) for self-registered players
//     waiting on captain approval. Approve / Reject buttons.
//   • "+ Add Player" button → reveals an inline form (name, num,
//     position, email, phone). Submit → /api/captain-roster?action=add.
//   • Roster table with columns: # / Name / Pos / Signed-up ✓ /
//     Email / Actions (Edit · Revoke · Remove).
//   • Inline edit form (slides in below the row).
//   • Confirm dialogs for destructive actions.
//
// Server endpoint (/api/captain-roster) handles all writes — /players
// is admin-only at the rules level (firestore.rules:94) so a captain
// can't write directly from the browser. The endpoint enforces team
// scoping (captain of team_a can't touch team_b's players).

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";

interface Player {
  id: string;
  name: string;
  jersey: number | null;
  position: string | null;
  email: string;
  phone: string;
  /** Date of birth (YYYY-MM-DD). PII — captain/admin only, from
   *  _private/contact via the team-roster API; never public. */
  dob: string;
  auth_uid?: string;
  pending_approval?: boolean;
  active?: boolean;
}

interface RosterTabProps {
  leagueId: string;
  teamId: string;
}

export function RosterTab({ leagueId, teamId }: RosterTabProps) {
  const user = useUser();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    if (!user) {
      setLoading(false);
      return;
    }
    // Roster + contact info come through the team-roster API now.
    // Email/phone moved off the public player doc to /_private/contact
    // (PII fix); the API surface gates by admin/captain claim.
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/team-roster?leagueId=${encodeURIComponent(leagueId)}&teamId=${encodeURIComponent(teamId)}`,
        { headers: { authorization: `Bearer ${idToken}` } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        players?: {
          id: string;
          name: string;
          jersey: string;
          position: string;
          email: string;
          phone: string;
          dob: string;
          auth_uid: string | null;
          walk_on: boolean;
        }[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      // We also need pending_approval which lives on the public player
      // doc — fetch in parallel, merge.
      const db = getDb();
      const pubSnap = await getDocs(
        query(
          collection(db, `leagues/${leagueId}/players`),
          where("team_id", "==", teamId),
        ),
      );
      const pendingById = new Map<string, boolean>();
      const activeById = new Map<string, boolean>();
      for (const d of pubSnap.docs) {
        const dat = d.data();
        pendingById.set(d.id, dat.pending_approval === true);
        activeById.set(d.id, dat.active !== false);
      }
      setPlayers(
        (data.players ?? [])
          .map((p) => ({
            id: p.id,
            name: p.name,
            jersey: p.jersey ? Number(p.jersey) : null,
            position: p.position || null,
            email: p.email,
            phone: p.phone,
            dob: p.dob ?? "",
            auth_uid: p.auth_uid ?? undefined,
            pending_approval: pendingById.get(p.id) ?? false,
            active: activeById.get(p.id) ?? true,
          }))
          .sort(
            (a, b) =>
              (a.jersey ?? 999) - (b.jersey ?? 999) ||
              a.name.localeCompare(b.name),
          ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Depend on `user` too — `load()` early-returns when user isn't
    // resolved yet (component mounts before Firebase auth state),
    // and without `user` in the dep array it never re-runs once auth
    // settles. Symptom: empty roster on first paint.
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, teamId, user]);

  async function call(
    action:
      | "add"
      | "update"
      | "remove"
      | "approve"
      | "reject"
      | "revoke",
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!user) return { ok: false, error: "Not signed in" };
    setError(null);
    const idToken = await user.getIdToken();
    const res = await fetch("/api/captain-roster", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ leagueId, action, ...payload }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      return { ok: false, error: data.error ?? "Request failed" };
    }
    return { ok: true };
  }

  async function approve(id: string) {
    setBusyId(id);
    const r = await call("approve", { playerId: id });
    if (!r.ok) setError(r.error ?? "Approve failed");
    await load();
    setBusyId(null);
  }
  async function reject(id: string) {
    if (!confirm("Reject this self-registration?")) return;
    setBusyId(id);
    const r = await call("reject", { playerId: id });
    if (!r.ok) setError(r.error ?? "Reject failed");
    await load();
    setBusyId(null);
  }
  async function remove(id: string, label: string) {
    if (!confirm(`Remove ${label} from the roster?`)) return;
    setBusyId(id);
    const r = await call("remove", { playerId: id });
    if (!r.ok) setError(r.error ?? "Remove failed");
    await load();
    setBusyId(null);
  }
  async function revoke(id: string, label: string) {
    if (
      !confirm(
        `Revoke ${label}'s sign-in? They'll stay on the roster but can re-claim by signing in again.`,
      )
    )
      return;
    setBusyId(id);
    const r = await call("revoke", { playerId: id });
    if (!r.ok) setError(r.error ?? "Revoke failed");
    await load();
    setBusyId(null);
  }

  const pending = players.filter((p) => p.pending_approval);
  const active = players.filter((p) => !p.pending_approval && p.active !== false);
  const signedUpCount = active.filter((p) => p.auth_uid).length;

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Roster</h2>
        <p className="cap-section-sub">Manage your team's players.</p>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      <button
        type="button"
        className="le-cap-btn-primary"
        onClick={() => setShowAddForm((v) => !v)}
        style={{ marginBottom: 14 }}
      >
        + Add Player
      </button>
      {showAddForm && (
        <AddPlayerForm
          onCancel={() => setShowAddForm(false)}
          onSubmit={async (payload) => {
            const r = await call("add", payload);
            if (!r.ok) {
              setError(r.error ?? "Add failed");
              return false;
            }
            setShowAddForm(false);
            await load();
            return true;
          }}
        />
      )}

      {loading ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Loading roster…
        </p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="cap-pending-card">
              <div className="cap-pending-title">
                ⚠ {pending.length} Pending Roster Request
                {pending.length > 1 ? "s" : ""}
              </div>
              <div className="cap-pending-sub">
                These players registered themselves. Approve to add them
                to the roster, or reject to remove.
              </div>
              {pending.map((p) => (
                <div key={p.id} className="cap-pending-row">
                  <div>
                    <div className="cap-pending-name">
                      {p.name}
                      {p.jersey != null ? ` (#${p.jersey})` : ""}
                      {p.position ? ` · ${p.position}` : ""}
                    </div>
                    <div className="cap-pending-meta">
                      {p.email || "no email"}
                      {p.phone ? ` · ${p.phone}` : ""}
                    </div>
                  </div>
                  <div className="cap-pending-actions">
                    <button
                      type="button"
                      className="le-cap-btn-primary"
                      disabled={busyId === p.id}
                      onClick={() => approve(p.id)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="cap-btn-danger"
                      disabled={busyId === p.id}
                      onClick={() => reject(p.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {active.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              No players on the roster yet. Add your first player above.
            </p>
          ) : (
            <>
              <p className="cap-roster-count">
                {active.length} player{active.length === 1 ? "" : "s"} —{" "}
                <strong style={{ color: "#16a34a" }}>
                  {signedUpCount} signed up
                </strong>{" "}
                for the player portal
              </p>
              <div className="cap-roster-tbl-wrap">
                <table className="cap-roster-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Pos</th>
                      <th title="Signed up for the player portal">✓</th>
                      <th className="cap-email-col">Email</th>
                      <th>DOB</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((p) => (
                      <RosterRow
                        key={p.id}
                        player={p}
                        editing={editId === p.id}
                        busy={busyId === p.id}
                        onToggleEdit={() =>
                          setEditId(editId === p.id ? null : p.id)
                        }
                        onSaveEdit={async (payload) => {
                          setBusyId(p.id);
                          const r = await call("update", {
                            playerId: p.id,
                            ...payload,
                          });
                          if (!r.ok) {
                            setError(r.error ?? "Update failed");
                            setBusyId(null);
                            return false;
                          }
                          setEditId(null);
                          await load();
                          setBusyId(null);
                          return true;
                        }}
                        onRemove={() => remove(p.id, p.name)}
                        onRevoke={() => revoke(p.id, p.name)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function AddPlayerForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [num, setNum] = useState("");
  const [pos, setPos] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="cap-inline-form">
      <div className="cap-inline-title">Add Player</div>
      <div className="cap-form-row">
        <div className="cap-form-col">
          <label className="cap-form-lbl">Name</label>
          <input
            type="text"
            className="cap-form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Player name"
          />
        </div>
        <div className="cap-form-col" style={{ maxWidth: 90 }}>
          <label className="cap-form-lbl">#</label>
          <input
            type="number"
            min={0}
            className="cap-form-input"
            value={num}
            onChange={(e) => setNum(e.target.value)}
            placeholder="#"
          />
        </div>
        <div className="cap-form-col">
          <label className="cap-form-lbl">Position</label>
          <input
            type="text"
            className="cap-form-input"
            value={pos}
            onChange={(e) => setPos(e.target.value)}
            placeholder="e.g. SS, 1B, P"
          />
        </div>
      </div>
      <div className="cap-form-row">
        <div className="cap-form-col">
          <label className="cap-form-lbl">Email</label>
          <input
            type="email"
            className="cap-form-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="player@email.com"
          />
        </div>
        <div className="cap-form-col">
          <label className="cap-form-lbl">Phone</label>
          <input
            type="tel"
            className="cap-form-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-0100"
          />
        </div>
        <div className="cap-form-col" style={{ maxWidth: 170 }}>
          <label className="cap-form-lbl">Date of birth</label>
          <input
            type="date"
            className="cap-form-input"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
        </div>
      </div>
      <div className="cap-form-actions">
        <button
          type="button"
          className="le-cap-btn-primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const ok = await onSubmit({
              name,
              num,
              pos,
              email,
              phone,
              dob,
            });
            setBusy(false);
            if (ok) {
              setName("");
              setNum("");
              setPos("");
              setEmail("");
              setPhone("");
              setDob("");
            }
          }}
        >
          {busy ? "Adding…" : "Add Player"}
        </button>
        <button
          type="button"
          className="le-cap-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RosterRow({
  player,
  editing,
  busy,
  onToggleEdit,
  onSaveEdit,
  onRemove,
  onRevoke,
}: {
  player: Player;
  editing: boolean;
  busy: boolean;
  onToggleEdit: () => void;
  onSaveEdit: (
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
  onRemove: () => void;
  onRevoke: () => void;
}) {
  const [name, setName] = useState(player.name);
  const [num, setNum] = useState(
    player.jersey != null ? String(player.jersey) : "",
  );
  const [pos, setPos] = useState(player.position ?? "");
  const [email, setEmail] = useState(player.email);
  const [phone, setPhone] = useState(player.phone);
  const [dob, setDob] = useState(player.dob ?? "");

  return (
    <>
      <tr>
        <td className="cap-roster-num">{player.jersey ?? "-"}</td>
        <td>
          <strong>{player.name}</strong>
        </td>
        <td>{player.position ?? "-"}</td>
        <td className="cap-roster-claimed">
          {player.auth_uid ? (
            <span title="Signed up" style={{ color: "#16a34a" }}>
              ✓
            </span>
          ) : (
            <span style={{ color: "rgba(0,0,0,0.3)" }}>—</span>
          )}
        </td>
        <td className="cap-email-col cap-roster-email">
          {player.email ? (
            <a href={`mailto:${player.email}`}>{player.email}</a>
          ) : (
            <span style={{ color: "rgba(0,0,0,0.3)" }}>—</span>
          )}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {player.dob ? (
            fmtDob(player.dob)
          ) : (
            <span style={{ color: "rgba(0,0,0,0.3)" }}>—</span>
          )}
        </td>
        <td className="cap-roster-actions">
          <button
            type="button"
            className="le-cap-btn-secondary"
            onClick={onToggleEdit}
          >
            {editing ? "Close" : "Edit"}
          </button>
          {player.auth_uid && (
            <button
              type="button"
              className="cap-btn-warn"
              onClick={onRevoke}
              disabled={busy}
              title="Revoke this player's sign-in access"
            >
              Revoke
            </button>
          )}
          <button
            type="button"
            className="cap-btn-danger"
            onClick={onRemove}
            disabled={busy}
          >
            ✕
          </button>
        </td>
      </tr>
      {editing && (
        <tr className="cap-roster-edit-row">
          <td colSpan={7}>
            <div className="cap-inline-form" style={{ margin: 0 }}>
              <div className="cap-form-row">
                <div className="cap-form-col">
                  <label className="cap-form-lbl">Name</label>
                  <input
                    type="text"
                    className="cap-form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="cap-form-col" style={{ maxWidth: 90 }}>
                  <label className="cap-form-lbl">#</label>
                  <input
                    type="number"
                    min={0}
                    className="cap-form-input"
                    value={num}
                    onChange={(e) => setNum(e.target.value)}
                  />
                </div>
                <div className="cap-form-col">
                  <label className="cap-form-lbl">Position</label>
                  <input
                    type="text"
                    className="cap-form-input"
                    value={pos}
                    onChange={(e) => setPos(e.target.value)}
                  />
                </div>
              </div>
              <div className="cap-form-row">
                <div className="cap-form-col">
                  <label className="cap-form-lbl">Email</label>
                  <input
                    type="email"
                    className="cap-form-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="cap-form-col">
                  <label className="cap-form-lbl">Phone</label>
                  <input
                    type="tel"
                    className="cap-form-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="cap-form-col" style={{ maxWidth: 170 }}>
                  <label className="cap-form-lbl">Date of birth</label>
                  <input
                    type="date"
                    className="cap-form-input"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>
              </div>
              <div className="cap-form-actions">
                <button
                  type="button"
                  className="le-cap-btn-primary"
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    onSaveEdit({ name, num, pos, email, phone, dob })
                  }
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="le-cap-btn-secondary"
                  onClick={onToggleEdit}
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// "1992-05-11" → "May 11, 1992". Parsed at local noon so the
// calendar day never shifts (same date-only TZ trap as audit H1).
// Non-date-shaped input echoes back unchanged.
function fmtDob(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
