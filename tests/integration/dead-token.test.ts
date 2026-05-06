// Tests for lib/notifications/match.ts → DEAD_TOKEN_ERROR_CODES + isDeadTokenError.
//
// Locks the contract that drives the post-fanout dead-token prune:
// only PERMANENTLY-dead-token signals trigger a delete from the
// /notification_tokens collection. False positives here mean LIVE
// devices stop receiving pushes.
//
// Specifically verifies the DVSL peer review §5 fix: `messaging/
// invalid-argument` is NOT in the set, because FCM uses that code
// for both malformed-token AND malformed-payload AND argument errors,
// so pruning on it risks deleting live tokens during any payload bug.

import { describe, expect, it } from "vitest";
import {
  DEAD_TOKEN_ERROR_CODES,
  isDeadTokenError,
} from "@/lib/notifications/match";

describe("DEAD_TOKEN_ERROR_CODES — set contents", () => {
  it("contains the two unambiguous 'token is dead' signals", () => {
    expect(DEAD_TOKEN_ERROR_CODES.has("messaging/registration-token-not-registered")).toBe(true);
    expect(DEAD_TOKEN_ERROR_CODES.has("messaging/invalid-registration-token")).toBe(true);
  });

  it("does NOT contain messaging/invalid-argument (DVSL §5)", () => {
    // FCM uses invalid-argument for malformed PAYLOAD too. Pruning
    // on it risks deleting live tokens during a payload bug.
    expect(DEAD_TOKEN_ERROR_CODES.has("messaging/invalid-argument")).toBe(false);
  });

  it("set has exactly 2 entries (no creep)", () => {
    expect(DEAD_TOKEN_ERROR_CODES.size).toBe(2);
  });
});

describe("isDeadTokenError — match heuristics", () => {
  it("matches FCM 'registration-token-not-registered' error.code path", () => {
    const err = Object.assign(new Error("token gone"), {
      code: "messaging/registration-token-not-registered",
    });
    expect(isDeadTokenError(err)).toBe(true);
  });

  it("matches 'invalid-registration-token' error.code path", () => {
    const err = Object.assign(new Error("bad shape"), {
      code: "messaging/invalid-registration-token",
    });
    expect(isDeadTokenError(err)).toBe(true);
  });

  it("matches the UNREGISTERED string in messages (legacy SDK path)", () => {
    const err = new Error("Requested entity was not found. UNREGISTERED");
    expect(isDeadTokenError(err)).toBe(true);
  });

  it("matches the 'registration-token-not-registered' substring", () => {
    const err = new Error(
      "Notification: messaging/registration-token-not-registered",
    );
    expect(isDeadTokenError(err)).toBe(true);
  });

  it("matches FCM 404 substring (e.g. 'FCM 404 Not Found')", () => {
    const err = new Error("FCM 404 Requested entity was not found.");
    expect(isDeadTokenError(err)).toBe(true);
  });

  it("does NOT match invalid-argument errors (DVSL §5 — risks pruning live tokens)", () => {
    // The most important test in this file. If this ever flips, we
    // risk deleting live FCM tokens whenever a payload bug ships.
    const err = Object.assign(new Error("Invalid value for field"), {
      code: "messaging/invalid-argument",
    });
    expect(isDeadTokenError(err)).toBe(false);
  });

  it("does NOT match generic FCM 500 errors (transient)", () => {
    const err = new Error("FCM 500 internal");
    expect(isDeadTokenError(err)).toBe(false);
  });

  it("does NOT match quota errors", () => {
    const err = Object.assign(new Error("quota exceeded"), {
      code: "messaging/quota-exceeded",
    });
    expect(isDeadTokenError(err)).toBe(false);
  });

  it("returns false for null / undefined / empty error", () => {
    expect(isDeadTokenError(null)).toBe(false);
    expect(isDeadTokenError(undefined)).toBe(false);
    expect(isDeadTokenError(new Error(""))).toBe(false);
  });

  it("handles non-Error objects with a .message string", () => {
    const errLike = { message: "Token UNREGISTERED" };
    expect(isDeadTokenError(errLike)).toBe(true);
  });

  it("handles bare strings being thrown", () => {
    expect(isDeadTokenError("UNREGISTERED")).toBe(true);
    expect(isDeadTokenError("nothing wrong")).toBe(false);
  });
});
