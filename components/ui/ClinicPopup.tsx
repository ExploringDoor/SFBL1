"use client";

// The College Clinic offer, shown on arrival.
//
// Adam asked for this (2026-08-18): a popup as soon as you enter the site,
// with a Register button and a Continue to site option. Mike printed
// "REGISTER AT ISLANDFASTPITCH.COM" on the flyer, so the site has to make the
// clinic impossible to miss for a few weeks.
//
// ONCE PER VISIT, which was Adam's call from three options. sessionStorage,
// not localStorage: it comes back on a genuinely new visit, so a parent who
// dismissed it in August still meets it again in September, but it does not
// reappear while they are checking a score for the third time this morning.
//
// IT TAKES ITSELF DOWN. clinicIsOver() stops it after 12 October with nothing
// to remember and nothing to deploy. The page stays reachable so an old link
// still lands somewhere sensible.
//
// Deliberately NOT shown on /college-clinic itself. Interrupting someone to
// offer them the page they are already reading is how a popup becomes a joke.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CLINIC, clinicIsOver } from "@/lib/clinic";

const SEEN_KEY = "ifp-clinic-popup-seen";

export function ClinicPopup() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (clinicIsOver()) return;
    if (pathname?.startsWith("/college-clinic")) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
    } catch {
      // Private browsing can throw on storage. Better to show it once more
      // than to crash the home page over a popup.
    }
    // A beat, so it arrives as an offer rather than an ambush mid-paint.
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [pathname]);

  // Mark as seen the moment it is shown, not when it is dismissed. Someone who
  // navigates away without touching it has still had their interruption.
  useEffect(() => {
    if (!open) return;
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* see above */
    }
    closeRef.current?.focus();

    // The page behind must not scroll under the dialog.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="le-clinic-pop-backdrop"
      role="presentation"
      // Clicking the dark area is the third way out, alongside Escape and the
      // Continue button. A modal with only one exit is a trap.
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="le-clinic-pop"
        role="dialog"
        aria-modal="true"
        aria-label="Island Fastpitch College Clinic"
      >
        <button
          ref={closeRef}
          type="button"
          className="le-clinic-pop-x"
          aria-label="Close"
          onClick={() => setOpen(false)}
        >
          ×
        </button>

        {/* Mike's own flyer, rather than a text version of it. It already
            carries the date, the price, the cap and all ten college marks,
            and it is what families have seen on Instagram and on paper, so
            recognising it is half the job. Plain <img>: it is a static asset
            we resized ourselves, so there is nothing for next/image to do.

            The flyer's printed "REGISTER AT ISLANDFASTPITCH.COM" is not
            clickable, which is exactly why the buttons stay underneath it. */}
        <img
          className="le-clinic-pop-flyer"
          src={CLINIC.flyer}
          alt={`Island Fastpitch College Clinic, ${CLINIC.dateLabel}, ${CLINIC.timeLabel}, ${CLINIC.ages}, $${CLINIC.fee} per player, at ${CLINIC.venue}`}
          width={800}
          height={1200}
          decoding="async"
        />

        <div className="le-clinic-pop-actions">
          <Link
            href="/college-clinic"
            className="le-clinic-pop-cta"
            onClick={() => setOpen(false)}
          >
            Register for the Clinic
          </Link>
          <button
            type="button"
            className="le-clinic-pop-skip"
            onClick={() => setOpen(false)}
          >
            Continue to site
          </button>
        </div>
      </div>
    </div>
  );
}
