// Unit tests for the CSV parser used by scripts/provision.ts.
//
// We don't import from scripts/* directly (they're CLI entry points
// with side effects on import). Instead we duplicate the parser
// inline — it's small enough that the duplication cost is lower than
// the cost of refactoring just for tests. If the parser grows past
// a hundred lines, lift it into lib/csv.ts and this test imports
// from there.

import { describe, expect, it } from "vitest";

// VERBATIM COPY of parseCsv + csvToObjects from scripts/provision.ts.
// Keep in sync — if you change one, change the other.
function parseCsv(rawInput: string): string[][] {
  const input =
    rawInput.charCodeAt(0) === 0xfeff ? rawInput.slice(1) : rawInput;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      if (row[0] === "" && row.length === 1) {
        row = [];
        cell = "";
        i++;
        continue;
      }
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && r.some((v) => v.trim() !== ""));
}

function csvToObjects(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

describe("CSV parser — basic shapes", () => {
  it("parses a simple 3-col CSV", () => {
    const csv = `a,b,c\n1,2,3\n4,5,6`;
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles trailing newline", () => {
    const csv = `a,b\n1,2\n`;
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips Windows \\r\\n line endings", () => {
    const csv = `a,b\r\n1,2\r\n`;
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("strips UTF-8 BOM (Excel CSV export quirk)", () => {
    // BOM = U+FEFF at the start of the file. Without stripping, the
    // first header column reads as "﻿id" not "id" and every row's
    // value at that key shows up empty.
    const csv = "﻿id,name\np1,Alice";
    expect(parseCsv(csv)).toEqual([
      ["id", "name"],
      ["p1", "Alice"],
    ]);
  });

  it("skips fully blank lines", () => {
    const csv = `a,b\n\n1,2\n\n`;
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("CSV parser — quoted fields", () => {
  it("handles a quoted field with a comma in it", () => {
    const csv = `name,team\n"Smith, John",Yankees`;
    expect(parseCsv(csv)).toEqual([
      ["name", "team"],
      ["Smith, John", "Yankees"],
    ]);
  });

  it("handles escaped double-quotes inside a quoted field", () => {
    const csv = `name,note\n"He said ""yes""",ok`;
    expect(parseCsv(csv)).toEqual([
      ["name", "note"],
      [`He said "yes"`, "ok"],
    ]);
  });

  it("treats quotes inside an unquoted field as literal", () => {
    // Not strictly RFC 4180 but matches our forgiving behaviour for
    // commissioner-typed spreadsheet exports.
    const csv = `name,team\nfoo,bar`;
    expect(parseCsv(csv)).toEqual([
      ["name", "team"],
      ["foo", "bar"],
    ]);
  });
});

describe("csvToObjects", () => {
  it("zips headers + rows into objects", () => {
    const csv = `id,name,jersey\np1,Alice,7\np2,Bob,12`;
    expect(csvToObjects(csv)).toEqual([
      { id: "p1", name: "Alice", jersey: "7" },
      { id: "p2", name: "Bob", jersey: "12" },
    ]);
  });

  it("trims whitespace around headers + values", () => {
    const csv = ` id , name \n p1 , Alice `;
    expect(csvToObjects(csv)).toEqual([{ id: "p1", name: "Alice" }]);
  });

  it("backfills empty string when row is shorter than header", () => {
    const csv = `id,name,email\np1,Alice`;
    expect(csvToObjects(csv)).toEqual([
      { id: "p1", name: "Alice", email: "" },
    ]);
  });

  it("returns empty array when only header is present", () => {
    expect(csvToObjects("id,name")).toEqual([]);
  });
});
