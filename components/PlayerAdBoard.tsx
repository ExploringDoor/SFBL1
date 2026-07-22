"use client";

// The public Player Ads board.
//
// Every ad here has been approved by an admin and carries NO contact details —
// see /api/admin-player-ads, which builds these documents from an explicit
// field allow-list. Answering an ad goes through /api/player-ad-contact, which
// relays a message server-side so neither party's address is published.
//
// Deliberately no "name" on a card. Coach ads identify themselves by TEAM,
// which is already public on the rest of the site. Player ads identify by age
// group, position and town only, because the player is a minor.

import { useMemo, useState } from "react";

export interface PlayerAd {
  id: string;
  /** "coach" = has roster spots, "player" = looking for a team. */
  posted_by?: string;
  age_group?: string;
  position?: string;
  town?: string;
  team_name?: string;
  message?: string;
  created_at?: string;
}

type Filter = "all" | "coach" | "player";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All ads" },
  { key: "coach", label: "Teams seeking players" },
  { key: "player", label: "Players seeking teams" },
];

export function PlayerAdBoard({ ads }: { ads: PlayerAd[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openAd, setOpenAd] = useState<PlayerAd | null>(null);

  const shown = useMemo(
    () => (filter === "all" ? ads : ads.filter((a) => a.posted_by === filter)),
    [ads, filter],
  );

  if (ads.length === 0) {
    return (
      <div
        style={{
          background: "white",
          border: "1px dashed rgba(0,0,0,0.18)",
          borderRadius: 14,
          padding: "28px 22px",
          textAlign: "center",
          color: "var(--muted)",
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>No ads posted yet.</p>
        <p style={{ margin: "6px 0 0", fontSize: 14 }}>
          Post the first one using the form below. Ads appear here once the
          league office approves them.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const active = f.key === filter;
          const n =
            f.key === "all"
              ? ads.length
              : ads.filter((a) => a.posted_by === f.key).length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                border: active
                  ? "1px solid var(--brand-primary, #002d6e)"
                  : "1px solid rgba(0,0,0,0.14)",
                background: active ? "var(--brand-primary, #002d6e)" : "white",
                color: active ? "white" : "var(--text-strong)",
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {f.label} ({n})
            </button>
          );
        })}
      </div>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 14,
        }}
      >
        {shown.map((ad) => {
          const isCoach = ad.posted_by === "coach";
          return (
            <li
              key={ad.id}
              style={{
                background: "white",
                border: "1px solid rgba(0,0,0,0.08)",
                borderTop: `4px solid ${
                  isCoach ? "var(--brand-primary, #002d6e)" : "var(--brand-accent, #35afea)"
                }`,
                borderRadius: 12,
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: isCoach
                    ? "var(--brand-primary, #002d6e)"
                    : "var(--brand-accent, #35afea)",
                }}
              >
                {isCoach ? "Team seeking players" : "Player seeking a team"}
              </div>

              <div
                className="font-display"
                style={{ fontSize: 18, color: "var(--text-strong)", lineHeight: 1.2 }}
              >
                {[ad.age_group, isCoach ? ad.team_name : ad.position]
                  .filter(Boolean)
                  .join(" · ") || "Player ad"}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  !isCoach && ad.position ? null : ad.position,
                  ad.town,
                ]
                  .filter(Boolean)
                  .map((chip) => (
                    <span
                      key={String(chip)}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: "rgba(0,0,0,0.05)",
                        color: "var(--muted)",
                      }}
                    >
                      {chip}
                    </span>
                  ))}
              </div>

              {ad.message && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: "var(--text-body)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {ad.message}
                </p>
              )}

              <button
                type="button"
                onClick={() => setOpenAd(ad)}
                style={{
                  marginTop: "auto",
                  padding: "9px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--brand-primary, #002d6e)",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                Respond to this ad
              </button>
            </li>
          );
        })}
      </ul>

      {openAd && <ContactDialog ad={openAd} onClose={() => setOpenAd(null)} />}
    </>
  );
}

function ContactDialog({ ad, onClose }: { ad: PlayerAd; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/player-ad-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adId: ad.id,
          from_name: name,
          from_email: email,
          message,
          website,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not send that message.");
        setState("idle");
        return;
      }
      if (json.note) setNote(json.note);
      setState("sent");
    } catch {
      setError("Could not send that message.");
      setState("idle");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Respond to this ad"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 14,
          maxWidth: 460,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "22px 22px 18px",
        }}
      >
        {state === "sent" ? (
          <>
            <h2
              className="font-display"
              style={{ margin: "0 0 8px", fontSize: 22, color: "var(--text-strong)" }}
            >
              Message sent
            </h2>
            <p style={{ margin: "0 0 16px", color: "var(--text-body)", fontSize: 14 }}>
              {note ??
                "They will get your message by email and can reply to you directly."}
            </p>
            <button type="button" onClick={onClose} style={btnPrimary}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2
              className="font-display"
              style={{ margin: "0 0 4px", fontSize: 22, color: "var(--text-strong)" }}
            >
              Respond to this ad
            </h2>
            <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: 13 }}>
              We pass your message to whoever posted it. Their contact details
              stay private, and yours are only shared with them.
            </p>

            <label style={label}>
              Your name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={input}
                autoComplete="name"
              />
            </label>
            <label style={label}>
              Your email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={input}
                autoComplete="email"
              />
            </label>
            <label style={label}>
              Message
              <textarea
                required
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{ ...input, resize: "vertical" }}
                placeholder="Tell them about your team or your player."
              />
            </label>

            {/* Honeypot — hidden from people, tempting to bots. */}
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              style={{
                position: "absolute",
                left: "-9999px",
                width: 1,
                height: 1,
                opacity: 0,
              }}
            />

            {error && (
              <p style={{ color: "#b91c1c", fontSize: 13, margin: "0 0 12px" }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={state === "sending"} style={btnPrimary}>
                {state === "sending" ? "Sending…" : "Send message"}
              </button>
              <button type="button" onClick={onClose} style={btnGhost}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 12,
};

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 5,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.16)",
  fontSize: 15,
  fontFamily: "inherit",
  color: "var(--text-strong)",
  textTransform: "none",
  letterSpacing: "normal",
  fontWeight: 400,
};

const btnPrimary: React.CSSProperties = {
  flex: "1 1 auto",
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--brand-primary, #002d6e)",
  color: "white",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "white",
  color: "var(--text-strong)",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};
