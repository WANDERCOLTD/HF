"use client";

/**
 * Holographic Page — Main Entry Point
 *
 * Fetches all domains, renders the two-pane editor with a domain
 * selector at the top of the HoloMap. No intermediate picker page.
 *
 * - Auto-selects first domain (or URL param if provided)
 * - Domain switching reloads section data in-place
 * - Deep-link: /x/holographic?domain=<uuid>
 */

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Globe, Loader2 } from "lucide-react";
import { HolographicPage } from "@/components/holographic/HolographicPage";
import "../institutions/[id]/holo/holographic-page.css";

export interface DomainItem {
  id: string;
  name: string;
  slug: string;
  institution?: { name: string } | null;
}

export default function HolographicResolver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [domains, setDomains] = useState<DomainItem[] | null>(null);
  const [activeDomainId, setActiveDomainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/domains")
      .then((r) => r.json())
      .then((data) => {
        const list: DomainItem[] = data.domains || data || [];
        setDomains(list);

        // Pick initial domain: URL param → first domain
        const paramDomain = searchParams.get("domain");
        const initial =
          list.find((d) => d.id === paramDomain) ?? list[0] ?? null;
        if (initial) setActiveDomainId(initial.id);
      })
      .catch(() => setError("Failed to load domains"));
  }, [searchParams]);

  const handleDomainChange = useCallback(
    (domainId: string) => {
      setActiveDomainId(domainId);
      // Update URL without navigation
      const url = new URL(window.location.href);
      url.searchParams.set("domain", domainId);
      router.replace(url.pathname + url.search, { scroll: false });
    },
    [router],
  );

  // Loading
  if (!domains && !error) {
    return (
      <div className="hp-loading">
        <Loader2 size={20} className="hf-spinner" />
        <span>Loading domains…</span>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="hp-error">
        <div className="hp-error-title">Could not load domains</div>
        <p className="hp-error-desc">{error}</p>
      </div>
    );
  }

  // No domains
  if (domains && domains.length === 0) {
    return (
      <div className="hp-empty-state">
        <Globe size={40} className="hp-empty-icon" />
        <h2 className="hf-page-title">No domains yet</h2>
        <p className="hp-empty-desc">
          Create a domain to get started with the holographic editor.
        </p>
      </div>
    );
  }

  // Two-pane editor with domain selector
  return (
    <HolographicPage
      domainId={activeDomainId || domains![0].id}
      domains={domains!}
      onDomainChange={handleDomainChange}
    />
  );
}
