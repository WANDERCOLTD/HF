"use client";

import { useState, useEffect } from "react";
import { useErrorCapture } from "@/contexts/ErrorCaptureContext";
import { FancySelect } from "@/components/shared/FancySelect";
import type { FancySelectOption } from "@/components/shared/FancySelect";
import { SortableList } from "@/components/shared/SortableList";
import { reorderItems } from "@/lib/sortable/reorder";
import { AgentTuner } from "@/components/shared/AgentTuner";
import type { AgentTunerOutput } from "@/lib/agent-tuner/types";
import type { StepProps } from "../types";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";

type FlowPhase = {
  _id: string;
  phase: string;
  duration: string;
  goals: string[];
};

export default function OnboardStep({ setData, getData, onNext, onPrev }: StepProps) {
  const { reportError } = useErrorCapture();
  const subjectId = getData<string>("subjectId");
  const subjectName = getData<string>("subjectName");

  // Domain selection
  const [domainId, setDomainId] = useState<string>(getData<string>("domainId") || "");
  const [domainName, setDomainName] = useState<string>(getData<string>("domainName") || "");
  const [domains, setDomains] = useState<FancySelectOption[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [creatingDomain, setCreatingDomain] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");

  // Onboarding config
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [identitySpecId, setIdentitySpecId] = useState("");
  const [availableSpecs, setAvailableSpecs] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [flowPhases, setFlowPhases] = useState<FlowPhase[]>([]);
  const [behaviorTargets, setBehaviorTargets] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // ── Fetch domains ────────────────────────────────────
  useEffect(() => {
    setLoadingDomains(true);
    fetch("/api/domains")
      .then((r) => r.json())
      .then((data) => {
        const opts: FancySelectOption[] = (data.domains || []).map((d: any) => ({
          value: d.id,
          label: d.name,
          subtitle: d.slug,
        }));
        opts.push({ value: "__create__", label: "+ Create new domain", isAction: true });
        setDomains(opts);

        // Auto-select if subject already linked to a domain
        if (subjectId && !domainId) {
          const linked = (data.domains || []).find((d: any) =>
            d.subjects?.some((s: any) => s.subject?.id === subjectId || s.subjectId === subjectId)
          );
          if (linked) {
            setDomainId(linked.id);
            setDomainName(linked.name);
          }
        }
      })
      .catch((err: unknown) => { reportError(err instanceof Error ? err : String(err), { source: "wizard", step: "onboard" }); })
      .finally(() => setLoadingDomains(false));
  }, [subjectId]);

  // ── Fetch identity specs ─────────────────────────────
  useEffect(() => {
    fetch("/api/specs?role=IDENTITY")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setAvailableSpecs(data.specs || []);
      })
      .catch((err: unknown) => { reportError(err instanceof Error ? err : String(err), { source: "wizard", step: "onboard" }); });
  }, []);

  // ── Load onboarding config when domain is selected ───
  useEffect(() => {
    if (!domainId || domainId === "__create__") return;
    setLoaded(false);
    fetch(`/api/domains/${domainId}/onboarding`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          const d = data.domain;
          setWelcomeMessage(d.onboardingWelcome || "");
          setIdentitySpecId(d.onboardingIdentitySpecId || "");
          if (d.onboardingFlowPhases?.phases) {
            setFlowPhases(d.onboardingFlowPhases.phases.map((p: any) => ({
              ...p,
              _id: p._id || crypto.randomUUID(),
            })));
          } else {
            setFlowPhases([]);
          }
        }
        setLoaded(true);
      })
      .catch((err: unknown) => { reportError(err instanceof Error ? err : String(err), { source: "wizard", step: "onboard" }); setLoaded(true); });
  }, [domainId]);

  // ── Handle domain selection ──────────────────────────
  function handleDomainChange(value: string) {
    if (value === "__create__") {
      setCreatingDomain(true);
      return;
    }
    setDomainId(value);
    const selected = domains.find((d) => d.value === value);
    setDomainName(selected?.label || "");
  }

  // ── Create new domain ────────────────────────────────
  async function handleCreateDomain() {
    if (!newDomainName.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newDomainName.trim(),
          slug: newDomainName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        }),
      });
      const data = await res.json();
      if (data.id) {
        // Link subject to domain if we have a subjectId
        if (subjectId) {
          await fetch(`/api/subjects/${subjectId}/domains`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domainId: data.id }),
          }).catch(() => {}); // non-critical
        }
        setDomainId(data.id);
        setDomainName(newDomainName.trim());
        setDomains((prev) => [
          { value: data.id, label: newDomainName.trim(), subtitle: data.slug },
          ...prev,
        ]);
        setCreatingDomain(false);
        setNewDomainName("");
      } else {
        setError(data.error || "Failed to create domain");
      }
    } catch {
      setError("Failed to create domain");
    }
  }

  // ── Save onboarding + continue ───────────────────────
  async function handleSave() {
    if (!domainId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/domains/${domainId}/onboarding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingWelcome: welcomeMessage || null,
          onboardingIdentitySpecId: identitySpecId || null,
          onboardingFlowPhases: flowPhases.length > 0
            ? { phases: flowPhases.map(({ _id, ...rest }) => rest) }
            : null,
          onboardingDefaultTargets: Object.keys(behaviorTargets).length > 0
            ? Object.fromEntries(
                Object.entries(behaviorTargets).map(([k, v]) => [k, { value: v, confidence: 0.5 }])
              )
            : null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setData("domainId", domainId);
        setData("domainName", domainName);
        onNext();
      } else {
        setError(data.error || "Failed to save onboarding");
      }
    } catch {
      setError("Failed to save onboarding");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px" }}>
        Configure onboarding
      </h2>
      <p style={{ fontSize: 14, color: "var(--text-muted)", margin: "0 0 20px" }}>
        Set up how the first call should go for learners in this domain.
      </p>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: "color-mix(in srgb, var(--status-error-text) 8%, transparent)",
          color: "var(--status-error-text)",
          border: "1px solid color-mix(in srgb, var(--status-error-text) 20%, transparent)",
        }}>
          {error}
        </div>
      )}

      {/* Domain Selection */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
          Which domain is this for?
        </div>
        {creatingDomain ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateDomain(); if (e.key === "Escape") setCreatingDomain(false); }}
              placeholder="Institution name..."
              autoFocus
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 6, fontSize: 13,
                border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                color: "var(--text-primary)",
              }}
            />
            <button onClick={handleCreateDomain}
              style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Create
            </button>
            <button onClick={() => setCreatingDomain(false)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        ) : loadingDomains ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading institutions...</div>
        ) : (
          <FancySelect
            value={domainId}
            onChange={handleDomainChange}
            options={domains}
            placeholder="Select an institution..."
            searchable
          />
        )}
        {domainId && domainName && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            Onboarding will be configured for <strong>{domainName}</strong>
            {subjectName && <> (teaching {subjectName})</>}
          </div>
        )}
      </div>

      {/* Onboarding Config (only show when domain selected and loaded) */}
      {domainId && domainId !== "__create__" && loaded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Welcome Message */}
          <div>
            <FieldHint label="What should the AI say first?" hint={WIZARD_HINTS["onboard.welcomeMessage"]} />
            <textarea
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="Welcome to your first lesson! I'm excited to help you learn..."
              style={{
                width: "100%", minHeight: 100, padding: 12, fontSize: 14,
                border: "1px solid var(--border-default)", borderRadius: 8,
                background: "var(--surface-secondary)", color: "var(--text-primary)",
                fontFamily: "inherit", resize: "vertical", lineHeight: 1.6,
              }}
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              The opening message for first-time callers. Leave blank for the AI to decide.
            </div>
          </div>

          {/* Identity Spec */}
          <div>
            <FieldHint label="AI persona" hint={WIZARD_HINTS["onboard.aiPersona"]} />
            <select
              value={identitySpecId}
              onChange={(e) => setIdentitySpecId(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 6, fontSize: 13,
                border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">Use default identity</option>
              {availableSpecs.map((spec) => (
                <option key={spec.id} value={spec.id}>{spec.name} ({spec.slug})</option>
              ))}
            </select>
          </div>

          {/* Behavior Tuning */}
          <AgentTuner
            context={{ domainName: domainName || undefined, subjectName: subjectName || undefined }}
            onChange={({ parameterMap }: AgentTunerOutput) => setBehaviorTargets(parameterMap)}
          />

          {/* Flow Phases */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
              Onboarding flow phases
            </div>
            <SortableList
              items={flowPhases}
              getItemId={(p) => p._id}
              onReorder={(from, to) => setFlowPhases(reorderItems(flowPhases, from, to))}
              onRemove={(index) => setFlowPhases(flowPhases.filter((_, i) => i !== index))}
              onAdd={() => setFlowPhases([...flowPhases, { _id: crypto.randomUUID(), phase: "", duration: "", goals: [] }])}
              addLabel="+ Add Phase"
              emptyLabel="No phases defined — the AI will use its default onboarding flow."
              renderCard={(phase, index) => (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{
                      width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)", borderRadius: "50%",
                      fontSize: 11, fontWeight: 600, flexShrink: 0,
                    }}>
                      {index + 1}
                    </span>
                    <input
                      type="text"
                      value={phase.phase}
                      onChange={(e) => {
                        const updated = [...flowPhases];
                        updated[index] = { ...updated[index], phase: e.target.value };
                        setFlowPhases(updated);
                      }}
                      placeholder="Phase name (e.g., Welcome)"
                      style={{
                        flex: 1, padding: "4px 8px", borderRadius: 4, fontSize: 13,
                        border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <input
                      type="text"
                      value={phase.duration}
                      onChange={(e) => {
                        const updated = [...flowPhases];
                        updated[index] = { ...updated[index], duration: e.target.value };
                        setFlowPhases(updated);
                      }}
                      placeholder="Duration"
                      style={{
                        width: 80, padding: "4px 8px", borderRadius: 4, fontSize: 13,
                        border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </div>
                  <textarea
                    value={phase.goals.join("\n")}
                    onChange={(e) => {
                      const updated = [...flowPhases];
                      updated[index] = { ...updated[index], goals: e.target.value.split("\n").filter((g) => g.trim()) };
                      setFlowPhases(updated);
                    }}
                    placeholder="Goals (one per line)"
                    rows={2}
                    style={{
                      width: "100%", padding: "4px 8px", borderRadius: 4, fontSize: 12,
                      border: "1px solid var(--border-default)", background: "var(--surface-secondary)",
                      color: "var(--text-primary)", fontFamily: "inherit", resize: "vertical",
                      lineHeight: 1.5,
                    }}
                  />
                </div>
              )}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <button onClick={handleSave} disabled={saving || !domainId}
          style={{
            padding: "12px 32px", borderRadius: 8, border: "none",
            background: "var(--accent-primary)", color: "var(--button-primary-text, #fff)",
            fontSize: 15, fontWeight: 700, cursor: "pointer",
            opacity: saving || !domainId ? 0.6 : 1,
          }}
        >
          {saving ? "Saving..." : "Save & Continue"}
        </button>
        <button onClick={() => { if (domainId) { setData("domainId", domainId); setData("domainName", domainName); } onNext(); }}
          style={{
            padding: "12px 24px", borderRadius: 8,
            border: "1px solid var(--border-default)", background: "transparent",
            color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
          }}
        >
          Skip Onboarding
        </button>
        <button onClick={onPrev}
          style={{
            padding: "12px 24px", borderRadius: 8,
            border: "1px solid var(--border-default)", background: "transparent",
            color: "var(--text-secondary)", fontSize: 14, cursor: "pointer",
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}
