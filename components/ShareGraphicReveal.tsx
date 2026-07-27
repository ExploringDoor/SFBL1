"use client";

// COYBL game modal: the share graphic starts hidden behind a "Share Graphic"
// button (Adam's ask — match the LMLL modal, where the card only appears after
// you tap Share Graphic, instead of sitting embedded in the modal). Clicking
// reveals the ShareCard (its own Download/Share controls take over from there).

import { useState } from "react";

export function ShareGraphicReveal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <div style={{ maxWidth: 420 }}>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="rc-action rc-action-primary"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M18 8a3 3 0 1 0-2.83-4H15a3 3 0 0 0 .17 1L8.83 8.5A3 3 0 1 0 6 13a3 3 0 0 0 2.83-2l6.34 3.5A3 3 0 1 0 18 16a3 3 0 0 0-2.83 2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2" />
      </svg>
      Share Graphic
    </button>
  );
}
