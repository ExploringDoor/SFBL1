"use client";

// Toolbar for a season's brackets: jump-to-division buttons and a zoom control.
//
// Ported from brackets.html in the STSBT site (the `#zoomIn` / `#zoomOut` /
// `#zoomFit` handlers and `.bk-zoomable`), so zoom behaves the same here as on
// D27 and Texas Select: CSS `zoom` on a wrapper, clamped 0.4–1.4, stepping by
// 0.1, and a Fit that divides the available width by the canvas width.
//
// One difference on purpose: the original opens at 100% and you press Fit. A
// LCYBL season is eight divisions deep and the widest canvas is ~1350px, so
// opening at 100% means every bracket starts cut off. This opens at Fit and
// leaves the control there to zoom back in.
//
// Zoom is applied by walking the DOM rather than by re-rendering: the brackets
// are hundreds of absolutely-positioned server-rendered nodes, and making them
// client state to change one CSS property would be a bad trade.

import { useCallback, useEffect, useRef, useState } from "react";

const MIN = 0.4;
const MAX = 1.4;
const STEP = 0.1;

export function BracketControls({
  sections,
  children,
}: {
  /** One entry per division, in page order. */
  sections: { id: string; label: string }[];
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  const apply = useCallback((z: number) => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".bk-zoomable").forEach((el) => {
      // `zoom` rather than `transform: scale()` — scale leaves the original
      // box size behind, so the page keeps scrolling for space the shrunken
      // bracket no longer uses. This matches the original renderer too.
      el.style.zoom = String(z);
    });
  }, []);

  const fit = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    // Reset to 1 before measuring: offsetWidth is reported in the ZOOMED
    // coordinate space, so fitting twice without this compounds and shrinks
    // the bracket further each press. The original does the same.
    root.querySelectorAll<HTMLElement>(".bk-zoomable").forEach((el) => {
      el.style.zoom = "1";
    });
    // Widest canvas on the page decides the fit, so one zoom suits them all.
    let widest = 0;
    root.querySelectorAll<HTMLElement>(".bk-canvas").forEach((c) => {
      widest = Math.max(widest, c.offsetWidth);
    });
    const avail = (root.clientWidth || window.innerWidth) - 6;
    const z =
      widest > 0
        ? Math.round(Math.max(MIN, Math.min(1, avail / widest)) * 100) / 100
        : 1;
    setZoom(z);
    apply(z);
  }, [apply]);

  // Auto-fit on mount, and re-fit when the container resizes.
  //
  // A single requestAnimationFrame was not enough: fonts and the sticky
  // toolbar can still be settling, so the measurement either lands at zero
  // width or React's StrictMode double-mount cancels the frame. A
  // ResizeObserver is the reliable signal — it fires once the element has a
  // real box, and again whenever that box changes.
  // Auto-fit on mount, and re-fit when the container resizes.
  //
  // The fit is called directly rather than from a rAF: the canvas carries an
  // explicit inline width, so its offsetWidth is correct as soon as the effect
  // runs. Deferring it to a frame was unreliable — StrictMode's double-mount
  // cancelled the pending frame and the bracket opened unfitted.
  const didAutoFit = useRef(false);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!didAutoFit.current) {
      didAutoFit.current = true;
      fit();
    }
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      // Re-fit on a real container resize only; a zoom the user chose is not
      // overwritten unless the box actually changed.
      raf = requestAnimationFrame(() => {
        if (root.clientWidth > 0) fit();
      });
    });
    ro.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [fit]);

  const step = (dir: 1 | -1) => {
    const z = Math.round((zoom + dir * STEP) * 10) / 10;
    const clamped = Math.max(MIN, Math.min(MAX, z));
    setZoom(clamped);
    apply(clamped);
  };

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={ref}>
      <div className="bk-toolbar">
        {sections.length > 1 && (
          <div className="bk-jump">
            <span className="bk-jump-lbl">Jump to</span>
            <div className="bk-jump-btns">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="bk-jump-btn"
                  onClick={() => jump(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bk-tools">
          <div className="bk-zoomctl">
            <button type="button" onClick={() => step(-1)} aria-label="Zoom out">
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => step(1)} aria-label="Zoom in">
              +
            </button>
          </div>
          <button type="button" className="bk-tool-btn" onClick={fit}>
            Fit
          </button>
        </div>
      </div>

      {children}
    </div>
  );
}
