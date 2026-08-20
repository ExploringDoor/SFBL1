// GET /api/admin-square-lookup?leagueId=…&begin=…&end=… — every Square payment
// in a date range, with the order line item names attached.
//
// Adam, 2026-08-20: "how am I supposed to know if they paid?"
//
// He could not, from here. The retired hosted payment link
// (/api/square-checkout) recorded nothing this codebase reads, so a team that
// paid through one shows as UNPAID on the Payments tab and there is no field
// anywhere to tell the two apart. The only record is inside Square.
//
// SQUARE_ACCESS_TOKEN is set on the deployment but stored Sensitive in Vercel,
// so it cannot be pulled back to a laptop to run a script against. The server
// already holds it, so the answer has to be asked for from here.
//
// Reads only. Lists payments, then batch-retrieves their orders so the LINE
// ITEM NAME comes back too, which is the only reliable way to tell a hosted
// link payment from one the site already recorded:
//
//   "COYBL 2027 Registration: <team>"  capitalised — hosted link, NOT recorded
//   "coybl registration: <team>"       lowercase   — embedded form, recorded
//
// Matching on the dollar amount does not work: fee tiers repeat, so $438.81 is
// both Bo Jackson's unrecorded link and Prime USA's recorded payment.
//
// Admin only. It exposes payment amounts and payer names.

import { NextResponse } from "next/server";

import { getAdminAuth } from "@/lib/firebase-admin";
import { SQUARE_VERSION, squareApiBase, resolveLocationId } from "@/lib/square";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SquarePayment {
  id?: string;
  created_at?: string;
  status?: string;
  order_id?: string;
  note?: string;
  receipt_url?: string;
  amount_money?: { amount?: number; currency?: string };
  refunded_money?: { amount?: number };
}

const usd = (cents: unknown) => {
  const v = Number(cents);
  return Number.isFinite(v) ? `$${(v / 100).toFixed(2)}` : "";
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(auth.slice(7).trim());
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const url = new URL(req.url);
  const leagueId = url.searchParams.get("leagueId") ?? "";
  if (!/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (claim !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "No Square token on this deployment." }, { status: 500 });
  }

  // Default to the whole window the hosted link could have been used in.
  const begin = url.searchParams.get("begin") || "2026-08-01T00:00:00Z";
  const end = url.searchParams.get("end") || new Date().toISOString();
  const base = squareApiBase();
  const locationId = await resolveLocationId(token, base);

  const headers = {
    "Square-Version": SQUARE_VERSION,
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  // Page through ListPayments. A league's season is a few dozen payments, so
  // the cursor loop is bounded generously rather than tuned.
  const payments: SquarePayment[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({
      begin_time: begin,
      end_time: end,
      sort_order: "ASC",
      limit: "100",
    });
    if (locationId) qs.set("location_id", locationId);
    if (cursor) qs.set("cursor", cursor);

    const res = await fetch(`${base}/v2/payments?${qs}`, { headers, cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Square ListPayments failed`, status: res.status, body: await res.text() },
        { status: 502 },
      );
    }
    const json = (await res.json()) as { payments?: SquarePayment[]; cursor?: string };
    payments.push(...(json.payments ?? []));
    cursor = json.cursor ?? "";
    if (!cursor) break;
  }

  // The line item name lives on the ORDER, not the payment, and it is the only
  // field that distinguishes a hosted link from an embedded form payment.
  const orderIds = [...new Set(payments.map((p) => p.order_id).filter(Boolean))] as string[];
  const itemsByOrder = new Map<string, string[]>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const res = await fetch(`${base}/v2/orders/batch-retrieve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ order_ids: chunk, location_id: locationId ?? undefined }),
      cache: "no-store",
    });
    if (!res.ok) continue; // names are a nicety; never fail the whole lookup
    const json = (await res.json()) as {
      orders?: { id?: string; line_items?: { name?: string }[] }[];
    };
    for (const o of json.orders ?? []) {
      if (!o.id) continue;
      itemsByOrder.set(o.id, (o.line_items ?? []).map((li) => String(li.name ?? "")).filter(Boolean));
    }
  }

  const rows = payments.map((p) => {
    const items = p.order_id ? itemsByOrder.get(p.order_id) ?? [] : [];
    const label = [...items, String(p.note ?? "")].filter(Boolean).join(" | ");
    // Capitalised "... Registration:" is the hosted link's item name. The
    // embedded form writes a lowercase note instead.
    const hostedLink = /Registration:/.test(label) && !/registration:/.test(label.replace(/Registration:/g, ""));
    return {
      at: p.created_at ?? "",
      amount: usd(p.amount_money?.amount),
      refunded: p.refunded_money?.amount ? usd(p.refunded_money.amount) : "",
      status: p.status ?? "",
      label,
      source: hostedLink ? "HOSTED LINK (not recorded on the site)" : "site form",
      receipt: p.receipt_url ?? "",
      id: p.id ?? "",
    };
  });

  return NextResponse.json({
    ok: true,
    location_id: locationId,
    env: process.env.SQUARE_ENV ?? "",
    begin,
    end,
    count: rows.length,
    payments: rows,
  });
}
