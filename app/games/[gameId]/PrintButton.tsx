"use client";

// Triggers printing / "Save as PDF". On desktop + mobile browsers this
// is the native print dialog (which offers "Save as PDF"). Inside the
// iOS installed app window.print() is a no-op, so triggerPrint() opens
// this page in a normal browser tab with ?autoprint=1 instead — see
// lib/print.ts. The print stylesheet in globals.css hides the ticker,
// header, footer, and this button when printing.

import { useEffect } from "react";
import { triggerPrint, wantsAutoPrint } from "@/lib/print";

export function PrintButton() {
  // When this page is opened as the standalone fallback tab
  // (?autoprint=1), fire the print dialog automatically once it paints.
  useEffect(() => {
    if (!wantsAutoPrint()) return;
    const t = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <button
      type="button"
      onClick={() => triggerPrint()}
      className="no-print rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50"
    >
      Print / Save as PDF
    </button>
  );
}
