"use client";

// Hover a team anywhere in the bracket and its whole path lights up — the same
// behaviour as js/sts-bracket-render.js `wireHover` on D27, STSBT and Texas
// Select. Following one club from its first game to the final is the single
// most useful thing you can do with a bracket, and it is what made the
// original feel alive.
//
// A thin client wrapper rather than a client BracketTree: the tree itself is
// hundreds of absolutely-positioned nodes computed on the server, and shipping
// all of that to the browser to add two listeners would be a bad trade. This
// attaches to the rendered DOM instead.
//
// Delegated listeners, exactly as the original: one `mouseover` on the root
// rather than one per side, so a 100-card bracket adds two listeners total.

import { useEffect, useRef } from "react";

export function BracketHover({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cur: string | null = null;

    const clear = () => {
      root.querySelectorAll(".bk-side.path-hi").forEach((el) =>
        el.classList.remove("path-hi"),
      );
      root.querySelectorAll(".bk-match.path-card").forEach((el) =>
        el.classList.remove("path-card"),
      );
    };

    const onOver = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const side = t?.closest?.(".bk-side[data-team]") as HTMLElement | null;
      const team = side?.getAttribute("data-team") ?? null;
      if (team === cur) return;
      cur = team;
      clear();
      if (!team) return;
      root.querySelectorAll(".bk-side[data-team]").forEach((el) => {
        if (el.getAttribute("data-team") !== team) return;
        el.classList.add("path-hi");
        // Lift the whole card too, so the path reads as a run of games rather
        // than a scatter of highlighted rows.
        el.closest(".bk-match")?.classList.add("path-card");
      });
    };

    const onLeave = () => {
      cur = null;
      clear();
    };

    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
