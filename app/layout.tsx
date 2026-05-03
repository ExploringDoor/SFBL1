import type { Metadata } from "next";
import { headers } from "next/headers";
import { TenantProvider } from "@/lib/tenant-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "League Platform",
  description: "Multi-tenant SaaS for amateur sports leagues.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Headers come from the Edge middleware (`x-tenant-id`, `x-tenant-config-json`).
  // Reading them server-side here keeps client components from having to
  // re-fetch tenant config on every page.
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const configJson = h.get("x-tenant-config-json");

  return (
    <html lang="en">
      <body className="min-h-full bg-white text-slate-900 antialiased">
        <TenantProvider tenantId={tenantId} configJson={configJson}>
          {children}
        </TenantProvider>
      </body>
    </html>
  );
}
