"use client";

// Age-group tabbed rules (LCYBL). The league publishes separate rule sheets for
// 8U/10U, 12U/14U, and Fall Ball; each is a long document, so stacking all three
// as one scroll was unreadable. Tabs switch between them and the selected sheet
// renders through ContentSections, which cards each "##" section with a jump-to
// row. A modern, scannable rules page instead of a wall of prose.

import { useState } from "react";
import { ContentSections } from "@/components/ContentSections";

export interface RulesGroup {
  key: string;
  label: string;
  /** The "At a glance" key facts, shown as tiles above the full detail. */
  glance?: { label: string; value: string }[];
  /** Intro HTML shown above the accordion (the sheet's summary line). */
  lead?: string;
  /** Each rule section as a collapsible accordion row. */
  sections?: { title: string; html: string }[];
  /** Fallback: full sanitized HTML (used only if `sections` is empty). */
  html: string;
}

export function RulesTabbed({
  groups,
  updatedAt,
}: {
  groups: RulesGroup[];
  updatedAt?: string;
}) {
  const [active, setActive] = useState(groups[0]?.key ?? "");
  const current = groups.find((g) => g.key === active) ?? groups[0];
  if (!current) return null;

  return (
    <div className="rt-wrap">
      <div className="rt-tabs" role="tablist" aria-label="Rules by age group">
        {groups.map((g) => (
          <button
            key={g.key}
            role="tab"
            aria-selected={g.key === active}
            className={"rt-tab" + (g.key === active ? " rt-tab-on" : "")}
            onClick={() => setActive(g.key)}
            type="button"
          >
            {g.label}
          </button>
        ))}
      </div>

      {updatedAt && <p className="rt-updated">Updated {updatedAt}</p>}

      <div role="tabpanel" className="rt-panel">
        {current.lead && (
          <div
            className="rt-lead"
            dangerouslySetInnerHTML={{ __html: current.lead }}
          />
        )}

        {current.sections && current.sections.length > 0 ? (
          <div className="rt-acc">
            {current.sections.map((s, i) => (
              <details className="rt-item" key={active + i} open={i === 0}>
                <summary className="rt-sum">
                  <span className="rt-sum-title">{s.title}</span>
                  <span className="rt-sum-icon" aria-hidden="true" />
                </summary>
                <div
                  className="rt-body"
                  dangerouslySetInnerHTML={{ __html: s.html }}
                />
              </details>
            ))}
          </div>
        ) : (
          <ContentSections html={current.html} />
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .rt-tabs {
          display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;
        }
        .rt-tab {
          min-height: 52px; padding: 0 26px; border-radius: 14px;
          border: 1.5px solid rgba(20,33,61,.14); background: #fff;
          color: var(--brand-primary, #14213d);
          font-weight: 900; font-size: 17px; letter-spacing: .01em; cursor: pointer;
          box-shadow: 0 2px 6px -2px rgba(20,33,61,.18);
          transition: transform .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease, border-color .14s ease;
        }
        .rt-tab:hover { transform: translateY(-2px); }
        .rt-tab-on {
          background: var(--brand-primary, #14213d); color: #fff;
          border-color: var(--brand-primary, #14213d);
          box-shadow: 0 10px 22px -10px rgba(20,33,61,.55);
        }
        .rt-updated {
          font-size: 12px; color: #64748b; margin: 0 0 18px; font-weight: 600;
        }
        /* Deep dive as an accordion (2D Sports style): clean rule rows that
           each expand on click. */
        .rt-lead { color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 18px; }
        .rt-lead strong { color: #0f172a; }
        .rt-acc {
          border-top: 1px solid rgba(20,33,61,.12);
          border-radius: 12px; overflow: hidden;
        }
        .rt-item { border-bottom: 1px solid rgba(20,33,61,.12); }
        .rt-sum {
          list-style: none; cursor: pointer;
          display: flex; align-items: center; gap: 14px;
          padding: 16px 6px; font-size: 17px; font-weight: 800; color: var(--brand-primary, #14213d);
          transition: color .14s ease;
        }
        .rt-sum::-webkit-details-marker { display: none; }
        .rt-sum:hover { color: #c9a227; }
        .rt-sum-title { flex: 1; }
        .rt-sum-icon {
          flex: 0 0 auto; width: 12px; height: 12px; position: relative;
          transition: transform .2s ease;
        }
        .rt-sum-icon::before, .rt-sum-icon::after {
          content: ""; position: absolute; background: currentColor; border-radius: 2px;
        }
        .rt-sum-icon::before { top: 5px; left: 0; width: 12px; height: 2px; }      /* horizontal */
        .rt-sum-icon::after  { top: 0; left: 5px; width: 2px; height: 12px; }        /* vertical */
        .rt-item[open] .rt-sum-icon::after { transform: scaleY(0); }                 /* minus when open */
        .rt-item[open] .rt-sum { color: #c9a227; }
        .rt-body {
          padding: 6px 6px 26px; color: #1f2937; font-size: 16px; line-height: 1.72;
        }
        .rt-body :where(h3) { font-size: 16px; font-weight: 800; margin: 18px 0 6px; color: #0f172a; }
        .rt-body :where(p) { margin: 10px 0; }
        .rt-body :where(ul, ol) { margin: 10px 0; padding-left: 24px; }
        .rt-body :where(li) { margin: 6px 0; }
        .rt-body :where(strong) { color: #0f172a; font-weight: 700; }
        .rt-body :where(a) { color: #1d4ed8; text-decoration: underline; }
        /* Per-section rule tables: readable, full-width, navy header, scroll on
           small screens. These are the heart of each rule, so give them room. */
        .rt-body :where(table) {
          display: block; width: max-content; max-width: 100%; overflow-x: auto;
          border-collapse: collapse; margin: 14px 0; font-size: 15.5px;
          border: 1px solid rgba(20,33,61,.14); border-radius: 10px;
        }
        .rt-body :where(th) {
          text-align: center; background: var(--brand-primary, #14213d); color: #fff;
          padding: 11px 18px; font-weight: 800; white-space: nowrap;
          letter-spacing: .01em; border-right: 1px solid rgba(255,255,255,.14);
        }
        .rt-body :where(td) {
          text-align: center; padding: 12px 18px; font-weight: 700; color: #0f172a;
          border-top: 1px solid rgba(20,33,61,.12); border-right: 1px solid rgba(20,33,61,.1);
          font-variant-numeric: tabular-nums; white-space: nowrap;
        }
        .rt-body :where(th:last-child, td:last-child) { border-right: none; }
        /* NO prefers-color-scheme: dark override here. The site is a
         * light-only theme (white page background everywhere), so a dark-mode
         * block that lightens the body text to #d3d9e6 rendered light-gray
         * text on white — unreadable for anyone whose OS is set to dark mode.
         * Keep the body text dark (#1f2937 / #0f172a) regardless of OS theme. */
        @media (max-width: 520px) {
          .rt-tab { flex: 1 1 auto; font-size: 15px; padding: 0 12px; min-height: 48px; }
        }
      `,
        }}
      />
    </div>
  );
}
