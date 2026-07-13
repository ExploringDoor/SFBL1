"use client";

// Lineup editor — captain picks the batting order via DVSL's tap-to-add
// card grid pattern (~/Desktop/softball-site/captain.html lines 3265–
// 3311). Visual model:
//
//   • A `.lp-grid` of `.lp-card` tiles, one per roster player. Tapping
//     a card toggles inclusion in the lineup.
//   • Selected cards get a `.lp-badge` showing their slot in the order.
//   • A `.lp-strip` below the grid lists the chosen batters in order
//     ("1 #4 Carter, 2 #7 Iglesias, …") so the captain sees the
//     resulting lineup at a glance.
//   • An "Add Custom Player" mini-form lets captains add a sub who's
//     not on the official roster (DVSL's bsAddCustomPlayer).
//
// Persisted to: leagues/{tenantId}/lineups/{`${gameId}_${teamId}`}
// Shape: { team_id, game_id, order: [{ player_id, name, num }], ... }
//
// We store names + jersey numbers on the lineup, not just IDs, so a
// substitute who isn't on the roster still gets recorded for the
// box score (DVSL pattern — captains add walk-ups all the time).

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";
import {
  useCaptainTeam,
  useLeagueRole,
  useUser,
} from "@/lib/auth-client";

interface Player {
  id: string;
  name: string;
  jersey: number | null;
  position: string | null;
}

interface LineupEntry {
  /** Roster player_id, OR null when this is a walk-on sub. */
  player_id: string | null;
  name: string;
  num: string;
}

export default function LineupEditorPage() {
  const params = useSearchParams();
  const gameId = params.get("game");
  const { tenantId, config } = useTenant();
  const captain = captainNoun(config);
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const { teamId, loading: teamLoading } = useCaptainTeam(tenantId);

  const [roster, setRoster] = useState<Player[]>([]);
  const [order, setOrder] = useState<LineupEntry[]>([]);
  const [customName, setCustomName] = useState("");
  const [customNum, setCustomNum] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !teamId || !gameId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const db = getDb();
      const lineupId = `${gameId}_${teamId}`;
      const [rosterSnap, lineupSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, `leagues/${tenantId}/players`),
            where("team_id", "==", teamId),
          ),
        ),
        getDoc(doc(db, `leagues/${tenantId}/lineups/${lineupId}`)),
      ]);
      if (cancelled) return;
      const r: Player[] = rosterSnap.docs
        // Drop orphan / inactive players so the lineup editor only
        // shows real rostered eligible captains. Same filter as the
        // other captain surfaces.
        .filter((p) => {
          const d = p.data();
          if (d.active === false) return false;
          if (d.orphan === true) return false;
          if (d.status && d.status !== "active") return false;
          return true;
        })
        .map((p) => {
          const d = p.data();
          return {
            id: p.id,
            name: String(d.name ?? p.id),
            jersey: d.jersey != null ? Number(d.jersey) : null,
            position: d.position ? String(d.position) : null,
          };
        })
        .sort(
          (a, b) =>
            (a.jersey ?? 999) - (b.jersey ?? 999) ||
            a.name.localeCompare(b.name),
        );
      setRoster(r);
      if (lineupSnap.exists()) {
        const data = lineupSnap.data() ?? {};
        const stored = (data.order ?? []) as Array<{
          player_id?: string;
          name?: string;
          num?: string;
        }>;
        setOrder(
          stored.map((e) => ({
            player_id: e.player_id ?? null,
            name: String(e.name ?? ""),
            num: String(e.num ?? ""),
          })),
        );
      } else {
        setOrder([]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, teamId, gameId]);

  if (!tenantId || !gameId) {
    return (
      <main className="container py-16">
        <p>Missing game id. Open this page from your {captain} dashboard.</p>
      </main>
    );
  }
  if (user === undefined || role === "loading" || teamLoading) {
    return <main className="container py-16">Checking access…</main>;
  }
  if (user === null) {
    return (
      <main className="container py-16">
        <p>You're not signed in.</p>
        <Link href="/login" className="le-cap-btn-primary">
          Sign in
        </Link>
      </main>
    );
  }
  if (role !== "captain" || !teamId) {
    return (
      <main className="container py-16">
        <p>You're not a {captain} in this league.</p>
        <Link href="/captain" className="le-cap-btn-secondary">
          Back to dashboard
        </Link>
      </main>
    );
  }

  // Helpers — toggle a roster player by id, add/remove a custom
  // walk-on, save the lineup. Order array is the source of truth;
  // selection state on cards is derived from it.
  function togglePlayer(p: Player) {
    const idx = order.findIndex((e) => e.player_id === p.id);
    if (idx >= 0) {
      setOrder((cur) => cur.filter((_, i) => i !== idx));
    } else {
      setOrder((cur) => [
        ...cur,
        {
          player_id: p.id,
          name: p.name,
          num: p.jersey != null ? String(p.jersey) : "",
        },
      ]);
    }
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    setOrder((cur) => [
      ...cur,
      { player_id: null, name, num: customNum.trim() },
    ]);
    setCustomName("");
    setCustomNum("");
  }

  function removeAt(i: number) {
    setOrder((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!tenantId || !teamId || !gameId) return;
    setSaving(true);
    setError(null);
    try {
      const db = getDb();
      const id = `${gameId}_${teamId}`;
      await setDoc(doc(db, `leagues/${tenantId}/lineups/${id}`), {
        team_id: teamId,
        game_id: gameId,
        order,
        updated_at: serverTimestamp(),
      });
      setSavedAt(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // Slot index for a roster card — used to render the .lp-badge
  // showing the card's batting order position. -1 = not selected.
  function slotIndex(playerId: string): number {
    return order.findIndex((e) => e.player_id === playerId);
  }

  return (
    <main className="le-cap-shell" style={{ paddingTop: 28 }}>
      <div style={{ padding: "0 28px 18px" }}>
        <Link
          href="/captain"
          className="font-barlow"
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          ← Back to dashboard
        </Link>
        <h1
          className="font-barlow"
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 900,
            textTransform: "uppercase",
            margin: "8px 0 4px",
            lineHeight: 1,
          }}
        >
          Set Lineup
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Tap players below to build your batting order. The number on each
          tile is the batting slot. Walk-ons / subs can be added manually.
        </p>
      </div>

      {loading ? (
        <p style={{ padding: 28 }}>Loading roster…</p>
      ) : (
        <div style={{ padding: "0 28px 36px" }}>
          {/* Tap-to-add roster grid */}
          <h2 className="le-cap-section-title">Roster</h2>
          <div className="lp-grid">
            {roster.map((p) => {
              const slot = slotIndex(p.id);
              const selected = slot >= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={"lp-card" + (selected ? " lp-sel" : "")}
                  onClick={() => togglePlayer(p)}
                >
                  {selected && <span className="lp-badge">{slot + 1}</span>}
                  <span className="lp-cj">
                    {p.jersey != null ? `#${p.jersey}` : ""}
                  </span>
                  <span className="lp-cn">{p.name}</span>
                </button>
              );
            })}
          </div>

          {/* Add walk-on / sub */}
          <div className="lp-add">
            <input
              type="text"
              placeholder="Add player not on roster…"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCustom();
              }}
              className="lp-add-input"
            />
            <input
              type="text"
              placeholder="#"
              value={customNum}
              onChange={(e) => setCustomNum(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCustom();
              }}
              className="lp-add-num"
            />
            <button
              type="button"
              className="le-cap-btn-secondary"
              onClick={addCustom}
              disabled={!customName.trim()}
            >
              + Add
            </button>
          </div>

          {/* Order strip — running summary of the lineup. */}
          <div className="lp-strip">
            {order.length === 0 ? (
              <span className="lp-strip-empty">
                Tap players above to build your batting order
              </span>
            ) : (
              order.map((e, i) => (
                <span key={i} className="lp-chip">
                  <span className="lp-chip-n">{i + 1}</span>
                  {e.num && <span className="lp-chip-num">#{e.num}</span>}
                  <span>{e.name}</span>
                  <button
                    type="button"
                    className="lp-chip-x"
                    onClick={() => removeAt(i)}
                    aria-label="Remove from lineup"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Save */}
          <div className="le-lineup-savebar">
            <button
              type="button"
              className="le-cap-btn-primary"
              onClick={save}
              disabled={saving || order.length === 0}
            >
              {saving ? "Saving…" : "Save Lineup"}
            </button>
            {savedAt && !error && (
              <span
                style={{
                  fontSize: 12,
                  color: "#16a34a",
                  fontWeight: 600,
                }}
              >
                ✓ Saved {savedAt.toLocaleTimeString()}
              </span>
            )}
            {error && (
              <span style={{ fontSize: 12, color: "#dc2626" }}>{error}</span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
