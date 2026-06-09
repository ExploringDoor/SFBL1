"use client";

// Floating print toolbar at the top of every /print/* page.
// Auto-fires window.print() when ?autoprint=1 is on the URL — admin
// "Export PDF" buttons set that flag so the print dialog opens
// without a manual click. The page itself stays open after printing
// so admin can review/re-save without re-rendering.

import { useEffect } from "react";
import { triggerPrint } from "@/lib/print";

export function PrintToolbar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoprint") !== "1") return;
    // Defer to next tick so the page paints first; otherwise iOS
    // Safari sometimes loses the table layout in the preview.
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="print-toolbar">
      {/* triggerPrint() escapes the iOS installed app (where
          window.print() is a no-op) by re-opening in a browser tab. */}
      <button type="button" onClick={() => triggerPrint()}>
        Save as PDF / Print
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => window.close()}
      >
        Close tab
      </button>
    </div>
  );
}
