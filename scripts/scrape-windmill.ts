/**
 * scrape-windmill.ts — migrate the Windmill Fastpitch static site onto league-platform.
 *
 * Windmill already has clean JSON (built travel-first from Ken's real registration), so this is a
 * pure JSON -> CSV/JSON mapper, no HTML scraping. It reads the existing static-site feed and emits
 * the platform's provisioning inputs, preserving EVERY team, game, date, time, field, division, and
 * (for a completed season) score exactly as generated.
 *
 * Source : ../windmill-site/data/games.json      (2027 upcoming — the live season)
 *          ../windmill-site/data/games-2026.json  (2026 completed — pass --season 2026 for the archive)
 * Emits  : data/windmill/{teams.csv, schedule.csv, provision.json}
 *
 * Run from the repo root:  npx tsx scripts/scrape-windmill.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const seasonArg = (process.argv.find((a) => a.startsWith('--season=')) || '').split('=')[1] || '2027';
const SRC = path.resolve(seasonArg === '2026' ? '../windmill-site/data/games-2026.json' : '../windmill-site/data/games.json');
const OUT = path.resolve('data/windmill');

interface Team {
  id: number; name: string; division: string; level: string; level_full: string;
  club: string; coach: string; lead: string; home_field: string; town: string;
}
interface Game {
  id: number; ts: number; date: string; time: string; division: string; round: number;
  home: string; away: string; home_id: number; away_id: number;
  home_score: number | null; away_score: number | null; played: boolean; location: string;
}

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const teamIndex: Team[] = data.teamIndex;
const games: Game[] = data.games;

// --- stable string ids from the numeric ones (must satisfy ^[a-z0-9][a-z0-9_-]*$) ---
function slugify(s: string): string {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'team';
}
const idMap = new Map<number, string>();
const used = new Set<string>();
for (const t of teamIndex) {
  const base = slugify(t.name);
  let s = base, n = 2;
  while (used.has(s)) s = `${base}-${n++}`;
  used.add(s);
  idMap.set(t.id, s);
}

// --- color: deal a Windmill-palette color, cycling within each division ---
const PALETTE = ['#0e3d34', '#1b7d6c', '#c58a1a', '#14564a', '#9c6a10', '#e8a33d', '#1f9d57', '#2b6f61', '#b5791a', '#0f5a4d'];
const divSeen = new Map<string, number>();
function colorFor(div: string): string {
  const i = divSeen.get(div) ?? 0;
  divSeen.set(div, i + 1);
  return PALETTE[i % PALETTE.length]!;
}

// short label: coach surname from "Club - Coach", else first word of club
function abbrev(t: Team): string {
  const parts = t.name.split(' - ');
  const tail = (parts.length > 1 ? parts[parts.length - 1] : (t.club || t.name).split(' ')[0]) ?? '';
  return (tail.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)) || t.name.slice(0, 6);
}

// --- CSV helpers (quote anything with comma/quote/newline — field names carry commas) ---
function cell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const rowOf = (cols: unknown[]) => cols.map(cell).join(',');

// --- date/time conversion ---
const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
let dateFails = 0, timeFails = 0;
function toISODate(dateStr: string, ts: number): string {
  const m = /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/.exec((dateStr || '').trim());
  if (m) {
    const mo = MON[m[1]!];
    if (mo) return `${m[3]}-${mo}-${m[2]!.padStart(2, '0')}`;
  }
  dateFails++;
  return new Date(ts * 1000).toISOString().slice(0, 10); // ts is noon-anchored → UTC day is correct
}
function to24h(timeStr: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((timeStr || '').trim());
  if (!m) { timeFails++; return timeStr; }
  let h = parseInt(m[1]!, 10);
  const ap = m[3]!.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// --- teams.csv ---
const teamHeader = ['id', 'name', 'abbrev', 'division', 'level', 'color', 'logo_url'];
const teamRows = teamIndex.map((t) =>
  rowOf([idMap.get(t.id), t.name, abbrev(t), t.division, t.level, colorFor(t.division), `/windmill/teams/${idMap.get(t.id)}.png`]),
);

// --- schedule.csv ---
let unmatched = 0;
const schedHeader = ['id', 'date', 'time', 'field', 'away_team_id', 'home_team_id', 'week', 'division', 'status', 'away_score', 'home_score'];
const schedRows = games.map((g) => {
  const home = idMap.get(g.home_id), away = idMap.get(g.away_id);
  if (!home || !away) unmatched++;
  const hasScore = g.home_score != null && g.away_score != null;
  const status = g.played && hasScore ? 'final' : 'scheduled';
  return rowOf([
    `g-${String(g.id).padStart(4, '0')}`, toISODate(g.date, g.ts), to24h(g.time), g.location,
    away, home, g.round, g.division, status,
    g.away_score == null ? '' : g.away_score, g.home_score == null ? '' : g.home_score,
  ]);
});

// --- fields: the distinct venue strings, verbatim (the field directory is ported separately) ---
const fields = Array.from(new Set(games.map((g) => g.location))).sort();

// --- provision.json (youth fastpitch config; see DIRECTION memo for the security choices) ---
const provision = {
  league: {
    slug: 'windmill', name: 'Windmill Fastpitch Softball', abbrev: 'WFS',
    sport: 'softball', innings: 7, ruleset: 'fastpitch', linescore_innings: 7,
    stat_columns: [], pitching: { tracked: false },
    rules_flags: { dropped_third_strike: true, balks: false, infield_fly: true },
    flags: { stats_enabled: false, ticker_scroll: true, show_tournaments: true, registration_open: true },
    theme: {
      primary: '#0e3d34', accent: '#c58a1a', secondary: '#e8a33d',
      logo_url: '/windmill/logo.png', banner_url: '/windmill/banner.png', og_image_url: '/windmill/og.png',
    },
    billing: { status: 'trial', paid_through: null, last_payment: null, notes: 'Ken Walters committed at $40/team (Aug 2026); invoice pending' },
    fields,
    captain: { passwordless: true, require_password: true }, // STRICT: a team with no seeded password is refused, never trust-the-URL (youth security). Passwords seeded by scripts/seed-windmill-captains.ts
    admin: { passwordless: true }, // shared-password admin gate for Ken/Barb. Password lives in Vercel env WINDMILL_ADMIN_PASSWORD (prod) or leagues/windmill.admin.password (never in the repo)
    minors: { age_of_majority: 18, cutoff: '12-31', public_age: false, requires_consent: true }, // confirm cutoff w/ Ken
    standings: { scoring: 'pct', tiebreaker: 'rd', exclude_divisions: ['U8 Mach'] }, // 8U Machine keeps no score (blind-draw tournament seed) — never show a standings table for it
    season_year: 2027, season_label: 'Summer 2027',
    about: 'Youth girls fastpitch softball serving Lake Mills and the surrounding southern Wisconsin communities since 1997. Age divisions from 8U through high school, grouped regionally to keep drive times short.',
    nav: {
      hide: ['SFBL', 'Stats', 'Team Stats', 'Player of the Week', 'Player Registration', 'Store', 'Pay Online', 'Availability'],
      add: [
        { label: 'Fields', href: '/fields' },
        { label: 'Divisions', href: '/content/divisions' },
        { label: 'Parents', href: '/content/parents' },
        { label: 'Rules', href: '/rules' }, // dedicated route; reads the seeded page_content/rules ("rules" is a reserved slug so /content/rules 404s)
        { label: 'Alerts', href: '/alerts' }, // parent rainout / league-news email signup (/alerts page ships with the platform)
      ],
    },
    tournaments: { banner_url: '/windmill/tournament-banner.png', events: [{ name: '30th Annual End-of-Year Tournament', when: 'July 30 to August 1, 2027', location: 'Brandt Quirk Park, Watertown' }] },
  },
  teams_csv: './teams.csv',
  schedule_csv: './schedule.csv',
  admins: ['adam.miller.22@gmail.com', 'Windmill_Softball@hotmail.com', 'walters_barbara@hotmail.com'], // Ken + Barb get per-person magic-link admin (granted on first sign-in); shared passwordless admin also on
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'teams.csv'), [rowOf(teamHeader), ...teamRows].join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'schedule.csv'), [rowOf(schedHeader), ...schedRows].join('\n') + '\n');
if (seasonArg !== '2026') {
  fs.writeFileSync(path.join(OUT, 'provision.json'), JSON.stringify(provision, null, 2) + '\n');
}

console.log(`season ${seasonArg} | source ${path.basename(SRC)}`);
console.log(`teams: ${teamRows.length}  games: ${schedRows.length}  fields: ${fields.length}`);
console.log(`checks -> unmatched team refs: ${unmatched}  date parse fails: ${dateFails}  time parse fails: ${timeFails}`);
console.log(`wrote ${OUT}/{teams.csv, schedule.csv${seasonArg !== '2026' ? ', provision.json' : ''}}`);
