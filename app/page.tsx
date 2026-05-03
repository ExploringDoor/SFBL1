import { headers } from "next/headers";
import type { PublicLeagueConfig } from "@/lib/tenants";

export default function HomePage() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "(unknown host)";
  const tenantId = h.get("x-tenant-id");
  const configJson = h.get("x-tenant-config-json");

  if (tenantId && configJson) {
    let config: PublicLeagueConfig | null = null;
    try {
      config = JSON.parse(configJson) as PublicLeagueConfig;
    } catch {
      // Malformed header — fall through to bare-apex view rather than crash.
    }
    if (config) return <TenantHome tenantId={tenantId} config={config} host={host} />;
  }

  return <BareApexHome host={host} />;
}

function TenantHome({
  tenantId,
  config,
  host,
}: {
  tenantId: string;
  config: PublicLeagueConfig;
  host: string;
}) {
  const sport = config.sport.charAt(0).toUpperCase() + config.sport.slice(1);
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">{config.name}</h1>
        <p className="text-xl text-slate-700">
          {sport} — {config.innings} innings
        </p>
      </header>

      <section className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs">
        <Row label="tenant id" value={tenantId} />
        <Row label="host" value={host} />
        <Row label="ruleset" value={config.ruleset} />
        <Row label="linescore innings" value={String(config.linescore_innings)} />
        <Row label="stat columns" value={(config.stat_columns ?? []).join(", ")} />
        <Row label="pitching tracked" value={config.pitching?.tracked ? "yes" : "no"} />
        <Row label="billing" value={config.billing?.status ?? "(unset)"} />
      </section>

      <p className="text-xs text-slate-400">
        Tenant config loaded from Firestore via middleware. Phase 1 plumbing verified.
      </p>
    </main>
  );
}

function BareApexHome({ host }: { host: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">League Platform</h1>
      <p className="text-slate-600">Multi-tenant SaaS for amateur sports leagues.</p>
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
        <Row label="host" value={host} />
        <div className="text-slate-500">No tenant resolved — bare apex.</div>
      </section>
      <p className="text-xs text-slate-400">
        After running <code className="rounded bg-slate-100 px-1">npm run seed</code>, visit{" "}
        <code className="rounded bg-slate-100 px-1">sfbl.localhost:3000</code>.
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-slate-500">{label}:</span>{" "}
      <span className="font-semibold">{value}</span>
    </div>
  );
}
