"use client";

// "Your league fee" — shown on a coach's My Team tab when their team still
// owes the league, with a pay-by-card button.
//
// Adam, 2026-08-12. Card payment used to exist ONLY on the success screen
// straight after registering: pick Venmo, close the tab, and there was no way
// back. The office could mint a link from the Payments tab, but that put Doug
// in the middle of every coach who changed their mind.
//
// Renders NOTHING when the team has paid, or has no fee on file, so a coach
// who is square with the league never sees a payment prompt.

import { useEffect, useState } from "react";
import { useUser } from "@/lib/auth-client";

interface Props {
  leagueId: string;
}

interface Fee {
  owes?: boolean;
  due?: number;
  paid?: number;
  canPayByCard?: boolean;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function LeagueFeeCard({ leagueId }: Props) {
  const user = useUser();
  const [fee, setFee] = useState<Fee | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    // useUser() is undefined for the first render while auth resolves; without
    // this guard the fetch throws once and never retries.
    if (!user) return;
    let dead = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/captain-fee?leagueId=${encodeURIComponent(leagueId)}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        const j = (await res.json()) as Fee;
        if (!dead) setFee(j);
      } catch {
        /* silent: a fee card that fails to load should not break My Team */
      }
    })();
    return () => {
      dead = true;
    };
  }, [leagueId, user]);

  async function pay() {
    if (!user) return;
    setBusy(true);
    setErr("");
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/captain-fee", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId }),
      });
      const j = (await res.json()) as { url?: string; error?: string };
      if (j.url) {
        // Square's hosted page. Same tab: the coach is mid-task and a popup
        // would be blocked on most phones.
        window.location.href = j.url;
        return;
      }
      setErr(j.error ?? "Couldn't start card payment.");
    } catch {
      setErr("Couldn't start card payment. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  if (!fee?.owes) return null;

  return (
    <div
      style={{
        border: "1px solid #fecaca",
        background: "#fef2f2",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 18,
      }}
    >
      <p style={{ margin: 0, fontWeight: 800, color: "#991b1b", fontSize: 15 }}>
        League fee due: {money(Number(fee.due ?? 0))}
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7f1d1d" }}>
        You can pay by card here, or send Venmo or a check to the league office.
        Card payments add a 3.25% processing fee.
      </p>

      {err && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>
          {err}
        </p>
      )}

      {fee.canPayByCard && (
        <button
          type="button"
          onClick={pay}
          disabled={busy}
          className="le-cap-btn-primary"
          style={{
            marginTop: 12,
            padding: "10px 20px",
            borderRadius: 8,
            border: 0,
            fontWeight: 700,
            fontSize: 14,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Opening…" : "Pay by card"}
        </button>
      )}
    </div>
  );
}
