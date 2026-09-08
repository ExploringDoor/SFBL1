// POST /api/admin-umpires — admin-only umpire roster and game assignment.
//
//   { leagueId, action: "save_umpire", umpire }        create / update
//   { leagueId, action: "delete_umpire", umpireId }
//   { leagueId, action: "assign", gameId, umpireIds }  set a game's crew
//   { leagueId, action: "settings", requiredPerGame?, gameMinutes? }
//
// Umpire contact details are stored under `umpires`, which is admin-read only
// in the rules — an official's mobile number is not public information, and
// this collection is never projected onto a public page. That is why there is
// no public umpire route in this file: the /content/umpires page is chapter
// information, not a directory of people.
//
// Assignment validates through lib/umpires before writing, for the same reason
// the schedule generator validates through lib/schedule-conflicts: an umpire
// double-booked across two fields is a game without an official, discovered on
// the morning of.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { hasScope } from "@/lib/admin-roles";
import { esc as escapeHtml, notifyAddress, sendEmail } from "@/lib/email/send";
import {
  renderLine,
  smsFor,
  smsSegments,
  upcomingByUmpire,
  type AssignmentGame,
} from "@/lib/umpire-assignments";
import {
  findUmpireIssues,
  type AssignableGame,
  type Umpire,
} from "@/lib/umpires";

export const runtime = "nodejs";

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CREW = 6;

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  if (!leagueId || !/^[a-z][a-z0-9-]+$/i.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  // SCOPED. hasScope() lets the full admin through as before, and also the one
  // scoped role that declares "umpires" in lib/admin-roles.ts. Every other
  // admin route still tests `!== "admin"` directly and so refuses a scoped
  // caller outright, which is the intended default: access widens only where
  // someone wrote it down.
  if (!hasScope(decoded, leagueId, "umpires")) {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const now = new Date().toISOString();
  const action = String(body.action ?? "");
  const col = db.collection(`leagues/${leagueId}/umpires`);

  // ── roster ────────────────────────────────────────────────────────
  if (action === "save_umpire") {
    const u = (body.umpire ?? {}) as Record<string, unknown>;
    const name = String(u.name ?? "").trim().slice(0, 80);
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    const id =
      typeof u.id === "string" && ID_RE.test(u.id) ? u.id : col.doc().id;
    await col.doc(id).set(
      {
        name,
        level: String(u.level ?? "").trim().slice(0, 40),
        email: String(u.email ?? "").trim().slice(0, 160),
        phone: String(u.phone ?? "").trim().slice(0, 40),
        unavailable: Array.isArray(u.unavailable)
          ? [...new Set(u.unavailable.map(String).filter((d) => DATE_RE.test(d)))].sort()
          : [],
        fields: Array.isArray(u.fields)
          ? [...new Set(u.fields.map((f) => String(f).trim().slice(0, 120)).filter(Boolean))]
          : [],
        active: u.active !== false,
        updated_at: now,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, id });
  }

  // Bulk create from a pasted or uploaded roster. The client has already
  // parsed, mapped and de-duplicated (lib/umpire-import.ts); this validates
  // and writes. One batch so a partial roster cannot land.
  if (action === "import_umpires") {
    const list = Array.isArray(body.umpires) ? body.umpires : [];
    if (list.length === 0 || list.length > 400) {
      return NextResponse.json(
        { error: "Send between 1 and 400 umpires." },
        { status: 400 },
      );
    }
    const batch = db.batch();
    let written = 0;
    for (const raw of list) {
      const u = (raw ?? {}) as Record<string, unknown>;
      const name = String(u.name ?? "").trim().slice(0, 80);
      if (!name) continue; // the client flags these; never write a nameless row
      batch.set(
        col.doc(),
        {
          name,
          level: String(u.level ?? "").trim().slice(0, 40),
          email: String(u.email ?? "").trim().slice(0, 160),
          phone: String(u.phone ?? "").trim().slice(0, 40),
          unavailable: [],
          fields: [],
          active: true,
          updated_at: now,
        },
        { merge: true },
      );
      written++;
    }
    if (written === 0) {
      return NextResponse.json({ error: "Nothing to import." }, { status: 400 });
    }
    await batch.commit();
    return NextResponse.json({ ok: true, imported: written });
  }

  /**
   * Email umpires the games they are on, on demand.
   *
   * Separate from the automatic mail when a crew is assigned. Mike wanted a
   * button he can press after he has finished moving a night around: send one
   * umpire their card, or send everybody theirs. Repeatable on purpose, so a
   * reshuffle can be re-sent.
   *
   * The list is built HERE, from the games collection, not sent by the
   * browser. The client knowing who to mail is fine; the client deciding what
   * somebody's schedule says is not.
   */
  if (action === "email_assignments") {
    const only =
      Array.isArray(body.umpireIds) && body.umpireIds.length > 0
        ? new Set(body.umpireIds.map(String).filter((x) => ID_RE.test(x)))
        : null;

    const [umpSnap2, gamesSnap, teamsSnap] = await Promise.all([
      col.get(),
      db.collection(`leagues/${leagueId}/games`).get(),
      db.collection(`leagues/${leagueId}/teams`).get(),
    ]);

    const teamName = new Map(
      teamsSnap.docs.map((d) => [d.id, String(d.data().name ?? d.id)]),
    );
    // Today in league time. A game earlier today is still worth sending; one
    // from last month is noise, and a season of them would bury the real ones.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    // Shared with the copy-for-texting action below, deliberately: two
    // implementations of "their upcoming games" would eventually disagree.
    const linesFor = upcomingByUmpire(
      gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as AssignmentGame),
      teamName,
      today,
      only ?? undefined,
    );

    const host =
      req.headers.get("origin") ??
      (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
    const byId = new Map(umpSnap2.docs.map((d) => [d.id, d.data()]));

    let sent = 0;
    let noEmail = 0;
    for (const [id, lines] of linesFor) {
      const rec = byId.get(id);
      if (!rec) continue;
      const to = String(rec.email ?? "").trim();
      if (!to) {
        noEmail++;
        continue;
      }
      const name = String(rec.name ?? "").trim();
      const html =
        `<p>Hi ${escapeHtml(name || "there")},</p>` +
        `<p>Here ${lines.length === 1 ? "is the game" : `are the ${lines.length} games`} you are scheduled for.</p>` +
        `<ul>${lines.map((l) => `<li>${escapeHtml(renderLine(l))}</li>`).join("")}</ul>` +
        (host ? `<p><a href="${escapeHtml(host)}/schedule">See the full schedule</a></p>` : "") +
        `<p>If you cannot work one of these, reply to this email and let the office know.</p>`;
      const r = await sendEmail({
        to,
        subject: `Your umpire assignments (${lines.length} game${lines.length === 1 ? "" : "s"})`,
        html,
        ...(notifyAddress() ? { replyTo: notifyAddress()! } : {}),
      }).catch(() => ({ ok: false }) as { ok: boolean });
      if (r.ok) sent++;
    }

    return NextResponse.json({
      ok: true,
      sent,
      noEmail,
      // Nobody matched at all: worth saying, rather than a silent success.
      none: linesFor.size === 0,
    });
  }

  /**
   * Build the text messages, do not send them.
   *
   * Mike sends texts from his own phone, from his own number, because that is
   * the number the umpires already know and reply to. Sending SMS from the
   * platform would mean a Twilio number and 10DLC registration, and the reply
   * would land nowhere. So this composes the message and hands it over to
   * copy, which is the whole ask.
   *
   * Same upcomingByUmpire as the email action, so the two can never disagree
   * about who is on what.
   */
  if (action === "assignment_texts") {
    const [umpSnap3, gamesSnap2, teamsSnap2, cfgSnap2] = await Promise.all([
      col.get(),
      db.collection(`leagues/${leagueId}/games`).get(),
      db.collection(`leagues/${leagueId}/teams`).get(),
      // The league's own document, which is where the display name lives.
      // There is no site_config/branding on these tenants.
      db.doc(`leagues/${leagueId}`).get(),
    ]);
    const teamName2 = new Map(
      teamsSnap2.docs.map((d) => [d.id, String(d.data().name ?? d.id)]),
    );
    const today2 = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const leagueName =
      String(cfgSnap2.data()?.name ?? "").trim() || "the league";

    const lines2 = upcomingByUmpire(
      gamesSnap2.docs.map((d) => ({ id: d.id, ...d.data() }) as AssignmentGame),
      teamName2,
      today2,
    );
    const byId2 = new Map(umpSnap3.docs.map((d) => [d.id, d.data()]));

    const messages = [...lines2]
      .map(([id, lines]) => {
        const rec = byId2.get(id);
        if (!rec) return null;
        const name = String(rec.name ?? "").trim();
        const text = smsFor(name, lines, leagueName);
        return {
          umpireId: id,
          name,
          phone: String(rec.phone ?? "").trim(),
          games: lines.length,
          text,
          chars: text.length,
          segments: smsSegments(text),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a!.name || "").localeCompare(b!.name || ""));

    return NextResponse.json({ ok: true, messages });
  }

  if (action === "delete_umpire") {
    const umpireId = String(body.umpireId ?? "");
    if (!ID_RE.test(umpireId)) {
      return NextResponse.json({ error: "umpireId required" }, { status: 400 });
    }
    // Strip them off any game first, or the schedule keeps pointing at an
    // official who no longer exists and the assignment view shows a blank name.
    const assigned = await db
      .collection(`leagues/${leagueId}/games`)
      .where("umpires", "array-contains", umpireId)
      .get();
    const batch = db.batch();
    assigned.docs.forEach((d) => {
      const cur = (d.data().umpires ?? []) as string[];
      batch.update(d.ref, { umpires: cur.filter((x) => x !== umpireId) });
    });
    batch.delete(col.doc(umpireId));
    await batch.commit();
    return NextResponse.json({ ok: true, unassigned: assigned.size });
  }

  // ── settings ──────────────────────────────────────────────────────
  if (action === "settings") {
    await db.doc(`leagues/${leagueId}/site_config/umpires`).set(
      {
        required_per_game: Math.max(0, Math.min(6, Number(body.requiredPerGame) || 0)),
        game_minutes: Math.max(0, Math.min(360, Number(body.gameMinutes) || 0)),
        updated_at: now,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  }

  // ── assignment ────────────────────────────────────────────────────
  if (action === "assign") {
    const gameId = String(body.gameId ?? "");
    if (!ID_RE.test(gameId)) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }
    const raw = Array.isArray(body.umpireIds) ? body.umpireIds : [];
    const umpireIds = [
      ...new Set(raw.map(String).filter((x) => ID_RE.test(x))),
    ].slice(0, MAX_CREW);

    const gameRef = db.doc(`leagues/${leagueId}/games/${gameId}`);
    const [gameSnap, umpSnap, cfgSnap] = await Promise.all([
      gameRef.get(),
      col.get(),
      db.doc(`leagues/${leagueId}/site_config/umpires`).get(),
    ]);
    if (!gameSnap.exists) {
      return NextResponse.json({ error: "game not found" }, { status: 404 });
    }

    const umpires: Umpire[] = umpSnap.docs.map((d) => {
      const t = d.data();
      return {
        id: d.id,
        name: String(t.name ?? d.id),
        level: t.level ? String(t.level) : null,
        unavailable: Array.isArray(t.unavailable) ? (t.unavailable as string[]) : [],
        fields: Array.isArray(t.fields) ? (t.fields as string[]) : [],
        active: t.active !== false,
      };
    });

    // Validate against the whole schedule, not just this game — a double
    // booking is by definition a relationship between two games.
    const gd = gameSnap.data() ?? {};
    const thisGame: AssignableGame = {
      id: gameId,
      date: String(gd.date ?? "").slice(0, 10),
      time: String(gd.time ?? ""),
      field: String(gd.field ?? ""),
      umpires: umpireIds,
    };
    const dayGames = await db
      .collection(`leagues/${leagueId}/games`)
      .where("date", "==", thisGame.date)
      .get();
    const others: AssignableGame[] = dayGames.docs
      .filter((d) => d.id !== gameId)
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          date: String(x.date ?? "").slice(0, 10),
          time: String(x.time ?? ""),
          field: String(x.field ?? ""),
          umpires: Array.isArray(x.umpires) ? (x.umpires as string[]) : [],
        };
      });

    const gameMinutes = Number(cfgSnap.data()?.game_minutes ?? 0) || 0;
    const issues = findUmpireIssues([thisGame, ...others], umpires, { gameMinutes });
    // Only issues involving THIS game block the save; a pre-existing problem
    // elsewhere on the same day is not this edit's fault.
    const blocking = issues.filter(
      (i) => i.severity === "error" && i.gameIds.includes(gameId),
    );
    if (blocking.length > 0 && body.force !== true) {
      return NextResponse.json(
        { error: blocking[0]!.message, issues: blocking },
        { status: 409 },
      );
    }

    const previous = Array.isArray(gd.umpires) ? gd.umpires.map(String) : [];
    await gameRef.set({ umpires: umpireIds, umpires_updated_at: now }, { merge: true });

    // Tell the umpires they have a game.
    //
    // ONLY THE NEWLY ADDED ONES. Re-saving a crew to swap one person must not
    // re-email the two who were already on it, or an assignor tidying up the
    // week mails the whole roster twice and they stop reading them.
    //
    // Best effort, after the write. An assignment that is made must never be
    // rolled back because mail is down.
    const added = umpireIds.filter((id) => !previous.includes(id));
    if (added.length > 0) {
      try {
        const byId = new Map(umpSnap.docs.map((d) => [d.id, d.data()]));
        const when = [String(gd.date ?? ""), String(gd.time ?? "")]
          .filter(Boolean)
          .join(" at ");
        const where = String(gd.field ?? "");
        const host = req.headers.get("origin") ?? (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
        const link = `${host}/games/${gameId}`;
        for (const id of added) {
          const to = String(byId.get(id)?.email ?? "").trim();
          if (!to) continue;
          const name = String(byId.get(id)?.name ?? "").trim();
          const html =
            `<p>Hi ${escapeHtml(name || "there")},</p>` +
            `<p>You have been assigned to a game.</p>` +
            `<table cellpadding="4">` +
            `<tr><td>When</td><td><strong>${escapeHtml(when || "see the schedule")}</strong></td></tr>` +
            (where ? `<tr><td>Where</td><td>${escapeHtml(where)}</td></tr>` : "") +
            `</table>` +
            `<p><a href="${escapeHtml(link)}">See the game</a></p>` +
            `<p>If you cannot work it, reply to this email and let the office know.</p>`;
          await sendEmail({
            to,
            subject: `Game assignment${when ? `: ${when}` : ""}`,
            html,
            ...(notifyAddress() ? { replyTo: notifyAddress()! } : {}),
          }).catch(() => null);
        }
      } catch {
        /* the crew is assigned whether or not the mail goes out today */
      }
    }
    return NextResponse.json({ ok: true, assigned: umpireIds.length });
  }

  return NextResponse.json(
    { error: "action must be save_umpire | import_umpires | email_assignments | assignment_texts | delete_umpire | assign | settings" },
    { status: 400 },
  );
}
