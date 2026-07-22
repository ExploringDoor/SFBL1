"use client";

/* Shareable game card — a screenshot-ready 1080x1080 graphic for any final, so a
   parent can post their kid's game to Facebook in one tap.

   Ported from LMLL's js/lmll-card.js. Drawn with the Canvas 2D API on purpose
   rather than SVG-to-image or html2canvas: canvas uses the page's already-loaded
   fonts reliably, needs no library, and works offline in the PWA.

   Four things had to change on the way over from LMLL:

   1. CANVAS TAINT. LMLL was safe only because its single bitmap was a same-origin
      relative path. Here, lib/types.ts allows logo_url to be an absolute https URL,
      and drawing a cross-origin image taints the canvas so toBlob() throws a
      SecurityError, silently killing BOTH Download and Share. We therefore only
      draw images that cannot taint (data: URLs and same-origin "/" paths) and fall
      back to the monogram roundel otherwise. See safeImageSrc().

   2. FONTS. Canvas only honours a family the document has actually loaded, and it
      needs a literal family name. LMLL also never awaited font loading, so a cold
      first open rendered in the fallback face. We await document.fonts.ready.

   3. BRANDING. Colours, wordmark and footer URL come from the tenant config
      instead of being hardcoded to Lower Merion.

   4. NO DOM AT MODULE SCOPE. Everything touching document/navigator now runs
      inside effects and handlers so this can be server-rendered.

   It never prints anything the recap engine would not: the score line is the real
   final and the flavor is the validated recap sentence, or nothing. */

import { useCallback, useEffect, useRef, useState } from "react";

const W = 1080;
const H = 1080;
const SCALE = 2; // retina

export interface ShareCardTeam {
  name: string;
  abbrev?: string | null;
  color?: string | null;
  logo_url?: string | null;
}

export interface ShareCardGame {
  home: ShareCardTeam;
  away: ShareCardTeam;
  home_score: number;
  away_score: number;
  date?: string | null;
  division?: string | null;
  field?: string | null;
}

export interface ShareCardBrand {
  /** Line 1 of the wordmark, e.g. "ISLAND". */
  line1: string;
  /** Line 2 of the wordmark, e.g. "FASTPITCH". */
  line2: string;
  primary: string;
  accent: string;
  highlight: string;
  /** Same-origin path or data URL only. Absolute URLs are ignored to avoid taint. */
  logoUrl?: string | null;
  /** Shown bottom-left, e.g. "islandfastpitch.com". */
  siteUrl: string;
  /** Shown bottom-right, e.g. "Island Fastpitch". */
  footerName: string;
}

const HEAD = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif';
const BODY = 'Inter, "Helvetica Neue", Arial, sans-serif';
const INK = "#ffffff";
const MUTED = "#8ea0c8";
const LINE = "rgba(255,255,255,.14)";

/** Only sources that cannot taint the canvas. Anything else returns null and we
 *  draw the monogram instead, because a tainted canvas breaks download + share. */
function safeImageSrc(src?: string | null): string | null {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  if (src.startsWith("/")) return src; // same-origin path
  return null; // absolute http(s) — would taint
}

function abbrevOf(t: ShareCardTeam): string {
  if (t.abbrev) return t.abbrev.slice(0, 4).toUpperCase();
  const words = t.name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const [first] = words;
  if (!first) return "?";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return words.map((w) => w.charAt(0)).join("").slice(0, 3).toUpperCase();
}

/** Stable colour from the name so a team looks the same on every card. */
const FALLBACK_PALETTE = ["#1f6fb2", "#c8452d", "#2e8b57", "#b8860b", "#6a4c93", "#0f766e"];

function colorOf(t: ShareCardTeam): string {
  if (t.color) return t.color;
  let h = 0;
  for (const c of t.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length] ?? "#1f6fb2";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] += "...";
  }
  return lines;
}

function fitName(ctx: CanvasRenderingContext2D, name: string, maxW: number) {
  let size = 56;
  do {
    ctx.font = `700 ${size}px ${HEAD}`;
    size -= 2;
  } while (ctx.measureText(name).width > maxW && size > 26);
  return size + 2;
}

function roundel(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  team: ShareCardTeam, img: HTMLImageElement | null,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  if (img) {
    ctx.clip();
    try {
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      return;
    } catch {
      /* fall through to the monogram */
    }
  }
  ctx.fillStyle = colorOf(team);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ab = abbrevOf(team);
  ctx.font = `800 ${Math.round(r * (ab.length > 1 ? 0.72 : 1.0))}px ${HEAD}`;
  ctx.fillText(ab, cx, cy + r * 0.04);
  ctx.restore();
}

export function drawCard(
  ctx: CanvasRenderingContext2D,
  g: ShareCardGame,
  brand: ShareCardBrand,
  flavor: string,
  images: { league: HTMLImageElement | null; home: HTMLImageElement | null; away: HTMLImageElement | null },
) {
  const tie = g.home_score === g.away_score;
  const awayWon = g.away_score > g.home_score;

  ctx.fillStyle = brand.primary;
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "rgba(255,255,255,.05)");
  grad.addColorStop(1, "rgba(0,0,0,.18)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = brand.accent;
  ctx.fillRect(0, 0, W, 10);

  if (images.league) {
    try { ctx.drawImage(images.league, 64, 60, 96, 96); } catch { /* ignore */ }
  }
  const textX = images.league ? 180 : 64;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `700 40px ${HEAD}`;
  ctx.fillText(brand.line1.toUpperCase(), textX, 100);
  ctx.fillStyle = MUTED;
  ctx.font = `600 26px ${HEAD}`;
  ctx.fillText(brand.line2.toUpperCase(), textX, 138);

  const pill = tie ? "TIE" : "FINAL";
  const pw = pill.length * 20 + 44;
  ctx.fillStyle = tie ? brand.highlight : brand.accent;
  roundRect(ctx, W - 64 - pw, 70, pw, 56, 28);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `800 30px ${HEAD}`;
  ctx.textAlign = "center";
  ctx.fillText(pill, W - 64 - pw / 2, 108);

  // y is carried on each row rather than looked up by index, so there is no
  // possibly-undefined array access to reason about.
  const rows = [
    { team: g.away, score: g.away_score, won: awayWon, img: images.away, y: 372 },
    { team: g.home, score: g.home_score, won: !awayWon && !tie, img: images.home, y: 560 },
  ];
  const nameX = 250;
  const scoreX = W - 96;

  rows.forEach(({ team, score, won, img, y }) => {
    roundel(ctx, 150, y, 74, team, img);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = won || tie ? INK : MUTED;
    ctx.font = `700 ${fitName(ctx, team.name, scoreX - nameX - 40)}px ${HEAD}`;
    ctx.fillText(team.name, nameX, y);
    ctx.textAlign = "right";
    ctx.fillStyle = won ? brand.highlight : tie ? INK : MUTED;
    ctx.font = `800 108px ${HEAD}`;
    ctx.fillText(String(score), scoreX, y + 6);
    if (won && !tie) {
      ctx.fillStyle = brand.highlight;
      ctx.beginPath();
      ctx.moveTo(70, y - 12);
      ctx.lineTo(70, y + 12);
      ctx.lineTo(52, y);
      ctx.closePath();
      ctx.fill();
    }
  });

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 690);
  ctx.lineTo(W - 64, 690);
  ctx.stroke();

  if (flavor) {
    ctx.fillStyle = "#dfe6f4";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `400 30px ${BODY}`;
    wrap(ctx, flavor, W - 128, 4).forEach((ln, i) => ctx.fillText(ln, 64, 756 + i * 44));
  }

  const meta = [g.date, g.division, g.field].filter(Boolean).join("   ·   ");
  ctx.fillStyle = MUTED;
  ctx.font = `600 24px ${HEAD}`;
  ctx.textAlign = "left";
  ctx.fillText(meta.toUpperCase(), 64, 960);

  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(64, 995);
  ctx.lineTo(W - 64, 995);
  ctx.stroke();
  ctx.fillStyle = brand.accent;
  ctx.font = `800 30px ${HEAD}`;
  ctx.fillText(brand.siteUrl, 64, 1040);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "right";
  ctx.font = `600 24px ${HEAD}`;
  ctx.fillText(brand.footerName, W - 64, 1040);
}

function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    if (img.complete && img.naturalWidth) resolve(img);
  });
}

function filenameFor(g: ShareCardGame, prefix: string) {
  return `${prefix}-${g.away.name}-vs-${g.home.name}`
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) + ".png";
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function ShareCard({
  game, brand, flavor = "",
}: { game: ShareCardGame; brand: ShareCardBrand; flavor?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    // Probe native file sharing so the Share button never no-ops on desktop.
    try {
      const probe = new File([""], "x.png", { type: "image/png" });
      setCanShareFiles(!!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Canvas can only use fonts the document has already loaded. Without this
      // the first open renders in the fallback face.
      try { await document.fonts?.ready; } catch { /* ignore */ }
      const [league, home, away] = await Promise.all([
        loadImage(safeImageSrc(brand.logoUrl)),
        loadImage(safeImageSrc(game.home.logo_url)),
        loadImage(safeImageSrc(game.away.logo_url)),
      ]);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = W * SCALE;
      canvas.height = H * SCALE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(SCALE, SCALE);
      drawCard(ctx, game, brand, flavor, { league, home, away });
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [game, brand, flavor]);

  const withBlob = useCallback((fn: (b: Blob, name: string) => void) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const name = filenameFor(game, brand.line1);
    canvas.toBlob((blob) => {
      // A tainted canvas yields null here. safeImageSrc() should prevent it,
      // but fail loudly rather than silently doing nothing.
      if (!blob) {
        console.error("[ShareCard] toBlob returned null — canvas may be tainted");
        return;
      }
      fn(blob, name);
    }, "image/png");
  }, [game, brand.line1]);

  const onDownload = useCallback(() => withBlob(saveBlob), [withBlob]);

  const onShare = useCallback(() => {
    withBlob((blob, name) => {
      const file = new File([blob], name, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        navigator.share({
          files: [file],
          title: brand.footerName,
          text: `${game.away.name} at ${game.home.name}`,
        }).catch(() => { /* user dismissed */ });
      } else saveBlob(blob, name);
    });
  }, [withBlob, brand.footerName, game.away.name, game.home.name]);

  return (
    <div className="sharecard">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Final score card for ${game.away.name} at ${game.home.name}`}
        style={{ width: "100%", height: "auto", borderRadius: 12, display: "block" }}
      />
      <div className="sharecard-actions">
        {canShareFiles && (
          <button type="button" className="sharecard-btn primary" onClick={onShare} disabled={!ready}>
            Share
          </button>
        )}
        <button type="button" className="sharecard-btn" onClick={onDownload} disabled={!ready}>
          Download
        </button>
      </div>
      <p className="sharecard-hint">Post it to your team&rsquo;s group, or save it to your phone.</p>
    </div>
  );
}
