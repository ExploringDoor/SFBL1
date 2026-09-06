// Who a league message actually reaches.
//
// Mike, 2026-09-06: "how do I send message to the coach and asst coach? Head
// coach getting the message but not asst coach." The registration form has
// asked for the assistant's email and phone all along, required on Island, and
// the send list simply never read them.
//
// The trap on the way to fixing it: on Island 39 of 64 registrations put the
// HEAD COACH'S OWN address in the assistant box. Adding assistants naively
// doubles the apparent audience and sends some people the same email twice.

import { describe, expect, it } from "vitest";

/** The two rules the route applies, kept pure so they can be tested without
 *  Firestore. Mirrors app/api/admin-broadcast/route.ts. */
const digits = (p: string) => {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};
const e164 = (p: string) => (digits(p).length === 10 ? digits(p) : null);

function isDuplicateOfHead(r: {
  email?: string;
  phone?: string;
  asst_email?: string;
  asst_phone?: string;
}) {
  const he = (r.email ?? "").trim();
  const hp = (r.phone ?? "").trim();
  const ae = (r.asst_email ?? "").trim();
  const ap = (r.asst_phone ?? "").trim();
  const sameEmail = !!ae && ae.toLowerCase() === he.toLowerCase();
  const samePhone = !ap || (e164(ap) ?? ap) === (e164(hp) ?? hp);
  return sameEmail && samePhone;
}

describe("the assistant is a second person", () => {
  it("is kept when they have their own address", () => {
    expect(
      isDuplicateOfHead({
        email: "head@example.com",
        phone: "631-555-0001",
        asst_email: "asst@example.com",
        asst_phone: "631-555-0002",
      }),
    ).toBe(false);
  });

  it("is kept when the mailbox is shared but the mobile is not", () => {
    // A club address on both rows, two different people carrying two phones.
    expect(
      isDuplicateOfHead({
        email: "info@club.com",
        phone: "631-555-0001",
        asst_email: "info@club.com",
        asst_phone: "631-555-0002",
      }),
    ).toBe(false);
  });
});

describe("the assistant who is just the head coach again", () => {
  it("is dropped when both channels repeat, which is most of Island's", () => {
    expect(
      isDuplicateOfHead({
        email: "head@example.com",
        phone: "631-555-0001",
        asst_email: "head@example.com",
        asst_phone: "631-555-0001",
      }),
    ).toBe(true);
  });

  it("is dropped regardless of how the address was capitalised", () => {
    expect(
      isDuplicateOfHead({
        email: "Head@Example.com",
        phone: "6315550001",
        asst_email: "head@example.com",
        asst_phone: "(631) 555-0001",
      }),
    ).toBe(true);
  });

  it("is dropped when the email repeats and no assistant phone was given", () => {
    expect(
      isDuplicateOfHead({
        email: "head@example.com",
        phone: "631-555-0001",
        asst_email: "head@example.com",
      }),
    ).toBe(true);
  });
});

describe("one person, one text", () => {
  it("treats every way of typing a number as the same number", () => {
    const typed = ["631-555-0001", "(631) 555-0001", "6315550001", "1-631-555-0001"];
    expect(new Set(typed.map(e164)).size).toBe(1);
  });

  it("refuses a number that cannot be dialled rather than texting it", () => {
    for (const bad of ["", "555", "abc", "12"]) expect(e164(bad)).toBeNull();
  });
});
