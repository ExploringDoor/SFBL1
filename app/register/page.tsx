"use client";

// Public team-registration form. Mirrors COYBL's SportsEngine flow
// (Registration Type → Head Coach → Team Info → acknowledgments) as a
// single scrolling form. Submits to /api/register (server validates +
// writes to the admin-only registrations collection). Payment is handled
// directly (check / electronic) — not processed here.

import { useState } from "react";

const AGE_GROUPS = ["7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U"];

const TYPES = [
  {
    id: "with_insurance",
    fee: 495,
    title: "With Team Insurance",
    blurb:
      "Includes COYBL team insurance and Five Tool Youth registration.",
  },
  {
    id: "without_insurance",
    fee: 425,
    title: "Without Insurance",
    blurb:
      "For teams that carry their own insurance (proof required). Includes Five Tool Youth registration.",
  },
] as const;

const USSSA_FEE = 40;

type State = {
  registration_type: "" | "with_insurance" | "without_insurance";
  coach_name: string;
  coach_email: string;
  coach_phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  team_name: string;
  age_group: string;
  estimated_players: string;
  prior_record: string;
  add_usssa: boolean;
  ack_safesport: boolean;
  ack_concussion: boolean;
  ack_cardiac: boolean;
};

const INITIAL: State = {
  registration_type: "",
  coach_name: "",
  coach_email: "",
  coach_phone: "",
  street: "",
  city: "",
  state: "",
  zip: "",
  team_name: "",
  age_group: "",
  estimated_players: "",
  prior_record: "",
  add_usssa: false,
  ack_safesport: false,
  ack_concussion: false,
  ack_cardiac: false,
};

export default function RegisterPage() {
  const [f, setF] = useState<State>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; fee: number } | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardErr, setCardErr] = useState<string | null>(null);

  async function payByCard(registrationId: string) {
    setCardErr(null);
    setCardLoading(true);
    try {
      const res = await fetch("/api/square-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrationId }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setCardErr(data.error ?? "Couldn't start card payment.");
    } catch {
      setCardErr("Network error — please try again.");
    } finally {
      setCardLoading(false);
    }
  }

  const set =
    <K extends keyof State>(key: K) =>
    (v: State[K]) =>
      setF((prev) => ({ ...prev, [key]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registration_type: f.registration_type,
          head_coach: {
            name: f.coach_name,
            email: f.coach_email,
            phone: f.coach_phone,
            street: f.street,
            city: f.city,
            state: f.state,
            zip: f.zip,
          },
          team: {
            name: f.team_name,
            age_group: f.age_group,
            estimated_players: f.estimated_players,
            prior_record: f.prior_record,
          },
          add_usssa: f.add_usssa,
          compliance: {
            safesport: f.ack_safesport,
            concussion: f.ack_concussion,
            cardiac: f.ack_cardiac,
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; id?: string; fee?: number; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        setDone({ id: data.id!, fee: data.fee! });
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="container py-12" style={{ maxWidth: 680 }}>
        <div
          style={{
            border: "1px solid var(--border)",
            borderTop: "5px solid var(--brand-primary)",
            borderRadius: 12,
            background: "var(--card)",
            padding: "28px 26px",
          }}
        >
          <h1 className="font-display" style={{ fontSize: 34, color: "var(--brand-primary)" }}>
            Registration received!
          </h1>
          <p style={{ color: "var(--muted)", lineHeight: 1.6, marginTop: 8 }}>
            Thanks — your team is on the list (confirmation #{done.id.slice(0, 8)}).
            A league director will review and follow up by email.
          </p>
          <div
            style={{
              marginTop: 18,
              padding: "16px 18px",
              borderRadius: 10,
              background: "var(--bg, #f6f8fb)",
              border: "1px solid var(--border)",
            }}
          >
            <p style={{ fontWeight: 800, marginBottom: 6 }}>
              Amount due: ${done.fee}.00
            </p>
            <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
              Choose how to pay — your spot is confirmed once payment is
              received:
            </p>
            <ul
              style={{
                color: "var(--muted)",
                fontSize: 14,
                lineHeight: 1.7,
                marginTop: 8,
                paddingLeft: 18,
              }}
            >
              <li>
                <strong>Check</strong> to COYBL — 152 Glen Crossing Drive, Etna,
                OH 43062
              </li>
              <li>
                <strong>Venmo</strong> — @Doug-Hare-2
              </li>
              <li>
                <strong>Card</strong> — pay online below (a 3.25% processing fee
                applies)
              </li>
            </ul>
            <button
              type="button"
              onClick={() => payByCard(done.id)}
              disabled={cardLoading}
              style={{
                marginTop: 14,
                padding: "12px 24px",
                borderRadius: 10,
                background: "var(--brand-primary)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 15,
                border: "none",
                cursor: cardLoading ? "default" : "pointer",
                opacity: cardLoading ? 0.6 : 1,
              }}
            >
              {cardLoading
                ? "Starting…"
                : `Pay by card — $${(done.fee * 1.0325).toFixed(2)}`}
            </button>
            {cardErr && (
              <p style={{ color: "#c8102e", fontSize: 13, marginTop: 8 }}>{cardErr}</p>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-10" style={{ maxWidth: 720 }}>
      <header className="mb-6">
        <h1 className="font-display" style={{ fontSize: "clamp(36px, 5vw, 52px)" }}>
          <span style={{ color: "var(--text-strong)" }}>Team</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Registration</span>
        </h1>
        <p className="sec-eyebrow mt-1">2027 Spring &amp; Summer Season</p>
      </header>

      <form onSubmit={submit} style={{ display: "grid", gap: 26 }}>
        {/* Registration type */}
        <Section title="1 · Registration Type">
          <div style={{ display: "grid", gap: 12 }}>
            {TYPES.map((t) => (
              <label
                key={t.id}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "14px 16px",
                  border:
                    f.registration_type === t.id
                      ? "2px solid var(--brand-primary)"
                      : "1px solid var(--border)",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: "var(--card)",
                }}
              >
                <input
                  type="radio"
                  name="registration_type"
                  checked={f.registration_type === t.id}
                  onChange={() => set("registration_type")(t.id)}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <span style={{ fontWeight: 800 }}>
                    {t.title} — ${t.fee}
                  </span>
                  <br />
                  <span style={{ color: "var(--muted)", fontSize: 13.5 }}>{t.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </Section>

        {/* Head coach */}
        <Section title="2 · Head Coach Information">
          <Grid>
            <Field label="Full name" required value={f.coach_name} onChange={set("coach_name")} />
            <Field label="Email" required type="email" value={f.coach_email} onChange={set("coach_email")} />
            <Field label="Phone" required value={f.coach_phone} onChange={set("coach_phone")} />
            <Field label="Street address" value={f.street} onChange={set("street")} />
            <Field label="City" value={f.city} onChange={set("city")} />
            <Field label="State" value={f.state} onChange={set("state")} />
            <Field label="ZIP" value={f.zip} onChange={set("zip")} />
          </Grid>
        </Section>

        {/* Team */}
        <Section title="3 · Team Information">
          <Grid>
            <Field label="Team / club name" required value={f.team_name} onChange={set("team_name")} />
            <div>
              <Label>Age group *</Label>
              <select
                required
                value={f.age_group}
                onChange={(e) => set("age_group")(e.target.value)}
                style={inputStyle}
              >
                <option value="">Select…</option>
                {AGE_GROUPS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Estimated # of players"
              type="number"
              value={f.estimated_players}
              onChange={set("estimated_players")}
            />
            <Field
              label="Prior season record (optional)"
              value={f.prior_record}
              onChange={set("prior_record")}
            />
          </Grid>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
            Teams register by age group. League directors assign divisions after
            registration to level competition.
          </p>
        </Section>

        {/* Add-ons */}
        <Section title="4 · Add-Ons">
          <Check
            checked={f.add_usssa}
            onChange={set("add_usssa")}
            label={`Add USSSA membership (+$${USSSA_FEE})`}
          />
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
            Optional — adds USSSA registration for your team.
          </p>
        </Section>

        {/* Compliance */}
        <Section title="5 · Required Coach Training">
          <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 10 }}>
            Head coaches must complete these before the season (federal & Ohio law):
          </p>
          <Check
            checked={f.ack_safesport}
            onChange={set("ack_safesport")}
            label="I will complete SafeSport abuse-awareness training."
          />
          <Check
            checked={f.ack_concussion}
            onChange={set("ack_concussion")}
            label="I will complete Ohio Heads Up concussion training."
          />
          <Check
            checked={f.ack_cardiac}
            onChange={set("ack_cardiac")}
            label="I will complete Lindsay's Law sudden-cardiac-arrest training."
          />
        </Section>

        {error && (
          <p style={{ color: "#c8102e", fontWeight: 700, fontSize: 14 }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            justifySelf: "start",
            padding: "14px 30px",
            borderRadius: 10,
            background: "var(--brand-primary)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 16,
            border: "none",
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Submitting…" : "Submit Registration"}
        </button>
        <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: -10 }}>
          No payment is taken here — pay by check or arrange electronic payment
          after submitting.
        </p>
      </form>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
        padding: "20px 22px",
      }}
    >
      <h2
        className="font-barlow"
        style={{
          fontSize: 13,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: "var(--brand-primary)",
          marginBottom: 16,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "block",
        fontSize: 12.5,
        fontWeight: 700,
        color: "var(--muted)",
        marginBottom: 5,
      }}
    >
      {children}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "#fff",
  fontSize: 14.5,
};

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }}
      />
      <span style={{ fontSize: 14, lineHeight: 1.5 }}>{label}</span>
    </label>
  );
}
