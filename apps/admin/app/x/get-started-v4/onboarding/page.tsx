"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, AlertCircle, Play, ExternalLink } from "lucide-react";
import { OnboardingChatPreview, type ChatPhase } from "@/components/shared/OnboardingChatPreview";

// ── Types ──────────────────────────────────────────────

interface PersonaFlow {
  key: string;
  name: string;
  icon: string | null;
  color: { bg: string; border: string; text: string } | null;
  identitySpec: string | null;
  welcomeTemplate: string | null;
  firstCallFlow: { phases: any[]; successMetrics?: string[] } | null;
}

interface PatternFlow {
  key: string;
  phases: Array<{ phase: string; duration: string; action: string }>;
}

interface IdentityFlow {
  specSlug: string;
  name: string;
  firstCallFlow: { description?: string; phases: any[] } | null;
  returningCallFlow: { description?: string; phases: any[] } | null;
}

interface DomainRef {
  id: string;
  name: string;
  slug: string;
}

interface FlowsData {
  personaFlows: PersonaFlow[];
  patternFlows: PatternFlow[];
  genericFirstCallFlow: { phases: any[] } | null;
  identityFlows: IdentityFlow[];
  domains: DomainRef[];
}

// ── Helpers ────────────────────────────────────────────

/** Normalize both flow phase shapes to ChatPhase for OnboardingChatPreview */
function normalizePhase(p: any): ChatPhase {
  if (p.goals && Array.isArray(p.goals)) {
    return { phase: p.phase, duration: p.duration, goals: p.goals, avoid: p.avoid };
  }
  // Action shape → wrap as single goal
  return { phase: p.phase, duration: p.duration, goals: [p.action || ""] };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
}

// ── Main Page ──────────────────────────────────────────

export default function OnboardingFlowsPage() {
  const router = useRouter();
  const [data, setData] = useState<FlowsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Selection state
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [expandedPattern, setExpandedPattern] = useState<string | null>(null);
  const [expandedIdentity, setExpandedIdentity] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  /** Find a suitable caller and open sim with forceFirstCall */
  const handlePreviewInSim = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const url = selectedDomain
        ? `/api/sim/conversations?domainId=${encodeURIComponent(selectedDomain)}`
        : "/api/sim/conversations";
      const res = await fetch(url);
      const d = await res.json();
      if (!d.ok || !d.conversations?.length) {
        alert("No callers available for preview. Create a test caller first.");
        return;
      }
      const callerId = d.conversations[0].callerId;
      const params = new URLSearchParams({ forceFirstCall: "true" });
      if (selectedDomain) params.set("domainId", selectedDomain);
      router.push(`/x/sim/${callerId}?${params.toString()}`);
    } catch {
      alert("Failed to find a caller for preview.");
    } finally {
      setPreviewLoading(false);
    }
  }, [router, selectedDomain]);

  useEffect(() => {
    fetch("/api/onboarding/flows")
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setData(d);
          // Default to first persona
          if (d.personaFlows?.length) setSelectedPersona(d.personaFlows[0].key);
        } else {
          setError(d.error || "Failed to load flows");
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="hf-page">
        <div className="hf-page-header"><h1 className="hf-page-title">Onboarding Flows</h1></div>
        <div className="hf-spinner" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="hf-page">
        <div className="hf-page-header"><h1 className="hf-page-title">Onboarding Flows</h1></div>
        <div className="hf-banner hf-banner--error">{error || "No data"}</div>
      </div>
    );
  }

  const activePersona = data.personaFlows.find(p => p.key === selectedPersona);
  const activePhases = activePersona?.firstCallFlow?.phases?.map(normalizePhase) || [];

  return (
    <div className="hf-page">
      <div className="hf-page-header">
        <div className="ob-header-row">
          <div>
            <h1 className="hf-page-title">Onboarding Flows</h1>
            <p className="hf-page-subtitle">
              All flow definitions across INIT-001 and identity specs.
              First-call flows are editable at domain level; session patterns and returning flows are read-only.
            </p>
          </div>
          <button
            className="hf-btn hf-btn--primary"
            onClick={handlePreviewInSim}
            disabled={previewLoading}
          >
            {previewLoading ? <span className="hf-spinner" style={{ width: 16, height: 16 }} /> : <Play size={16} />}
            Preview in Sim
          </button>
        </div>
      </div>

      {/* ── Section 1: Persona First-Call Flows ── */}
      <section className="hf-card" style={{ marginBottom: 24 }}>
        <div className="ob-section-header">
          <div>
            <h2 className="hf-card-title">First Call Flows</h2>
            <p className="hf-card-subtitle">
              Per-persona onboarding experience from INIT-001.
              Each persona defines how the first conversation unfolds.
            </p>
          </div>
          {data.domains.length > 0 && (
            <div className="ob-domain-context">
              <select
                className="hf-input ob-domain-select"
                value={selectedDomain || ""}
                onChange={e => setSelectedDomain(e.target.value || null)}
              >
                <option value="">Select institution to edit...</option>
                {data.domains.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {selectedDomain && (
                <Link
                  href={`/x/domains/${selectedDomain}?tab=onboarding`}
                  className="hf-btn hf-btn--secondary ob-edit-link"
                >
                  <ExternalLink size={14} /> Edit at institution
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Persona tabs */}
        <div className="ob-persona-tabs">
          {data.personaFlows.map(pf => (
            <button
              key={pf.key}
              className={`ob-persona-tab${selectedPersona === pf.key ? " ob-persona-tab--active" : ""}`}
              onClick={() => setSelectedPersona(pf.key)}
              style={selectedPersona === pf.key && pf.color ? {
                backgroundColor: pf.color.bg,
                borderColor: pf.color.border,
                color: pf.color.text,
              } : undefined}
            >
              {pf.icon && <span className="ob-persona-tab-icon">{pf.icon}</span>}
              {pf.name}
            </button>
          ))}
        </div>

        {/* Active persona preview */}
        {activePersona && (
          <div className="ob-persona-detail">
            <div className="ob-persona-meta">
              {activePersona.identitySpec && (
                <span className="hf-badge hf-badge--muted">{activePersona.identitySpec}</span>
              )}
              {activePersona.firstCallFlow?.successMetrics && (
                <details className="ob-success-metrics">
                  <summary>Success metrics ({activePersona.firstCallFlow.successMetrics.length})</summary>
                  <ul>
                    {activePersona.firstCallFlow.successMetrics.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {activePhases.length > 0 ? (
              <OnboardingChatPreview
                greeting={activePersona.welcomeTemplate || undefined}
                personaName={activePersona.name}
                phases={activePhases}
                maxHeight={500}
              />
            ) : (
              <div className="hf-banner hf-banner--warning">
                <AlertCircle size={16} /> No first-call flow defined for {activePersona.name}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Section 2: Session Patterns ── */}
      <section className="hf-card" style={{ marginBottom: 24 }}>
        <h2 className="hf-card-title">Session Patterns</h2>
        <p className="hf-card-subtitle">
          Runtime session flow templates from INIT-001 patternFlows.
          These drive what happens minute-by-minute in each session type.
          <span className="hf-badge hf-badge--muted" style={{ marginLeft: 8 }}>Read-only</span>
        </p>

        <div className="ob-pattern-grid">
          {data.patternFlows.map(pf => {
            const isOpen = expandedPattern === pf.key;
            return (
              <div key={pf.key} className="ob-pattern-card">
                <button
                  className="ob-pattern-header"
                  onClick={() => setExpandedPattern(isOpen ? null : pf.key)}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span className="ob-pattern-name">{capitalize(pf.key)}</span>
                  <span className="ob-pattern-count">{pf.phases.length} phases</span>
                </button>
                {isOpen && (
                  <div className="ob-pattern-body">
                    <OnboardingChatPreview
                      phases={pf.phases.map(normalizePhase)}
                      maxHeight={400}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Section 3: Identity Spec Flows ── */}
      <section className="hf-card">
        <h2 className="hf-card-title">Returning Call Flows</h2>
        <p className="hf-card-subtitle">
          Session pedagogy from identity specs (TUT-001, COACH-001, etc.).
          Defines how returning callers are handled.
          <span className="hf-badge hf-badge--muted" style={{ marginLeft: 8 }}>Read-only</span>
        </p>

        <div className="ob-identity-list">
          {data.identityFlows.map(idf => {
            const hasFirst = !!idf.firstCallFlow?.phases?.length;
            const hasReturning = !!idf.returningCallFlow?.phases?.length;
            const hasAny = hasFirst || hasReturning;
            const isOpen = expandedIdentity === idf.specSlug;

            return (
              <div key={idf.specSlug} className="ob-identity-item">
                <button
                  className="ob-identity-header"
                  onClick={() => hasAny && setExpandedIdentity(isOpen ? null : idf.specSlug)}
                  disabled={!hasAny}
                >
                  {hasAny ? (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span style={{ width: 16 }} />}
                  <span className="ob-identity-name">{idf.name}</span>
                  <span className="hf-badge hf-badge--muted">{idf.specSlug}</span>
                  {hasFirst && <span className="hf-badge hf-badge--success">First call</span>}
                  {hasReturning && <span className="hf-badge hf-badge--success">Returning</span>}
                  {!hasAny && <span className="hf-badge hf-badge--warning">No flows defined</span>}
                </button>
                {isOpen && hasAny && (
                  <div className="ob-identity-body">
                    {hasFirst && (
                      <div className="ob-identity-flow-section">
                        <h4>First Call Flow</h4>
                        {idf.firstCallFlow?.description && (
                          <p className="ob-identity-flow-desc">{idf.firstCallFlow.description}</p>
                        )}
                        <OnboardingChatPreview
                          phases={idf.firstCallFlow!.phases.map(normalizePhase)}
                          maxHeight={350}
                        />
                      </div>
                    )}
                    {hasReturning && (
                      <div className="ob-identity-flow-section">
                        <h4>Returning Call Flow</h4>
                        {idf.returningCallFlow?.description && (
                          <p className="ob-identity-flow-desc">{idf.returningCallFlow.description}</p>
                        )}
                        <OnboardingChatPreview
                          phases={idf.returningCallFlow!.phases.map(normalizePhase)}
                          maxHeight={350}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
