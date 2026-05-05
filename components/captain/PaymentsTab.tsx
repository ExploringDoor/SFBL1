"use client";

// Payments tab — port of DVSL captain.html `renderPayments` (the
// table of players with paid/unpaid status + a season-fees summary),
// extended to track partial payments. DVSL's checkbox model didn't
// handle "Joe paid me $40 of $100" well — captains kept stuffing it
// into the note field. Now we have first-class fields:
//
//   - amount_paid : how much we've collected so far
//   - amount_due  : what this player owes (defaults from league config;
//                   captain can override per-player for discounts/late fees)
//   - status      : derived — paid (paid≥due), partial (0<paid<due), unpaid
//   - note        : free-text annotation ("Venmo 4/12", "owes $50 cash")
//
// Stored at /leagues/{leagueId}/payments/{playerId}. Captain writes via
// /api/captain-payment so we don't widen rules on the public collection.

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";

interface PlayerPay {
  player_id: string;
  name: string;
  jersey: number | null;
  paid: boolean; // legacy flag, still set for back-compat
  amount_paid: number;
  amount_due: number;
  note: string;
}

interface PaymentsTabProps {
  leagueId: string;
  teamId: string;
}

function deriveStatus(p: PlayerPay): "paid" | "partial" | "unpaid" {
  if (p.amount_due <= 0) {
    // No fee set — fall back to legacy paid flag.
    return p.paid ? "paid" : "unpaid";
  }
  if (p.amount_paid >= p.amount_due) return "paid";
  if (p.amount_paid > 0) return "partial";
  return "unpaid";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
  });
}

export function PaymentsTab({ leagueId, teamId }: PaymentsTabProps) {
  const user = useUser();
  const { config } = useTenant();
  // League-level default fee (captain can override per-player).
  const leagueDefaultDue = Number(
    (config as { season_fee?: number; team_fee?: number } | null)
      ?.season_fee ?? 0,
  );

  const [rows, setRows] = useState<PlayerPay[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const db = getDb();
    const [rosterSnap, paymentsSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, `leagues/${leagueId}/players`),
          where("team_id", "==", teamId),
        ),
      ),
      // Scope to this team only — every payment doc has team_id
      // stamped by /api/captain-payment, so this filter is exact.
      // Saves us from loading all-league payments + filtering in memory.
      getDocs(
        query(
          collection(db, `leagues/${leagueId}/payments`),
          where("team_id", "==", teamId),
        ),
      ),
    ]);
    const payByPlayer = new Map<
      string,
      {
        paid: boolean;
        amount_paid: number;
        amount_due: number | null;
        note: string;
      }
    >();
    for (const d of paymentsSnap.docs) {
      const data = d.data();
      payByPlayer.set(d.id, {
        paid: data.paid === true,
        amount_paid: Number(data.amount_paid ?? 0),
        amount_due:
          data.amount_due === null || data.amount_due === undefined
            ? null
            : Number(data.amount_due),
        note: String(data.note ?? ""),
      });
    }
    setRows(
      rosterSnap.docs
        .map((p) => {
          const data = p.data();
          const pay = payByPlayer.get(p.id);
          return {
            player_id: p.id,
            name: String(data.name ?? p.id),
            jersey: data.jersey != null ? Number(data.jersey) : null,
            paid: pay?.paid ?? false,
            amount_paid: pay?.amount_paid ?? 0,
            amount_due: pay?.amount_due ?? leagueDefaultDue,
            note: pay?.note ?? "",
          };
        })
        .sort(
          (a, b) =>
            (a.jersey ?? 999) - (b.jersey ?? 999) ||
            a.name.localeCompare(b.name),
        ),
    );
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, teamId]);

  async function setPay(
    playerId: string,
    patch: Partial<{
      paid: boolean;
      amount_paid: number;
      amount_due: number;
      note: string;
    }>,
  ) {
    if (!user) return;
    setError(null);
    setBusyId(playerId);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-payment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, playerId, ...patch }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Save failed");
      } else {
        // Optimistic local state update.
        setRows((cur) =>
          cur.map((r) =>
            r.player_id === playerId ? { ...r, ...patch } : r,
          ),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusyId(null);
    }
  }

  // Quick-mark convenience: clicking the status badge toggles paid-in-full
  // by snapping amount_paid to amount_due (or back to 0).
  function toggleFullPaid(r: PlayerPay) {
    const nextPaid = deriveStatus(r) !== "paid";
    setPay(r.player_id, {
      paid: nextPaid,
      amount_paid: nextPaid ? r.amount_due : 0,
    });
  }

  const totalDue = rows.reduce((s, r) => s + r.amount_due, 0);
  const totalPaid = rows.reduce((s, r) => s + r.amount_paid, 0);
  const paidCount = rows.filter((r) => deriveStatus(r) === "paid").length;
  const partialCount = rows.filter(
    (r) => deriveStatus(r) === "partial",
  ).length;
  const outstanding = Math.max(0, totalDue - totalPaid);

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Payments</h2>
        <p className="cap-section-sub">
          Track season fees per player. Enter the actual amount
          collected — partial payments are fine. Default fee:{" "}
          <strong>{fmt(leagueDefaultDue)}</strong> (set in league config).
        </p>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      {loading ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          No players on the roster yet — add players in the Roster
          tab first.
        </p>
      ) : (
        <>
          <div className="cap-pay-summary">
            <div className="cap-pay-stat">
              <span className="cap-pay-stat-num">{fmt(totalPaid)}</span>
              <span className="cap-pay-stat-lbl">Collected</span>
            </div>
            <div className="cap-pay-stat">
              <span className="cap-pay-stat-num">{fmt(outstanding)}</span>
              <span className="cap-pay-stat-lbl">Outstanding</span>
            </div>
            <div className="cap-pay-stat">
              <span className="cap-pay-stat-num">
                {paidCount}/{rows.length}
              </span>
              <span className="cap-pay-stat-lbl">Paid in full</span>
            </div>
            {partialCount > 0 && (
              <div className="cap-pay-stat">
                <span className="cap-pay-stat-num">{partialCount}</span>
                <span className="cap-pay-stat-lbl">Partial</span>
              </div>
            )}
          </div>

          <div className="cap-roster-tbl-wrap">
            <table className="cap-roster-tbl cap-pay-tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th style={{ width: 110 }}>Owes</th>
                  <th style={{ width: 110 }}>Paid</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const status = deriveStatus(r);
                  return (
                    <tr key={r.player_id}>
                      <td className="cap-roster-num">
                        {r.jersey ?? "-"}
                      </td>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>
                        <MoneyInput
                          value={r.amount_due}
                          disabled={busyId === r.player_id}
                          onCommit={(n) =>
                            setPay(r.player_id, { amount_due: n })
                          }
                        />
                      </td>
                      <td>
                        <MoneyInput
                          value={r.amount_paid}
                          disabled={busyId === r.player_id}
                          onCommit={(n) =>
                            setPay(r.player_id, {
                              amount_paid: n,
                              // Keep legacy flag in sync.
                              paid:
                                r.amount_due > 0
                                  ? n >= r.amount_due
                                  : n > 0,
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={
                            "cap-pay-status cap-pay-status-" + status
                          }
                          disabled={busyId === r.player_id}
                          onClick={() => toggleFullPaid(r)}
                          title="Click to toggle paid-in-full"
                        >
                          {status === "paid"
                            ? "Paid"
                            : status === "partial"
                              ? "Partial"
                              : "Unpaid"}
                        </button>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="cap-form-input"
                          value={r.note}
                          placeholder="e.g. Venmo 4/12"
                          disabled={busyId === r.player_id}
                          onBlur={(e) =>
                            e.target.value !== r.note &&
                            setPay(r.player_id, {
                              note: e.target.value,
                            })
                          }
                          onChange={(e) =>
                            setRows((cur) =>
                              cur.map((row) =>
                                row.player_id === r.player_id
                                  ? { ...row, note: e.target.value }
                                  : row,
                              ),
                            )
                          }
                          style={{ minWidth: 140 }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Local money input — committed on blur so we don't fire a network
// call on every keystroke. Renders a "$" prefix for clarity.
function MoneyInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(value === 0 ? "" : String(value));

  // Re-sync when external value changes (e.g. after refresh).
  useEffect(() => {
    setText(value === 0 ? "" : String(value));
  }, [value]);

  return (
    <div className="cap-money-input">
      <span className="cap-money-prefix">$</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        className="cap-form-input"
        value={text}
        disabled={disabled}
        placeholder="0"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = text === "" ? 0 : Number(text);
          if (Number.isFinite(n) && n >= 0 && n !== value) {
            onCommit(n);
          } else if (!Number.isFinite(n) || n < 0) {
            // Bad input — revert.
            setText(value === 0 ? "" : String(value));
          }
        }}
      />
    </div>
  );
}
