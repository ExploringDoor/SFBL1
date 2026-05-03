"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PublicLeagueConfig } from "./tenants";

interface TenantContextValue {
  tenantId: string | null;
  config: PublicLeagueConfig | null;
}

const TenantContext = createContext<TenantContextValue>({
  tenantId: null,
  config: null,
});

export function TenantProvider({
  tenantId,
  configJson,
  children,
}: {
  tenantId: string | null;
  configJson: string | null;
  children: ReactNode;
}) {
  let config: PublicLeagueConfig | null = null;
  if (configJson) {
    try {
      config = JSON.parse(configJson) as PublicLeagueConfig;
    } catch {
      config = null;
    }
  }
  return (
    <TenantContext.Provider value={{ tenantId, config }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  return useContext(TenantContext);
}
