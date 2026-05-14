"use client";

// Pay Online picker — dropdown selector + selected-fee detail card.
// Replaces the long static list view that used to live in
// /content/pay-online for LBDC. Adam asked for a "select a category
// → see that fee" UX (2026-05-13).
//
// Server passes the full categories array + the league contact info
// (commissioner name / phone / venmo handle / optional QR url). We
// pick a default category on mount: the first one whose id matches
// `defaultId`, else the first in the list.

import { useMemo, useState } from "react";

export interface PayCategory {
  id: string;
  label: string;
  amount: string;
  note?: string;
}

export interface PayContact {
  commissionerName?: string;
  commissionerPhone?: string;
  venmoHandle?: string;
  venmoQrUrl?: string;
}

export interface PayOnlinePickerProps {
  categories: PayCategory[];
  contact: PayContact;
  /** Optional category id to pre-select. Falls back to categories[0]. */
  defaultId?: string;
}

function telHref(raw: string): string {
  return "tel:" + raw.replace(/[^0-9+]/g, "");
}

export function PayOnlinePicker({
  categories,
  contact,
  defaultId,
}: PayOnlinePickerProps) {
  const initial = useMemo(() => {
    if (categories.length === 0) return "";
    if (defaultId) {
      const m = categories.find((c) => c.id === defaultId);
      if (m) return m.id;
    }
    return categories[0]!.id;
  }, [categories, defaultId]);

  const [selectedId, setSelectedId] = useState<string>(initial);
  const selected =
    categories.find((c) => c.id === selectedId) ?? categories[0] ?? null;

  if (!selected) {
    return (
      <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
        No payment categories configured yet.
      </p>
    );
  }

  const commName = contact.commissionerName ?? "the league";
  const phone = contact.commissionerPhone ?? "";
  const venmo = contact.venmoHandle ?? "";
  const qrUrl = contact.venmoQrUrl ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p
        style={{
          fontSize: 15,
          lineHeight: 1.55,
          color: "#374151",
          margin: 0,
        }}
      >
        All payments go to the league commissioner. Pick a fee type
        below for the amount, then send via Zelle or Venmo.
      </p>

      {/* Native <select> for accessibility + zero-dependency mobile
       *  UX. iOS Safari uses its giant picker wheel, Android uses the
       *  spinner; both are familiar and big-target. Custom styling is
       *  the wrapper + arrow chevron. */}
      <label
        style={{
          display: "block",
          background: "white",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 12,
          padding: "14px 18px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <span
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "#9ca3af",
            marginBottom: 6,
          }}
        >
          Payment type
        </span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 17,
            fontWeight: 700,
            color: "#111",
            appearance: "none",
            WebkitAppearance: "none",
            cursor: "pointer",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%236b7280' d='M6 8L0 0h12z'/%3E%3C/svg%3E\")",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 4px center",
            paddingRight: 22,
          }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} — {c.amount}
            </option>
          ))}
        </select>
      </label>

      {/* Selected fee detail card — amount on the right in the gold
       *  pill, descriptive note below. Border-left in brand-primary
       *  ties it back to the rest of the LBDC card system. */}
      <div
        style={{
          background: "white",
          border: "1px solid rgba(0,0,0,0.08)",
          borderLeft: "4px solid var(--brand-primary, #002d6e)",
          borderRadius: 14,
          padding: "20px 22px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ flex: "1 1 220px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: "#9ca3af",
              marginBottom: 6,
            }}
          >
            Fee
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: "#111",
              lineHeight: 1.15,
              marginBottom: 8,
            }}
          >
            {selected.label}
          </div>
          {selected.note && (
            <div
              style={{
                fontSize: 14,
                color: "#6b7280",
                lineHeight: 1.55,
              }}
            >
              {selected.note}
            </div>
          )}
        </div>
        <div
          style={{
            background: "var(--brand-primary, #002d6e)",
            color: "var(--brand-accent, #FFD700)",
            fontSize: 30,
            fontWeight: 900,
            padding: "10px 22px",
            borderRadius: 12,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {selected.amount}
        </div>
      </div>

      {/* How-to-pay card — same content as the old static page so
       *  Zelle + Venmo flows are still one-tap. */}
      <div
        style={{
          background: "white",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginTop: 8,
        }}
      >
        <div
          style={{
            background: "var(--brand-primary, #002d6e)",
            padding: "16px 22px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: "rgba(255,255,255,0.6)",
              marginBottom: 4,
            }}
          >
            How to pay
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 900,
              color: "white",
            }}
          >
            Send payment to {commName}
          </div>
        </div>
        <div style={{ padding: "6px 22px" }}>
          {/* Zelle row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "18px 0",
              borderBottom: venmo ? "1px solid rgba(0,0,0,0.06)" : "none",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "#6c3de0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                flexShrink: 0,
              }}
            >
              💸
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "#9ca3af",
                  marginBottom: 4,
                }}
              >
                Zelle
              </div>
              <div
                style={{ fontSize: 16, fontWeight: 700, color: "#111" }}
              >
                {phone ? (
                  <a
                    href={telHref(phone)}
                    style={{
                      color: "var(--brand-primary, #002d6e)",
                      textDecoration: "none",
                    }}
                  >
                    {phone}
                  </a>
                ) : (
                  "Contact the commissioner"
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#6b7280",
                  marginTop: 2,
                }}
              >
                Send to the cell number above
              </div>
            </div>
          </div>

          {/* Venmo row */}
          {venmo && (
            <div style={{ padding: "18px 0" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: qrUrl ? 14 : 0,
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: "#008aff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    flexShrink: 0,
                  }}
                >
                  📱
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      color: "#9ca3af",
                      marginBottom: 4,
                    }}
                  >
                    Venmo
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 900,
                      color: "#111",
                    }}
                  >
                    {venmo}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#6b7280",
                      marginTop: 2,
                    }}
                  >
                    {commName}
                  </div>
                </div>
              </div>
              {qrUrl && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    background: "rgba(0,138,255,0.05)",
                    border: "1px solid rgba(0,138,255,0.15)",
                    borderRadius: 12,
                    padding: 18,
                    gap: 8,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrUrl}
                    alt="Venmo QR code"
                    style={{
                      width: 200,
                      height: 200,
                      borderRadius: 10,
                      background: "white",
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      textAlign: "center",
                      maxWidth: 280,
                    }}
                  >
                    Scan with your camera or Venmo app to pay instantly
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
