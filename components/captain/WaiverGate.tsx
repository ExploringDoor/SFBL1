"use client";

// The waiver, asked where the coach already is.
//
// Mike, 2026-09-10: "make the roster and waiver one form so when they sign the
// roster they're also signing the waiver."
//
// They were two separate things: a living roster in this portal, and a
// one-time signature on a public page nobody went back to. On the day he asked,
// 31 of 37 teams had no waiver on file for the season and 249 players were
// already rostered behind them. So the roster is the door, and the waiver is
// the lock on it. A coach cannot reach the thing they came for without signing,
// which is the only version of "don't forget" that actually works.
//
// Confirmed with Mike the same day: the MANAGER signs for the whole team, not a
// parent per player.
//
// Posts to /api/league-form as kind "team_waiver", the same endpoint the public
// page uses, so the office email, the coach's confirmation and the admin's
// Waivers tab all keep working with no second code path. That route also stamps
// waiver_season on the team, which is what this component reads to decide
// whether to get out of the way.

import { useState } from "react";

export function WaiverGate({
  leagueId,
  teamName,
  season,
  seasonLabel,
  onSigned,
}: {
  leagueId: string;
  teamName: string;
  /** e.g. "fall-2026" — written to the submission and stamped on the team. */
  season: string;
  /** e.g. "Fall 2026" — what the coach reads. */
  seasonLabel: string;
  onSigned: () => void | Promise<void>;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [signature, setSignature] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const ready =
    agreed && first.trim() && last.trim() && email.trim() && signature.trim();

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/league-form", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "team_waiver",
          leagueId,
          team_name: teamName,
          manager_first_name: first.trim(),
          manager_last_name: last.trim(),
          email: email.trim(),
          phone: phone.trim(),
          season,
          signature: signature.trim(),
          signature_date: today,
          agreed_to_waiver: "yes",
          // The timing check flags anything under four seconds as a bot. A
          // coach reading a waiver takes longer than that, but the value is
          // sent so the route is not left guessing at a direct POST.
          form_ms: 10_000,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      await onSigned();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We could not save that. Try again, or tell the league office.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Sign the {seasonLabel} waiver</h2>
        <p className="cap-section-sub">
          One signature covers your whole team. Your roster opens as soon as
          this is done, and you will not be asked again this season.
        </p>
      </div>

      <div className="cap-card" style={{ padding: "14px 16px", marginBottom: 14 }}>
        <p style={{ margin: "0 0 10px", fontWeight: 700 }}>{teamName}</p>
        <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.6 }}>
          As the manager of this team I confirm that every player on our roster,
          and their parent or guardian where the player is under 18, agrees to
          take part in {seasonLabel} play at their own risk. Softball carries a
          risk of injury. I release the league, its officers, its umpires and
          the owners of the fields we play on from liability for injury or loss
          arising from taking part, except where caused by their own gross
          negligence. I confirm I am authorised to sign on behalf of this team.
        </p>
      </div>

      <div className="cap-form-grid">
        <label className="cap-field">
          <span>Your first name</span>
          <input value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="cap-field">
          <span>Your last name</span>
          <input value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="cap-field">
          <span>Your email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="cap-field">
          <span>Your cell</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="cap-field">
          <span>Type your full name as your signature</span>
          <input
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Your full name"
          />
        </label>
        <label className="cap-field">
          <span>Date</span>
          <input value={today} readOnly />
        </label>
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          margin: "12px 0",
          fontSize: 14,
        }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>I have read the above and I agree on behalf of my team.</span>
      </label>

      {error && <div className="cap-error-banner">{error}</div>}

      <button
        type="button"
        className="cap-btn cap-btn-primary"
        disabled={!ready || busy}
        onClick={() => void submit()}
      >
        {busy ? "Saving…" : "Sign and open my roster"}
      </button>
    </div>
  );
}
