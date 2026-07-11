"use client";

// Shared shell + submission logic for the four public league forms
// (team-registration, player-registration, team-waiver,
// umpire-evaluation). Wraps a list of fields, manages local state,
// posts to /api/league-form, and renders the success / error states.
//
// Why one component: the four forms share submit UX, validation
// pattern, and CSS. Per-form differences (fields, copy, kind) are
// passed in as props.

import { useState } from "react";
import "./LeagueForm.css";

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "rating";

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Hint text shown under the input. */
  help?: string;
  placeholder?: string;
  /** For select/radio. */
  options?: { value: string; label: string }[];
  /** Two columns at desktop width, full width on mobile. */
  width?: "full" | "half";
}

export interface LeagueFormProps {
  /** Backend kind — picks the storage bucket + required-field set. */
  kind:
    | "team_registration"
    | "player_registration"
    | "team_waiver"
    | "umpire_evaluation";
  title: string;
  description?: string;
  /** Optional intro paragraph(s) — shown above the form. Each entry
   *  renders as its own <p>. ReactNode so callers can embed
   *  tel:/mailto: links inline; plain strings still work for simple
   *  blocks. */
  intro?: React.ReactNode[];
  /** Field config. Order is render order. */
  fields: FormField[];
  /** Optional waiver / agreement text. Renders inside a scrollable
   *  box right above the submit button. */
  waiverText?: string;
  /** Submit button label. */
  submitLabel?: string;
  /** Confirmation message shown after successful submission. */
  successMessage?: string;
}

export function LeagueForm({
  kind,
  title,
  description,
  intro,
  fields,
  waiverText,
  submitLabel = "Submit",
  successMessage = "Thanks! Your submission was received. The league office will be in touch.",
}: LeagueFormProps) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Name of the field that failed the required-check, so we can flag it
  // with aria-invalid. Validation stops at the first miss, so at most
  // one field is marked at a time.
  const [invalidField, setInvalidField] = useState<string | null>(null);

  function update(name: string, value: unknown) {
    setData((d) => ({ ...d, [name]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInvalidField(null);

    // Client-side required-field check. The <form> uses `noValidate`
    // (so we own the UX and don't inherit the browser's clunky
    // bubbles), which means we have to enforce `required` ourselves.
    // Without this the waiver-agree checkbox didn't actually gate
    // submission — users could send a player_registration without
    // checking it.
    for (const f of fields) {
      if (!f.required) continue;
      const v = data[f.name];
      const missing =
        v == null ||
        v === "" ||
        v === false ||
        (Array.isArray(v) && v.length === 0);
      if (missing) {
        setError(
          f.type === "checkbox"
            ? `Please check: ${f.label}`
            : `Please fill in: ${f.label}`,
        );
        setInvalidField(f.name);
        // Move focus to the offending field so keyboard/AT users land on
        // it directly. Ids follow the `lef-${name}` scheme set in Field;
        // a few control types (checkbox/radio/rating) don't render that
        // id, so the optional chain simply no-ops for those.
        document.getElementById(`lef-${f.name}`)?.focus();
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/league-form", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, data }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="container py-10">
        <FormHeader title={title} />
        <div className="le-form-success">
          <h2>✓ Submission received</h2>
          <p>{successMessage}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-10">
      <FormHeader title={title} description={description} />

      {intro && intro.length > 0 && (
        <div className="le-form-intro">
          {intro.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="le-form">
        {/* Honeypot — hidden from real users, bots fill it. */}
        <input
          type="text"
          name="website"
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", height: 0 }}
          onChange={(e) => update("website", e.target.value)}
        />

        <div className="le-form-grid">
          {fields.map((f) => (
            <Field
              key={f.name}
              field={f}
              value={data[f.name]}
              onChange={update}
              invalid={f.name === invalidField}
            />
          ))}
        </div>

        {waiverText && (
          <div className="le-form-waiver">
            <h3>Waiver and Release</h3>
            <div className="le-form-waiver-body">
              {waiverText.split("\n\n").map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="le-form-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="le-form-submit"
          disabled={submitting}
        >
          {submitting ? "Submitting…" : submitLabel}
        </button>
      </form>
    </main>
  );
}

function FormHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-6">
      <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
        SFBL
      </p>
      <h1
        className="font-display"
        style={{
          fontSize: "clamp(36px, 5vw, 54px)",
          color: "var(--text-strong)",
          margin: 0,
          lineHeight: 0.95,
        }}
      >
        {title}
      </h1>
      {description && (
        <p style={{ marginTop: 8, color: "var(--muted)", maxWidth: 680 }}>
          {description}
        </p>
      )}
    </header>
  );
}

function Field({
  field,
  value,
  onChange,
  invalid,
}: {
  field: FormField;
  value: unknown;
  onChange: (name: string, v: unknown) => void;
  /** Failed the required-check on the last submit — flags the control
   *  with aria-invalid so screen readers announce it. */
  invalid?: boolean;
}) {
  const id = `lef-${field.name}`;
  const ariaInvalid = invalid || undefined;
  const widthClass =
    field.width === "half" ? "le-form-cell-half" : "le-form-cell-full";

  if (field.type === "checkbox") {
    return (
      <label className={`le-form-cell ${widthClass} le-form-checkbox`}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(field.name, e.target.checked)}
          required={field.required}
          aria-invalid={ariaInvalid}
        />
        <span>
          {field.label}
          {field.required && <em className="le-form-required">*</em>}
        </span>
        {field.help && <small className="le-form-help">{field.help}</small>}
      </label>
    );
  }

  if (field.type === "rating") {
    const current = typeof value === "number" ? value : 0;
    return (
      <div className={`le-form-cell ${widthClass}`}>
        <label htmlFor={id}>
          {field.label}
          {field.required && <em className="le-form-required">*</em>}
        </label>
        <div className="le-form-rating" role="radiogroup" aria-invalid={ariaInvalid}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={current === n}
              className={
                "le-form-rating-star" + (n <= current ? " active" : "")
              }
              onClick={() => onChange(field.name, n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
            >
              ★
            </button>
          ))}
          {current > 0 && (
            <button
              type="button"
              className="le-form-rating-clear"
              onClick={() => onChange(field.name, 0)}
            >
              clear
            </button>
          )}
        </div>
        {field.help && <small className="le-form-help">{field.help}</small>}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className={`le-form-cell ${widthClass}`}>
        <label htmlFor={id}>
          {field.label}
          {field.required && <em className="le-form-required">*</em>}
        </label>
        <textarea
          id={id}
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(field.name, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          aria-invalid={ariaInvalid}
        />
        {field.help && <small className="le-form-help">{field.help}</small>}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className={`le-form-cell ${widthClass}`}>
        <label htmlFor={id}>
          {field.label}
          {field.required && <em className="le-form-required">*</em>}
        </label>
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
          aria-invalid={ariaInvalid}
        >
          <option value="">— Select —</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.help && <small className="le-form-help">{field.help}</small>}
      </div>
    );
  }

  if (field.type === "radio") {
    return (
      <fieldset
        className={`le-form-cell ${widthClass} le-form-radioset`}
        aria-invalid={ariaInvalid}
      >
        <legend>
          {field.label}
          {field.required && <em className="le-form-required">*</em>}
        </legend>
        <div className="le-form-radios">
          {field.options?.map((o) => (
            <label key={o.value} className="le-form-radio">
              <input
                type="radio"
                name={field.name}
                value={o.value}
                checked={value === o.value}
                onChange={(e) => onChange(field.name, e.target.value)}
                required={field.required}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        {field.help && <small className="le-form-help">{field.help}</small>}
      </fieldset>
    );
  }

  return (
    <div className={`le-form-cell ${widthClass}`}>
      <label htmlFor={id}>
        {field.label}
        {field.required && <em className="le-form-required">*</em>}
      </label>
      <input
        id={id}
        type={field.type}
        value={
          typeof value === "string" || typeof value === "number"
            ? String(value)
            : ""
        }
        onChange={(e) => {
          const v = e.target.value;
          onChange(field.name, field.type === "number" ? Number(v) : v);
        }}
        placeholder={field.placeholder}
        required={field.required}
        autoComplete={autoCompleteFor(field.name, field.type)}
        aria-invalid={ariaInvalid}
      />
      {field.help && <small className="le-form-help">{field.help}</small>}
    </div>
  );
}

function autoCompleteFor(name: string, type: FieldType): string | undefined {
  if (type === "email") return "email";
  if (type === "tel") return "tel";
  if (name.includes("first_name")) return "given-name";
  if (name.includes("last_name")) return "family-name";
  if (name === "city") return "address-level2";
  return undefined;
}
