"use client";

// Triggers the browser's native print flow. macOS users get a "Save as
// PDF" option from the print dialog out of the box, so we don't need a
// separate PDF generation pipeline. The print stylesheet in globals.css
// hides the ticker, header, footer, and Print button itself when printing.

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50"
    >
      Print / Save as PDF
    </button>
  );
}
