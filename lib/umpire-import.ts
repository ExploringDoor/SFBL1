// ============================================================================
// Umpire roster import.
//
// Adding umpires one at a time is fine for six and miserable for sixty. Every
// assignor already has the list somewhere: an Arbiter or Assignr export, or a
// spreadsheet they have kept for years. This takes that file as it is.
//
// The trap this is written to avoid, learned on the AssignCrew side of the
// house on 2026-09-08: a positional importer ("column 1 is the name, column 2
// is the email") reads a real export SILENTLY WRONG. Arbiter leads with its
// own columns in its own order, so the phone lands in the level, the header
// row is saved as a person, and nothing errors. Match on the HEADING instead,
// show the match, and let the assignor correct it.
//
// No new dependency. league-platform has no CSV parser and this does not
// justify adding one, but it does need to handle a quoted comma, because
// "Kumo, Jim" in a Name column is the common case that breaks naive splitting.
// ============================================================================

export type UmpireField = "name" | "first" | "last" | "email" | "phone" | "level";

/** `name` is a COMBINED column. first/last are used when the export splits
 *  them, which Arbiter does and a hand-kept spreadsheet usually does not. */
export const UMPIRE_FIELDS: UmpireField[] = ["name", "first", "last", "email", "phone", "level"];

export const UMPIRE_FIELD_LABEL: Record<UmpireField, string> = {
  name: "Full name",
  first: "First name (if split)",
  last: "Last name (if split)",
  email: "Email",
  phone: "Phone",
  level: "Level",
};

const ALIASES: Record<UmpireField, string[]> = {
  name: ["name", "full name", "fullname", "full_name", "official", "official name", "umpire",
    "umpire name", "referee", "display name", "contact"],
  first: ["first", "first name", "firstname", "first_name", "fname", "given name", "given"],
  last: ["last", "last name", "lastname", "last_name", "lname", "surname", "family name"],
  email: ["email", "e-mail", "email address", "emailaddress", "email_address", "mail",
    "primary email", "email 1", "email1"],
  phone: ["phone", "cell", "cell phone", "cellphone", "mobile", "mobile phone", "phone number",
    "phone_number", "telephone", "primary phone", "home phone", "cell #", "phone #",
    "contact number"],
  level: ["level", "rank", "classification", "class", "grade", "certification", "cert", "tier",
    "experience", "position", "certification level"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Columns a headerless paste is assumed to be in, matching the order the
 *  add-one-umpire form asks for them. */
const HEADERLESS_ORDER: UmpireField[] = ["name", "email", "phone", "level"];

export type UmpireColumnMap = Record<UmpireField, string>;

const EMPTY_MAP: UmpireColumnMap = {
  name: "", first: "", last: "", email: "", phone: "", level: "",
};

/**
 * Split one line of CSV or TSV, respecting double quotes.
 *
 * Deliberately small rather than a dependency. It handles the case that
 * actually bites, a quoted comma inside a field, plus the "" escape. It does
 * not handle a newline inside a quoted field; a roster export with one of
 * those is rare enough to be worth a clear failure rather than a parser.
 */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Tab wins when there is one, because that is what pasting out of Excel
 *  gives, and those cells routinely contain commas. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return firstLine.includes("\t") ? "\t" : ",";
}

export interface ParsedUmpireTable {
  headers: string[];
  rows: Record<string, string>[];
  /** False when we synthesised column names because there was no header. */
  hadHeader: boolean;
}

function looksLikeHeader(cells: string[]): boolean {
  const known = new Set(Object.values(ALIASES).flat());
  return cells.some((c) => {
    const n = norm(c);
    if (!n) return false;
    return known.has(n) || [...known].some((k) => n.includes(k));
  });
}

export function parseUmpireTable(text: string): ParsedUmpireTable {
  const delimiter = detectDelimiter(text);
  const grid = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => splitDelimited(l, delimiter));
  if (grid.length === 0) return { headers: [], rows: [], hadHeader: false };

  const hadHeader = looksLikeHeader(grid[0]!);
  const base = hadHeader
    ? grid[0]!.map((c, i) => norm(c) || `column ${i + 1}`)
    : grid[0]!.map((_, i) => `column ${i + 1}`);
  // De-duplicate repeated headings so later columns stay addressable.
  const seen = new Map<string, number>();
  const headers = base.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} ${n}`;
  });

  const body = hadHeader ? grid.slice(1) : grid;
  const rows = body.map((cells) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (cells[i] ?? "").trim();
    });
    return o;
  });
  return { headers, rows, hadHeader };
}

/** Exact alias match wins over a substring one, so a "first name" column is
 *  not claimed by the "name" alias before `first` gets a look at it. */
export function guessUmpireMapping(headers: string[], hadHeader: boolean): UmpireColumnMap {
  if (!hadHeader) {
    const m = { ...EMPTY_MAP };
    HEADERLESS_ORDER.forEach((f, i) => {
      if (headers[i]) m[f] = headers[i]!;
    });
    return m;
  }
  const m = { ...EMPTY_MAP };
  const taken = new Set<string>();
  const claim = (f: UmpireField, pick: (h: string) => boolean) => {
    if (m[f]) return;
    const hit = headers.find((h) => !taken.has(h) && pick(norm(h)));
    if (hit) {
      m[f] = hit;
      taken.add(hit);
    }
  };
  // first/last before name: an export with both should use the split pair.
  const order: UmpireField[] = ["first", "last", "email", "phone", "level", "name"];
  for (const f of order) claim(f, (h) => ALIASES[f].includes(h));
  for (const f of order) claim(f, (h) => ALIASES[f].some((a) => h.includes(a)));
  // A combined column is redundant once both halves are mapped.
  if (m.first && m.last) m.name = "";
  return m;
}

/** "Doe, Jane" -> "Jane Doe". Anything else is passed through. */
export function tidyName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s.includes(",")) return s;
  const [lastPart = "", firstPart = ""] = s.split(",").map((p) => p.trim());
  return firstPart ? `${firstPart} ${lastPart}` : lastPart;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PreviewUmpire {
  name: string;
  email: string;
  phone: string;
  level: string;
  /** Blocks import. */
  problems: string[];
  /** Does not block: a value was dropped, or the row is a duplicate. */
  notes: string[];
  skip: boolean;
}

export const isImportableUmpire = (r: PreviewUmpire) => r.problems.length === 0 && !r.skip;

/**
 * Turn mapped rows into umpires, flagging anything that should not be created.
 *
 * Duplicates are SKIPPED rather than rejected. An assignor who added a few
 * umpires by hand and then imports the full roster should end up with the
 * roster, not with two of everybody. Matched on email first, then on name,
 * and repeats within the file are caught too.
 */
export function buildUmpirePreview(
  rows: Record<string, string>[],
  map: UmpireColumnMap,
  existing: { name?: string | null; email?: string | null }[] = [],
): PreviewUmpire[] {
  const seenEmail = new Set(
    existing.map((u) => String(u.email ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const seenName = new Set(
    existing.map((u) => String(u.name ?? "").trim().toLowerCase()).filter(Boolean),
  );

  return rows.map((row) => {
    const get = (f: UmpireField) => (map[f] ? (row[map[f]] ?? "").trim() : "");
    const first = get("first");
    const last = get("last");
    const combined = get("name");
    const name = tidyName(first || last ? `${first} ${last}`.trim() : combined);

    const problems: string[] = [];
    const notes: string[] = [];

    const rawEmail = get("email");
    let email = "";
    if (rawEmail) {
      if (EMAIL_RE.test(rawEmail)) email = rawEmail.toLowerCase();
      else notes.push(`"${rawEmail}" is not an email, left blank`);
    }

    const rawPhone = get("phone");
    const phone = rawPhone.replace(/\D/g, "").length >= 7 ? rawPhone : "";
    if (rawPhone && !phone) notes.push(`"${rawPhone}" is not a phone number, left blank`);

    const level = get("level");

    if (!name) problems.push("no name");

    let skip = false;
    const nameKey = name.toLowerCase();
    if (email && seenEmail.has(email)) {
      skip = true;
      notes.push("already on your roster (same email)");
    } else if (nameKey && seenName.has(nameKey)) {
      skip = true;
      notes.push("already on your roster (same name)");
    }
    if (!skip && problems.length === 0) {
      if (email) seenEmail.add(email);
      if (nameKey) seenName.add(nameKey);
    }

    return { name, email, phone, level, problems, notes, skip };
  });
}

/** True for a binary spreadsheet, checked by magic number: 50 4B 03 04 is ZIP
 *  (.xlsx, .ods) and D0 CF 11 E0 is a legacy .xls. Read as text those give
 *  pages of mojibake, so we say so rather than "importing" it. */
export function looksBinarySpreadsheet(text: string): boolean {
  const at = (i: number) => text.charCodeAt(i);
  const zip = at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04;
  const ole = at(0) === 0xd0 && at(1) === 0xcf && at(2) === 0x11 && at(3) === 0xe0;
  return zip || ole;
}
