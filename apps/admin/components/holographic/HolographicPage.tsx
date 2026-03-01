"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  HoloContext,
  useHoloReducer,
} from "@/hooks/useHolographicState";
import { defaultSection } from "@/lib/holographic/permissions";
import { HoloMap } from "./HoloMap";
import { HoloEditor } from "./HoloEditor";
import type { UserRole } from "@prisma/client";
import type { SectionId } from "@/lib/holographic/permissions";
import type { ReadinessLevel } from "@/hooks/useHolographicState";
import { Map as MapIcon } from "lucide-react";

export interface HoloDomain {
  id: string;
  name: string;
  slug: string;
  institution?: { name: string } | null;
}

interface HolographicPageProps {
  /** Domain ID, or "new" for create mode */
  domainId: string;
  /** All available domains (for domain selector in HoloMap) */
  domains?: HoloDomain[];
  /** Called when user switches domain via selector */
  onDomainChange?: (domainId: string) => void;
}

export function HolographicPage({ domainId, domains, onDomainChange }: HolographicPageProps) {
  const { data: session } = useSession();
  const role = (session?.user?.role as UserRole) ?? "VIEWER";
  const isCreate = domainId === "new";

  const initial = defaultSection(role);
  const ctx = useHoloReducer(role, initial);
  const { state, dispatch } = ctx;

  // Mobile map toggle
  const [mobileMapOpen, setMobileMapOpen] = useState(false);

  // ─── Load domain data ────────────────────────────────
  useEffect(() => {
    if (isCreate) {
      dispatch({ type: "SET_LOADING", loading: false });
      return;
    }

    let cancelled = false;

    async function load() {
      dispatch({ type: "SET_LOADING", loading: true });

      try {
        // Load domain + readiness in parallel
        const [domainRes, readinessRes] = await Promise.all([
          fetch(`/api/domains/${domainId}`),
          fetch(`/api/domains/${domainId}/readiness`),
        ]);

        if (cancelled) return;

        if (!domainRes.ok) {
          dispatch({
            type: "SET_DOMAIN",
            payload: { loading: false },
          });
          return;
        }

        const domainData = await domainRes.json();
        const domain = domainData.domain || domainData;

        // Parse readiness checks + map
        let readinessChecks: Array<{
          id: string;
          name: string;
          passed: boolean;
          severity: string;
          message?: string;
          fixAction?: string;
        }> = [];
        let readinessMap: Record<SectionId, ReadinessLevel> = {
          identity: "none",
          curriculum: "none",
          behavior: "none",
          onboarding: "none",
          channels: "none",
          readiness: "none",
          structure: "none",
          "prompt-preview": "none",
        };

        let readinessSummary = "";

        if (readinessRes.ok) {
          const rd = await readinessRes.json();
          if (rd.checks) {
            readinessChecks = rd.checks;
            readinessMap = mapReadinessToSections(rd.checks);
            const passed = rd.checks.filter((c: any) => c.passed).length;
            readinessSummary = `${passed}/${rd.checks.length} checks passing`;
          }
        }

        // Build summaries from domain data
        const summaries = buildSummaries(domain);
        summaries.readiness = readinessSummary;

        dispatch({
          type: "SET_DOMAIN",
          payload: {
            id: domain.id,
            name: domain.name,
            slug: domain.slug,
            description: domain.description,
            institution: domain.institution || null,
            domainDetail: domain,
            readinessChecks,
            readinessMap,
            summaries,
            sections: {},
            loading: false,
            role,
          },
        });
      } catch {
        if (!cancelled) {
          dispatch({ type: "SET_LOADING", loading: false });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [domainId, isCreate, dispatch, role]);

  // ─── Persist map collapsed state in localStorage ─────
  useEffect(() => {
    const saved = localStorage.getItem("hp.mapCollapsed");
    if (saved === "true") {
      ctx.setMapCollapsed(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("hp.mapCollapsed", String(state.mapCollapsed));
  }, [state.mapCollapsed]);

  // ─── Render ──────────────────────────────────────────

  if (state.loading) {
    return (
      <div className="hp-loading">
        <div className="hf-spinner" />
        <span>Loading{isCreate ? "" : " domain"}\u2026</span>
      </div>
    );
  }

  if (!isCreate && !state.id) {
    return (
      <div className="hp-error">
        <div className="hp-error-title">Domain not found</div>
        <p className="hp-error-desc">
          The domain may have been deleted or you don't have access.
        </p>
      </div>
    );
  }

  return (
    <HoloContext.Provider value={ctx}>
      <div className="hp-container">
        {/* Mobile backdrop */}
        {mobileMapOpen && (
          <div
            className="hp-mobile-backdrop-open"
            onClick={() => setMobileMapOpen(false)}
          />
        )}

        <HoloMap
          mobileOpen={mobileMapOpen}
          domains={domains}
          activeDomainId={domainId}
          onDomainChange={onDomainChange}
        />
        <HoloEditor />

        {/* Mobile FAB */}
        <button
          className="hp-mobile-fab"
          onClick={() => setMobileMapOpen(!mobileMapOpen)}
          title="Toggle map"
        >
          <MapIcon size={20} />
        </button>
      </div>
    </HoloContext.Provider>
  );
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Map readiness check results to section-level statuses.
 * Uses check ID prefixes to bucket into sections.
 */
function mapReadinessToSections(
  checks: Array<{ id: string; passed: boolean; severity: string }>,
): Record<SectionId, ReadinessLevel> {
  const sectionMap: Record<string, SectionId> = {
    identity: "identity",
    archetype: "identity",
    overlay: "identity",
    role: "identity",
    curriculum: "curriculum",
    subject: "curriculum",
    content: "curriculum",
    teaching_point: "curriculum",
    behavior: "behavior",
    tuning: "behavior",
    onboarding: "onboarding",
    welcome: "onboarding",
    flow: "onboarding",
    channel: "channels",
    voice: "channels",
    structure: "structure",
    department: "structure",
    group: "structure",
  };

  const sectionChecks: Record<SectionId, { passed: number; total: number }> = {
    identity: { passed: 0, total: 0 },
    curriculum: { passed: 0, total: 0 },
    behavior: { passed: 0, total: 0 },
    onboarding: { passed: 0, total: 0 },
    channels: { passed: 0, total: 0 },
    readiness: { passed: 0, total: 0 },
    structure: { passed: 0, total: 0 },
    "prompt-preview": { passed: 0, total: 0 },
  };

  for (const check of checks) {
    // Try to match check ID prefix to a section
    const prefix = check.id.split("_")[0];
    const section = sectionMap[prefix] || "readiness";
    sectionChecks[section].total++;
    if (check.passed) sectionChecks[section].passed++;
  }

  // Also count overall for the readiness section
  const allPassed = checks.filter((c) => c.passed).length;
  sectionChecks.readiness = { passed: allPassed, total: checks.length };

  const result: Record<SectionId, ReadinessLevel> = {} as any;
  for (const [section, { passed, total }] of Object.entries(sectionChecks)) {
    if (total === 0) result[section as SectionId] = "none";
    else if (passed === total) result[section as SectionId] = "ready";
    else if (passed >= total * 0.5) result[section as SectionId] = "almost";
    else result[section as SectionId] = "incomplete";
  }

  return result;
}

/**
 * Build summary strings for each section from domain data.
 * Used for map card subtitle text.
 */
function buildSummaries(domain: any): Record<SectionId, string> {
  const subs = domain.subjects?.length ?? 0;
  const pbs = domain.playbooks?.length ?? 0;
  const callers = domain._count?.callers ?? domain.callers?.length ?? 0;

  // Behavior: check for matrix positions in onboardingDefaultTargets
  const targets = domain.onboardingDefaultTargets as Record<string, any> | null;
  const hasMatrixPositions =
    targets?._matrixPositions && Object.keys(targets._matrixPositions).length > 0;

  // Channels: count enabled
  const channels: Array<{ isEnabled: boolean }> = domain.channelConfigs || [];
  const activeChannels = channels.filter((c) => c.isEnabled).length;

  return {
    identity: domain.onboardingIdentitySpec
      ? `${domain.onboardingIdentitySpec.slug}`
      : "No archetype set",
    curriculum: subs > 0
      ? `${subs} subject${subs !== 1 ? "s" : ""}`
      : "No subjects",
    behavior: hasMatrixPositions ? "Tuning configured" : "No tuning set",
    onboarding: domain.onboardingWelcome
      ? "Welcome configured"
      : "No welcome message",
    channels: channels.length > 0
      ? `${activeChannels} of ${channels.length} active`
      : "No channels",
    readiness: "",
    structure: pbs > 0
      ? `${pbs} course${pbs !== 1 ? "s" : ""} \u00B7 ${callers} caller${callers !== 1 ? "s" : ""}`
      : "No courses",
    "prompt-preview": "",
  };
}
