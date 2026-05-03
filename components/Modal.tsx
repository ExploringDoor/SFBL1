"use client";

// Centered dialog modal used by the @modal parallel route. Closes via
// Esc key, click outside, or the close button. Uses router.back() so
// modal close pops the modal route while keeping the underlying page
// (e.g. /scores) intact.
//
// Also intercepts internal Link clicks: when a user clicks a link
// inside the modal that navigates AWAY from the current URL, close the
// modal first so the new page renders cleanly.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function Modal({ children, title }: { children: React.ReactNode; title?: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
    }
    document.addEventListener("keydown", onKey);
    // Lock background scroll. Compensate for the missing scrollbar
    // width so the page doesn't visibly shift when the modal opens.
    const sw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (sw > 0) document.body.style.paddingRight = `${sw}px`;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [router]);

  function onBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) router.back();
  }

  // Intercept clicks on internal anchors. A click on a Link that
  // navigates to a different URL should close the modal first so the
  // new page renders without the modal stuck on top.
  function onContentClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement | null)?.closest("a") as
      | HTMLAnchorElement
      | null;
    if (!target) return;
    const href = target.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) {
      return;
    }
    // Internal nav — close the modal, then push to the destination.
    e.preventDefault();
    router.back();
    setTimeout(() => router.push(href), 50);
  }

  return (
    <div
      onClick={onBackdropClick}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={dialogRef}
        className="relative my-8 w-full max-w-3xl rounded-lg bg-white shadow-2xl"
        onClick={onContentClick}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md bg-slate-100 px-2 py-1 text-sm text-slate-600 hover:bg-slate-200"
        >
          ✕
        </button>
        <div className="max-h-[90vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
