"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "hf.domainScope";

interface DomainScope {
  domainId: string;
  domainName: string;
}

interface DomainScopeContextValue {
  /** Current domain scope, or null if not scoped */
  scope: DomainScope | null;
  /** Convenience boolean */
  isDomainScoped: boolean;
  /** Set active domain scope */
  setDomainScope: (domainId: string, domainName: string) => void;
  /** Clear domain scope */
  clearDomainScope: () => void;
}

const DomainScopeContext = createContext<DomainScopeContextValue | null>(null);

export function DomainScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<DomainScope | null>(null);

  // Hydrate from localStorage on mount (deferred to avoid SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setScope(JSON.parse(stored));
    } catch { /* ignore parse errors */ }
  }, []);

  const setDomainScope = useCallback((domainId: string, domainName: string) => {
    const next = { domainId, domainName };
    setScope(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const clearDomainScope = useCallback(() => {
    setScope(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <DomainScopeContext.Provider value={{
      scope,
      isDomainScoped: scope !== null,
      setDomainScope,
      clearDomainScope,
    }}>
      {children}
    </DomainScopeContext.Provider>
  );
}

export function useDomainScope(): DomainScopeContextValue {
  const ctx = useContext(DomainScopeContext);
  if (!ctx) throw new Error("useDomainScope must be used within DomainScopeProvider");
  return ctx;
}
