"use client";

// Centered dialog modal used by the @modal parallel route. Closes via
// Esc key, click outside, or the close button. Uses router.back() so
// modal close pops the modal route while keeping the underlying page
// (e.g. /scores) intact.

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
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [router]);

  function onBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) router.back();
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
