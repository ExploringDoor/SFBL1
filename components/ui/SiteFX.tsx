"use client";

// Motion layer driver. Mounted from the root layout ONLY when the tenant sets
// flags.motion_fx, so SFBL / COYBL / LBDC never load it.
//
// Design notes worth keeping:
//
// • It tags elements by SELECTOR at runtime rather than requiring every page
//   component to sprout data-fx props. That means the whole effect lands
//   without editing a dozen shared components that other tenants also render,
//   and a selector that stops matching costs an animation, never a broken page.
//
// • It never hides what is already on screen. Elements in the initial viewport
//   are marked done immediately, so there is no flash of content disappearing
//   and animating back in — the classic scroll-reveal bug on a fast connection.
//
// • Stagger is capped. A 52-row fields list at 45ms each would take 2.3s to
//   finish drawing; MAX_STAGGER holds the tail to something that reads as
//   snappy no matter how long the list is.
//
// • State is carried on data-* ATTRIBUTES, not classes. React owns className on
//   most of these nodes, so a re-render would wipe an imperatively added class
//   (and warns about a hydration mismatch on the way). React does not touch
//   data attributes it never rendered, so they survive.
//
// • It bails entirely under prefers-reduced-motion, before tagging anything.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Selector -> stagger step (ms). Order matters only for readability. */
const REVEAL: Array<{ sel: string; step: number }> = [
  { sel: ".le-gc-card", step: 55 }, // game / result cards
  { sel: ".le-div-card", step: 70 }, // standings division cards
  { sel: ".le-compact-row", step: 28 }, // homepage standings sidebar rows
  { sel: "section[id]", step: 60 }, // rules + content section cards
  { sel: ".sec-eyebrow", step: 0 }, // section kickers
];

/** Rows that get a win-percentage bar drawn behind them. */
const BAR_ROW = "tbody tr";

const MAX_STAGGER = 340; // ms — hard ceiling on any one group's tail

/** Flip an element into its revealed state on the NEXT frame, so the engine has
 *  a resolved "from" style to interpolate out of rather than being handed the
 *  animation and the trigger in the same tick.
 *
 *  Note this is defensive, not a proven fix: it was added while chasing
 *  animations that appeared stuck at currentTime 0, but both automated browser
 *  surfaces available here run their tabs with document.hidden === true, where
 *  rAF does not fire and animation timelines do not advance. Those readings
 *  were environment artifacts. The pattern is still correct and costs one
 *  frame; if rAF never fires, nothing is stranded, because the on-screen branch
 *  never sets data-fx in the first place and so never hides anything. */
function revealNextFrame(el: HTMLElement, alsoDone = false) {
  requestAnimationFrame(() => {
    el.setAttribute("data-fx-in", "");
    if (alsoDone) el.setAttribute("data-fx-done", "");
  });
}

export function SiteFX() {
  const pathname = usePathname();

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.setAttribute("data-fx-in", "");
          io.unobserve(el);
          // Drop the compositor hint once the animation has had time to run.
          window.setTimeout(() => el.setAttribute("data-fx-done", ""), 900);
          if (el.hasAttribute("data-fx-count")) countUp(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );

    const tagged: HTMLElement[] = [];

    const scan = () => {
      const vh = window.innerHeight || 0;
      const tag = (el: HTMLElement, delay: number, kind = "rise") => {
        const box = el.getBoundingClientRect();
        // Zero-height elements are usually collapsed/hidden; skip them so we
        // don't pin an invisible node at opacity 0.
        if (box.height === 0) return;
        const onScreenNow = box.top < vh && box.bottom > 0;
        if (onScreenNow) {
          // Already visible: reveal without ever hiding it.
          revealNextFrame(el, true);
          if (el.hasAttribute("data-fx-count")) countUp(el);
          return;
        }
        el.setAttribute("data-fx", kind);
        el.style.setProperty("--fx-d", `${delay}ms`);
        tagged.push(el);
        io.observe(el);
    };

    for (const { sel, step } of REVEAL) {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(sel),
      ).filter((n) => !n.hasAttribute("data-fx") && !n.hasAttribute("data-fx-in"));
      nodes.forEach((n, i) => {
        const delay = step === 0 ? 0 : Math.min(i * step, MAX_STAGGER);
        tag(n, delay);
      });
    }

    // ---- standings win bars -------------------------------------------
    // Reads W and L out of the row's own cells, so it works for any tenant's
    // column order as long as the header says W / L. If it can't find them it
    // simply skips — no bar is better than a wrong bar.
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const heads = Array.from(table.querySelectorAll("thead th")).map((th) =>
        (th.textContent ?? "").trim().toUpperCase(),
      );
      const wi = heads.indexOf("W");
      const li = heads.indexOf("L");
      if (wi === -1 || li === -1) continue;
      const rows = Array.from(table.querySelectorAll<HTMLElement>(BAR_ROW));
      rows.forEach((row, i) => {
        const cells = row.querySelectorAll("td");
        const w = Number((cells[wi]?.textContent ?? "").trim());
        const l = Number((cells[li]?.textContent ?? "").trim());
        if (!Number.isFinite(w) || !Number.isFinite(l) || w + l <= 0) return;
        if (row.hasAttribute("data-fx-bar")) return;
        row.setAttribute("data-fx-bar", "");
        // Clamp just below 1. Defensive: an undefeated team is the one row
        // that lands on the exact end of the range, and it was the only row
        // that ever looked wrong while this was being built. The difference
        // between 0.98 and 1.0 is invisible at this width, so the clamp costs
        // nothing and removes the edge case.
        row.style.setProperty("--fx-pct", String(Math.min(w / (w + l), 0.98)));
        row.style.setProperty(
          "--fx-d",
          `${Math.min(i * 45, MAX_STAGGER)}ms`,
        );
        const box = row.getBoundingClientRect();
        if (box.top < vh && box.bottom > 0) revealNextFrame(row);
        else io.observe(row);
      });
    }

    // ---- winning score pop ---------------------------------------------
    document
      .querySelectorAll<HTMLElement>(".le-gc-score-win:not([data-fx-pop])")
      .forEach((el, i) => {
        el.setAttribute("data-fx-pop", "");
        el.style.setProperty("--fx-d", `${Math.min(i * 60, MAX_STAGGER) + 180}ms`);
        const box = el.getBoundingClientRect();
        if (box.top < vh && box.bottom > 0) revealNextFrame(el);
        else io.observe(el);
      });

    // ---- banner + nav ---------------------------------------------------
    document
      .querySelectorAll<HTMLElement>('img[src*="/headers/"]')
      .forEach((img) => img.parentElement?.setAttribute("data-fx-banner", ""));

    };

    scan();

    // Standings, scores and teams fetch their data on the client, so the first
    // scan runs against skeletons and finds nothing to animate. Re-scan when
    // the DOM settles. childList only — we write attributes and inline styles,
    // so observing attributes here would feed back into itself.
    let t = 0;
    const mo = new MutationObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(scan, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    const nav = document.querySelector<HTMLElement>(".le-nav");
    const onScroll = () => {
      if (!nav) return;
      if (window.scrollY > 8) nav.setAttribute("data-fx-stuck", "");
      else nav.removeAttribute("data-fx-stuck");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
      mo.disconnect();
      io.disconnect();
      // Leave revealed elements alone, but un-hide anything still pending so a
      // route change mid-animation can never strand content at opacity 0.
      for (const el of tagged) {
        if (!el.hasAttribute("data-fx-in")) el.removeAttribute("data-fx");
      }
    };
    // Re-run per route: App Router keeps the layout mounted across navigations,
    // so without this only the first page ever animates.
  }, [pathname]);

  return null;
}

/** Tick a number up to its final value. Reads the target from the element's
 *  own text so the markup stays the source of truth and SSR shows the real
 *  figure to anyone without JS. */
function countUp(el: HTMLElement) {
  const raw = (el.textContent ?? "").trim();
  const target = Number(raw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(target) || target === 0) return;
  const suffix = raw.replace(/[0-9.,-]/g, "");
  const dur = 620;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min((now - start) / dur, 1);
    // easeOutCubic
    const v = target * (1 - Math.pow(1 - t, 3));
    el.textContent = `${Math.round(v)}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = raw;
  };
  el.textContent = `0${suffix}`;
  requestAnimationFrame(step);
}
