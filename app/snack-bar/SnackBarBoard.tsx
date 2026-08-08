"use client";

// The interactive half of the snack-bar board.
//
// Deliberately has no login: parents are not platform users, and putting an
// account between a volunteer and a two-hour shift is how a sign-up board ends
// up empty. Identity is just the name they type, which is also what appears
// publicly (first name + last initial).

import { useMemo, useState } from "react";
import type { Shift } from "@/lib/volunteer-shifts";
import { openSlots } from "@/lib/volunteer-shifts";

export function SnackBarBoard({
  tenantId,
  shifts: initial,
}: {
  tenantId: string;
  shifts: Shift[];
}) {
  const [shifts, setShifts] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of shifts) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shifts]);

  const totalOpen = shifts.reduce((n, s) => n + openSlots(s), 0);

  async function claim(shiftId: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/snack-bar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leagueId: tenantId,
          action: "claim",
          shiftId,
          name,
          email,
          phone,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? "Could not sign up."));
      // Update in place so the board reflects the new claim without a reload.
      setShifts((cur) =>
        cur.map((s) =>
          s.id === shiftId
            ? {
                ...s,
                claims: [
                  ...s.claims,
                  {
                    display_name: String(data.display_name ?? name),
                    claimed_at: new Date().toISOString(),
                  },
                ],
              }
            : s,
        ),
      );
      setDone("You're on the list. Thank you.");
      setOpenId(null);
      setEmail("");
      setPhone("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign up.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="le-sb-count">
        <strong>{totalOpen}</strong> shift{totalOpen === 1 ? "" : "s"} still need
        a volunteer
      </p>

      {error && <p className="le-sb-msg le-sb-err">{error}</p>}
      {done && <p className="le-sb-msg le-sb-ok">{done}</p>}

      {byDate.map(([date, list]) => (
        <section key={date} className="le-sb-day">
          <h2 className="le-sb-date">{prettyDate(date)}</h2>
          <div className="le-sb-grid">
            {list.map((s) => {
              const open = openSlots(s);
              const full = open === 0;
              return (
                <div key={s.id} className={`le-sb-card${full ? " le-sb-full" : ""}`}>
                  <p className="le-sb-time">
                    {s.start}
                    {s.end ? `–${s.end}` : ""}
                  </p>
                  {s.location && <p className="le-sb-loc">{s.location}</p>}
                  {s.note && <p className="le-sb-note">{s.note}</p>}

                  <ul className="le-sb-claims">
                    {s.claims.map((c, i) => (
                      <li key={i}>{c.display_name}</li>
                    ))}
                    {Array.from({ length: open }).map((_, i) => (
                      <li key={`o${i}`} className="le-sb-open">
                        open
                      </li>
                    ))}
                  </ul>

                  {full ? (
                    <p className="le-sb-covered">Covered — thank you</p>
                  ) : openId === s.id ? (
                    <div className="le-sb-form">
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        aria-label="Your name"
                        className="le-sb-input"
                      />
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        type="email"
                        aria-label="Email"
                        className="le-sb-input"
                      />
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Phone (optional)"
                        aria-label="Phone"
                        className="le-sb-input"
                      />
                      <p className="le-sb-privacy">
                        Only your first name and last initial appear here. Your
                        contact details go to the league, not on the website.
                      </p>
                      <div className="le-sb-actions">
                        <button
                          type="button"
                          onClick={() => claim(s.id)}
                          disabled={busy || !name.trim()}
                          className="le-sb-btn le-sb-btn-go"
                        >
                          {busy ? "Signing up…" : "Sign me up"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenId(null)}
                          className="le-sb-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(s.id);
                        setError(null);
                        setDone(null);
                      }}
                      className="le-sb-btn le-sb-btn-go"
                    >
                      Take this shift
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/** "2026-04-18" -> "Saturday, April 18". Built from parts so the day never
 *  shifts backwards in a western timezone. */
function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
