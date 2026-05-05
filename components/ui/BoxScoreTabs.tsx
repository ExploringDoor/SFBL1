"use client";

// Client-side tab toggle for the box-score modal. Takes two
// pre-rendered slots (boxBody, recapBody) and swaps between them via
// useState — no URL change, no full re-render. Initial tab comes from
// ?tab=recap so direct links into the recap still land correctly.

import { useState } from "react";

export interface BoxScoreTabsProps {
  initial: "box" | "recap";
  boxBody: React.ReactNode;
  recapBody: React.ReactNode;
}

export function BoxScoreTabs({ initial, boxBody, recapBody }: BoxScoreTabsProps) {
  const [view, setView] = useState<"box" | "recap">(initial);
  return (
    <>
      <div className="bs-tabs">
        <button
          type="button"
          onClick={() => setView("box")}
          className={"bs-tab" + (view === "box" ? " active" : "")}
        >
          📊 Box Score
        </button>
        <button
          type="button"
          onClick={() => setView("recap")}
          className={"bs-tab" + (view === "recap" ? " active" : "")}
        >
          📰 Recap
        </button>
      </div>
      {view === "box" ? boxBody : recapBody}
    </>
  );
}
