"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { SortableList } from "@/components/shared/SortableList";
import { reorderItems } from "@/lib/sortable/reorder";
import type { DomainDetail } from "./types";
import { useTerminology } from "@/contexts/TerminologyContext";
import { AgentTuningPanel, type AgentTuningPanelOutput } from "@/components/shared/AgentTuningPanel";
import type { MatrixPosition } from "@/lib/domain/agent-tuning";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import { OnboardingChatPreview } from "@/components/shared/OnboardingChatPreview";

export function OnboardingTabContent({
  domain,
  onDomainRefresh,
  onPreviewPrompt,
  promptPreviewLoading,
}: {
  domain: DomainDetail;
  onDomainRefresh: () => void;
  onPreviewPrompt?: () => void;
  promptPreviewLoading?: boolean;
}) {
  const { terms } = useTerminology();
  // Onboarding editing state
  const [editingOnboarding, setEditingOnboarding] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState({
    welcomeMessage: "",
    identitySpecId: "",
    flowPhases: "",
    defaultTargets: "",
  });
  const [flowPhasesMode, setFlowPhasesMode] = useState<"visual" | "json">("visual");
  const [defaultTargetsMode, setDefaultTargetsMode] = useState<"matrix" | "visual" | "json">("matrix");
  const [structuredPhases, setStructuredPhases] = useState<Array<{
    _id: string;
    phase: string;
    duration: string;
    goals: string[];
    content?: Array<{ mediaId: string; instruction?: string }>;
  }>>([]);
  const [domainMedia, setDomainMedia] = useState<Array<{ id: string; title: string | null; fileName: string; mimeType: string }>>([]);
  const [structuredTargets, setStructuredTargets] = useState<Record<string, { value: number; confidence: number }>>({});
  const [matrixOutput, setMatrixOutput] = useState<AgentTuningPanelOutput | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [onboardingSaveError, setOnboardingSaveError] = useState<string | null>(null);
  const [onboardingSaveSuccess, setOnboardingSaveSuccess] = useState(false);
  const [availableSpecs, setAvailableSpecs] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [personaName, setPersonaName] = useState<string | null>(null);

  // Computed preview values — read from edit state when editing, domain data when viewing
  const previewPhases = editingOnboarding
    ? structuredPhases.map(({ _id, ...rest }) => rest)
    : (domain.onboardingFlowPhases as any)?.phases || [];
  const previewGreeting = editingOnboarding
    ? onboardingForm.welcomeMessage
    : domain.onboardingWelcome || '';

  // Scaffolding task tracking
  const [scaffoldingTasks, setScaffoldingTasks] = useState<Array<{
    id: string;
    status: string;
    context?: Record<string, any>;
  }>>([]);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);

  // Fetch scaffolding tasks in progress
  const fetchScaffoldingTasks = async () => {
    try {
      const res = await fetch("/api/tasks?status=in_progress");
      const data = await res.json();
      if (data.ok && data.tasks) {
        const tasks = data.tasks.filter((t: any) =>
          t.taskType === "scaffolding" && t.context?.domainId === domain.id
        );
        setScaffoldingTasks(tasks);

        // Stop polling if no more in-progress tasks
        if (tasks.length === 0 && pollInterval) {
          clearInterval(pollInterval);
          setPollInterval(null);
        }
      }
    } catch (err) {
      console.warn("[OnboardingTab] Failed to fetch scaffolding tasks:", err);
    }
  };

  // Poll for scaffolding tasks
  useEffect(() => {
    fetchScaffoldingTasks();

    const startedAt = Date.now();
    const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

    if (scaffoldingTasks.length > 0 && !pollInterval) {
      const interval = setInterval(() => {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          clearInterval(interval);
          setPollInterval(null);
          return;
        }
        fetchScaffoldingTasks();
      }, 2000);
      setPollInterval(interval);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [domain.id]);

  // Fetch onboarding data on mount
  useEffect(() => {
    fetch(`/api/domains/${domain.id}/onboarding`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          // Extract persona name from identity spec
          const specName = data.domain?.onboardingIdentitySpec?.name;
          if (specName) {
            setPersonaName(specName.replace(/ Identity$/i, ''));
          }
          // Notify parent to refresh domain with onboarding data
          onDomainRefresh();
        }
      })
      .catch((err) => {
        console.error("Error fetching onboarding data:", err);
      });
  }, [domain.id]);

  // Fetch available identity specs
  useEffect(() => {
    if (availableSpecs.length === 0) {
      fetch("/api/specs?role=IDENTITY")
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setAvailableSpecs(data.specs || []);
          }
        })
        .catch((e) => console.warn("[Domains] Failed to load specs:", e));
    }
  }, [availableSpecs.length]);

  // Fetch domain media for onboarding phase content picker
  useEffect(() => {
    if (editingOnboarding && domain) {
      const subjectIds = ((domain as any).subjects || []).map((s: any) => s.subject?.id || s.subjectId);
      const validIds = subjectIds.filter(Boolean);
      if (validIds.length === 0) { setDomainMedia([]); return; }
      Promise.all(
        validIds.map((sid: string) =>
          fetch(`/api/subjects/${sid}/media`).then((r) => r.json())
        )
      ).then((results) => {
        const allMedia: Array<{ id: string; title: string | null; fileName: string; mimeType: string }> = [];
        const seen = new Set<string>();
        for (const result of results) {
          for (const item of result.media || []) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              allMedia.push({ id: item.id, title: item.title, fileName: item.fileName, mimeType: item.mimeType });
            }
          }
        }
        setDomainMedia(allMedia);
      }).catch(() => setDomainMedia([]));
    }
  }, [editingOnboarding, domain?.id]);

  // Populate form when entering edit mode - fetch onboarding data to get identity spec
  useEffect(() => {
    if (editingOnboarding && domain) {
      // Fetch full onboarding config including identity spec relation
      fetch(`/api/domains/${domain.id}/onboarding`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            const onboardingData = data.domain;
            const flowPhasesJson = onboardingData.onboardingFlowPhases ? JSON.stringify(onboardingData.onboardingFlowPhases, null, 2) : "";
            const defaultTargetsJson = onboardingData.onboardingDefaultTargets ? JSON.stringify(onboardingData.onboardingDefaultTargets, null, 2) : "";

            setOnboardingForm({
              welcomeMessage: onboardingData.onboardingWelcome || "",
              identitySpecId: onboardingData.onboardingIdentitySpecId || "",
              flowPhases: flowPhasesJson,
              defaultTargets: defaultTargetsJson,
            });

            // Parse structured data
            if (onboardingData.onboardingFlowPhases?.phases) {
              setStructuredPhases(onboardingData.onboardingFlowPhases.phases.map((p: any) => ({ ...p, _id: p._id || crypto.randomUUID() })));
            } else {
              setStructuredPhases([]);
            }

            if (onboardingData.onboardingDefaultTargets) {
              setStructuredTargets(onboardingData.onboardingDefaultTargets);
            } else {
              setStructuredTargets({});
            }
          }
        })
        .catch((err) => {
          console.error("Error fetching onboarding config:", err);
          // Fallback to existing domain data if fetch fails
          const flowPhasesJson = domain.onboardingFlowPhases ? JSON.stringify(domain.onboardingFlowPhases, null, 2) : "";
          const defaultTargetsJson = domain.onboardingDefaultTargets ? JSON.stringify(domain.onboardingDefaultTargets, null, 2) : "";

          setOnboardingForm({
            welcomeMessage: domain.onboardingWelcome || "",
            identitySpecId: "",
            flowPhases: flowPhasesJson,
            defaultTargets: defaultTargetsJson,
          });
        });
    }
  }, [editingOnboarding, domain?.id]);

  const handleSaveOnboarding = async () => {
    setSavingOnboarding(true);
    setOnboardingSaveError(null);
    setOnboardingSaveSuccess(false);

    try {
      // Parse JSON fields or use structured data
      let flowPhases = null;
      let defaultTargets = null;

      if (flowPhasesMode === "visual") {
        // Use structured phases (strip transient _id before saving)
        if (structuredPhases.length > 0) {
          flowPhases = { phases: structuredPhases.map(({ _id, ...rest }) => rest) };
        }
      } else {
        // Parse JSON
        if (onboardingForm.flowPhases.trim()) {
          try {
            flowPhases = JSON.parse(onboardingForm.flowPhases);
          } catch (e) {
            throw new Error("Invalid JSON in Flow Phases");
          }
        }
      }

      if (defaultTargetsMode === "matrix" && matrixOutput) {
        // Matrix mode: derive targets from matrix positions
        const matrixDerived: Record<string, { value: number; confidence: number }> = {};
        for (const [paramId, value] of Object.entries(matrixOutput.parameterMap)) {
          matrixDerived[paramId] = { value, confidence: 0.5 };
        }
        // Merge matrix targets with any manually-set structured targets (manual wins)
        defaultTargets = { ...matrixDerived, ...structuredTargets };
        // Stash matrix positions for round-trip
        (defaultTargets as any)._matrixPositions = matrixOutput.matrixPositions;
      } else if (defaultTargetsMode === "visual") {
        // Use structured targets
        if (Object.keys(structuredTargets).length > 0) {
          defaultTargets = structuredTargets;
        }
      } else {
        // Parse JSON
        if (onboardingForm.defaultTargets.trim()) {
          try {
            defaultTargets = JSON.parse(onboardingForm.defaultTargets);
          } catch (e) {
            throw new Error("Invalid JSON in Default Targets");
          }
        }
      }

      const res = await fetch(`/api/domains/${domain.id}/onboarding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingWelcome: onboardingForm.welcomeMessage || null,
          onboardingIdentitySpecId: onboardingForm.identitySpecId || null,
          onboardingFlowPhases: flowPhases,
          onboardingDefaultTargets: defaultTargets,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Failed to save onboarding configuration");
      }

      // Refresh domain data via parent callback
      onDomainRefresh();

      setOnboardingSaveSuccess(true);
      setEditingOnboarding(false);

      // Clear success message after 3 seconds
      setTimeout(() => setOnboardingSaveSuccess(false), 3000);
    } catch (e: any) {
      setOnboardingSaveError(e.message || "Failed to save");
    } finally {
      setSavingOnboarding(false);
    }
  };

  return (
                <div>
                  {/* Scaffolding Progress */}
                  {scaffoldingTasks.length > 0 && (
                    <div className="hf-banner hf-banner-info hf-mb-lg" style={{ flexDirection: "column", alignItems: "stretch" }}>
                      <div className="hf-flex hf-gap-sm hf-mb-md">
                        <div style={{ fontSize: 16 }}>&#x2699;&#xFE0F;</div>
                        <h4 className="hf-section-title" style={{ margin: 0 }}>
                          Setting up curriculum
                        </h4>
                      </div>

                      {scaffoldingTasks.map(task => (
                        <div key={task.id} className="hf-card-compact" style={{
                          border: "1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent)",
                        }}>
                          {/* Task progress */}
                          <div className="hf-flex hf-gap-sm hf-mb-sm" style={{ gap: 10 }}>
                            {task.status === "in_progress" && (
                              <div className="hf-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                            )}
                            {task.status === "completed" && <div>&#x2705;</div>}
                            {task.status === "abandoned" && <div>&#x26A0;&#xFE0F;</div>}
                            {!["in_progress", "completed", "abandoned"].includes(task.status) && <div>&#x2753;</div>}

                            <span className="hf-text-sm hf-text-secondary">
                              {task.context?.message || "Processing..."}
                            </span>
                          </div>

                          {/* Task steps */}
                          {task.status === "in_progress" && (
                            <div className="hf-text-xs hf-text-muted" style={{ marginLeft: 30 }}>
                              Step: <strong>{task.context?.step || "..."}</strong>
                            </div>
                          )}

                          {/* Completion summary */}
                          {task.status === "completed" && task.context?.summary && (
                            <div className="hf-text-sm hf-text-secondary" style={{ marginLeft: 30, padding: "8px 0", fontSize: 12 }}>
                              <div>&#x2713; {terms.playbook}: <strong>{task.context.summary.playbook}</strong></div>
                              <div>&#x2713; {task.context.summary.modules} modules from {task.context.summary.assertions} points</div>
                            </div>
                          )}

                          {/* Error state */}
                          {task.status === "abandoned" && task.context?.error && (
                            <div className="hf-text-error" style={{ fontSize: 12, marginLeft: 30, padding: "8px 0" }}>
                              Error: {task.context.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="hf-flex-between hf-mb-md">
                    <h3 className="hf-text-bold" style={{ margin: 0, fontSize: 16 }}>
                      Onboarding
                    </h3>
                    {!editingOnboarding && (
                      <div className="hf-flex hf-gap-sm">
                        <button
                          className="hf-btn hf-btn-secondary"
                          onClick={onPreviewPrompt}
                          disabled={promptPreviewLoading}
                          style={{
                            color: "var(--accent-primary)",
                            borderColor: "var(--accent-primary)",
                          }}
                        >
                          {promptPreviewLoading ? "Composing..." : "Preview Prompt"}
                        </button>
                        <button
                          className="hf-btn hf-btn-primary"
                          onClick={() => setEditingOnboarding(true)}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Success Message */}
                  {onboardingSaveSuccess && (
                    <div className="hf-banner hf-banner-success">
                      &#x2705; Onboarding configuration saved successfully
                    </div>
                  )}

                  {/* Error Message */}
                  {onboardingSaveError && (
                    <div className="hf-banner hf-banner-error">
                      {onboardingSaveError}
                    </div>
                  )}

                  {editingOnboarding ? (
                    /* Edit Mode — two-column layout */
                    <div className="ob-tab-layout">
                    <div className="ob-tab-edit-col">
                    <div className="hf-card hf-p-20" style={{ borderRadius: 8 }}>
                      {/* #1316 — Renamed "Welcome Message" → "Domain greeting"
                          to disambiguate from the Course-level "Course opening
                          line" (Playbook.welcomeMessage) which overrides this
                          when set. */}
                      <div className="hf-mb-lg" style={{ marginBottom: 20 }}>
                        <FieldHint label="Domain greeting" hint={WIZARD_HINTS["onboard.welcomeMessage"]} labelClass="hf-text-md hf-text-bold hf-mb-sm" />
                        <textarea
                          className="hf-textarea"
                          value={onboardingForm.welcomeMessage}
                          onChange={(e) => setOnboardingForm({ ...onboardingForm, welcomeMessage: e.target.value })}
                          placeholder="Enter the greeting for first-time callers in this domain..."
                          style={{ minHeight: 120 }}
                        />
                        <div className="hf-hint">
                          Used as the first-call greeting for callers in this domain. Course-level &quot;Course opening line&quot; overrides this when set.
                        </div>
                      </div>

                      {/* Persona */}
                      <div style={{ marginBottom: 20 }}>
                        <label className="hf-text-md hf-text-bold hf-mb-sm" style={{ display: "block" }}>
                          Persona
                        </label>
                        <select
                          className="hf-select"
                          value={onboardingForm.identitySpecId}
                          onChange={(e) => setOnboardingForm({ ...onboardingForm, identitySpecId: e.target.value })}
                        >
                          <option value="">Use default persona</option>
                          {availableSpecs.map((spec) => (
                            <option key={spec.id} value={spec.id}>
                              {spec.name} ({spec.slug})
                            </option>
                          ))}
                        </select>
                        <div className="hf-hint">
                          Which persona to use for onboarding conversations
                        </div>
                      </div>

                      {/* Flow Phases */}
                      <div style={{ marginBottom: 20 }}>
                        <div className="hf-flex-between hf-mb-sm">
                          <label className="hf-text-md hf-text-bold">
                            Flow Phases
                          </label>
                          <div className="hf-toggle-group">
                            <button
                              className={`hf-toggle-btn ${flowPhasesMode === "visual" ? "hf-toggle-btn-active" : ""}`}
                              onClick={() => setFlowPhasesMode("visual")}
                            >
                              Visual
                            </button>
                            <button
                              className={`hf-toggle-btn ${flowPhasesMode === "json" ? "hf-toggle-btn-active" : ""}`}
                              onClick={() => setFlowPhasesMode("json")}
                            >
                              JSON
                            </button>
                          </div>
                        </div>

                        {flowPhasesMode === "visual" ? (
                          /* Visual Editor — uses shared SortableList */
                          <div>
                            <SortableList
                              items={structuredPhases}
                              getItemId={(p) => p._id}
                              onReorder={(from, to) => setStructuredPhases(reorderItems(structuredPhases, from, to))}
                              onRemove={(index) => setStructuredPhases(structuredPhases.filter((_, i) => i !== index))}
                              onAdd={() => setStructuredPhases([...structuredPhases, { _id: crypto.randomUUID(), phase: "", duration: "", goals: [] }])}
                              addLabel="+ Add Phase"
                              emptyLabel="No phases defined. Add one to configure the onboarding flow."
                              renderCard={(phase, index) => (
                                <div className="hf-flex-1">
                                  {/* Phase header */}
                                  <div className="hf-flex hf-gap-sm hf-mb-sm">
                                    <div className="hf-number-badge">
                                      {index + 1}
                                    </div>
                                    <span className="hf-label" style={{ marginBottom: 0 }}>
                                      Phase {index + 1}
                                    </span>
                                  </div>
                                  {/* Phase Name + Duration */}
                                  <div className="hf-grid" style={{ gridTemplateColumns: "1fr 150px", gap: 10, marginBottom: 10 }}>
                                    <div>
                                      <label className="hf-label">
                                        Phase Name
                                      </label>
                                      <input
                                        type="text"
                                        className="hf-input"
                                        value={phase.phase}
                                        onChange={(e) => {
                                          const updated = [...structuredPhases];
                                          updated[index] = { ...updated[index], phase: e.target.value };
                                          setStructuredPhases(updated);
                                        }}
                                        placeholder="e.g., welcome, orient, discover"
                                      />
                                    </div>
                                    <div>
                                      <label className="hf-label">
                                        Duration
                                      </label>
                                      <input
                                        type="text"
                                        className="hf-input"
                                        value={phase.duration}
                                        onChange={(e) => {
                                          const updated = [...structuredPhases];
                                          updated[index] = { ...updated[index], duration: e.target.value };
                                          setStructuredPhases(updated);
                                        }}
                                        placeholder="e.g., 2min"
                                      />
                                    </div>
                                  </div>
                                  {/* Goals */}
                                  <div>
                                    <label className="hf-label">
                                      Goals (one per line)
                                    </label>
                                    <textarea
                                      className="hf-textarea"
                                      value={phase.goals.join("\n")}
                                      onChange={(e) => {
                                        const updated = [...structuredPhases];
                                        updated[index] = { ...updated[index], goals: e.target.value.split("\n").filter(g => g.trim()) };
                                        setStructuredPhases(updated);
                                      }}
                                      placeholder="Enter goals for this phase..."
                                      style={{ minHeight: 80, fontSize: 13, lineHeight: 1.6 }}
                                    />
                                  </div>
                                  {/* Content to Share */}
                                  <div className="hf-mt-sm" style={{ marginTop: 10 }}>
                                    <label className="hf-label">
                                      Content to Share
                                    </label>
                                    {(phase.content || []).map((ref, ci) => {
                                      const media = domainMedia.find(m => m.id === ref.mediaId);
                                      return (
                                        <div key={ci} className="hf-attach-row">
                                          <span className="hf-text-md">
                                            {media?.mimeType?.startsWith("image/") ? "\uD83D\uDDBC\uFE0F" : media?.mimeType === "application/pdf" ? "\uD83D\uDCC4" : media?.mimeType?.startsWith("audio/") ? "\uD83D\uDD0A" : "\uD83D\uDCCE"}
                                          </span>
                                          <span className="hf-text-sm hf-truncate hf-flex-1">
                                            {media?.title || media?.fileName || ref.mediaId}
                                          </span>
                                          <input
                                            type="text"
                                            className="hf-input"
                                            value={ref.instruction || ""}
                                            onChange={(e) => {
                                              const updated = [...structuredPhases];
                                              const contentArr = [...(updated[index].content || [])];
                                              contentArr[ci] = { ...contentArr[ci], instruction: e.target.value };
                                              updated[index] = { ...updated[index], content: contentArr };
                                              setStructuredPhases(updated);
                                            }}
                                            placeholder="Instruction (e.g. Share at start of phase)"
                                            style={{ flex: 2, padding: "4px 8px", fontSize: 12 }}
                                          />
                                          <button
                                            className="hf-badge hf-badge-error"
                                            onClick={() => {
                                              const updated = [...structuredPhases];
                                              updated[index] = { ...updated[index], content: (updated[index].content || []).filter((_, i) => i !== ci) };
                                              setStructuredPhases(updated);
                                            }}
                                            style={{ cursor: "pointer", border: "none" }}
                                          >
                                            &#xD7;
                                          </button>
                                        </div>
                                      );
                                    })}
                                    {domainMedia.length > 0 ? (
                                      <select
                                        className="hf-select"
                                        value=""
                                        onChange={(e) => {
                                          if (!e.target.value) return;
                                          const updated = [...structuredPhases];
                                          const existing = updated[index].content || [];
                                          if (existing.some(c => c.mediaId === e.target.value)) return;
                                          updated[index] = { ...updated[index], content: [...existing, { mediaId: e.target.value }] };
                                          setStructuredPhases(updated);
                                        }}
                                        style={{
                                          fontSize: 12,
                                          padding: "6px 8px",
                                          borderStyle: "dashed",
                                          cursor: "pointer",
                                        }}
                                      >
                                        <option value="">+ Attach media to this phase...</option>
                                        {domainMedia
                                          .filter(m => !(phase.content || []).some(c => c.mediaId === m.id))
                                          .map(m => (
                                            <option key={m.id} value={m.id}>
                                              {m.title || m.fileName} ({m.mimeType.split("/")[1]})
                                            </option>
                                          ))
                                        }
                                      </select>
                                    ) : (
                                      <div className="hf-text-xs hf-text-muted hf-text-italic">
                                        No media uploaded to this domain&apos;s subjects yet
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            />
                            <div className="hf-hint hf-mt-sm">
                              Define the onboarding flow phases (leave empty to use defaults)
                            </div>
                          </div>
                        ) : (
                          /* JSON Editor */
                          <div>
                            <textarea
                              className="hf-textarea hf-mono"
                              value={onboardingForm.flowPhases}
                              onChange={(e) => setOnboardingForm({ ...onboardingForm, flowPhases: e.target.value })}
                              placeholder='{"phases": [{"phase": "welcome", "duration": "2min", "goals": ["..."]}]}'
                              style={{ minHeight: 200, fontSize: 13 }}
                            />
                            <div className="hf-hint">
                              Define the onboarding flow phases in JSON format
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Default Targets */}
                      <div style={{ marginBottom: 20 }}>
                        <div className="hf-flex-between hf-mb-sm">
                          <label className="hf-text-md hf-text-bold">
                            Default Behavior Targets
                          </label>
                          <div className="hf-toggle-group">
                            {(["matrix", "visual", "json"] as const).map((mode) => (
                              <button
                                key={mode}
                                className={`hf-toggle-btn ${defaultTargetsMode === mode ? "hf-toggle-btn-active" : ""}`}
                                onClick={() => setDefaultTargetsMode(mode)}
                              >
                                {mode === "matrix" ? "Matrix" : mode === "visual" ? "Visual" : "JSON"}
                              </button>
                            ))}
                          </div>
                        </div>

                        {defaultTargetsMode === "matrix" ? (
                          /* Boston Matrix Editor */
                          <div>
                            <div className="hf-hint hf-mb-md">
                              Drag the dots to set your agent&apos;s style. Click a preset to start from a known personality.
                            </div>
                            <AgentTuningPanel
                              initialPositions={(domain.onboardingDefaultTargets as any)?._matrixPositions}
                              existingParams={
                                Object.keys(structuredTargets).length > 0
                                  ? Object.fromEntries(Object.entries(structuredTargets).map(([k, v]) => [k, v.value]))
                                  : undefined
                              }
                              onChange={setMatrixOutput}
                            />
                          </div>
                        ) : defaultTargetsMode === "visual" ? (
                          /* Visual Editor with Vertical Sliders */
                          <div>
                            <div className="hf-grid hf-gap-md" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                              {Object.entries(structuredTargets).map(([paramId, target]) => (
                              <div
                                key={paramId}
                                className="hf-card hf-p-md"
                                style={{
                                  borderWidth: 2,
                                  borderRadius: 8,
                                  marginBottom: 0,
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                                }}
                              >
                                {/* Header */}
                                <div className="hf-flex-between hf-mb-md">
                                  <span className="hf-text-sm hf-text-bold" style={{ lineHeight: 1.2 }}>
                                    {paramId}
                                  </span>
                                  <button
                                    className="hf-badge hf-badge-error hf-text-xxs"
                                    onClick={() => {
                                      const newTargets = { ...structuredTargets };
                                      delete newTargets[paramId];
                                      setStructuredTargets(newTargets);
                                    }}
                                    style={{ cursor: "pointer", border: "none" }}
                                  >
                                    &#xD7;
                                  </button>
                                </div>

                                {/* Vertical Sliders Container */}
                                <div className="hf-flex hf-flex-1" style={{ justifyContent: "space-around", alignItems: "flex-end", gap: 20 }}>
                                  {/* Value Slider */}
                                  <div className="hf-flex-col hf-items-center hf-flex-1">
                                    <label className="hf-label hf-text-xxs" style={{ marginBottom: 6 }}>
                                      Value
                                    </label>
                                    <span className="hf-mono hf-mb-sm" style={{
                                      fontSize: 15,
                                      fontWeight: 700,
                                      color: "var(--accent-primary)",
                                      minHeight: 20,
                                    }}>
                                      {target.value.toFixed(2)}
                                    </span>

                                    {/* Vertical Slider Wrapper */}
                                    <div style={{ height: 180 }} className="hf-flex-col hf-relative" >
                                      {/* Scale markers */}
                                      <div className="hf-text-muted" style={{ position: "absolute", right: -24, top: -6, fontSize: 9 }}>1.0</div>
                                      <div className="hf-text-muted" style={{ position: "absolute", right: -24, top: 84, fontSize: 9 }}>0.5</div>
                                      <div className="hf-text-muted" style={{ position: "absolute", right: -24, bottom: -6, fontSize: 9 }}>0.0</div>

                                      {/* Vertical range input */}
                                      <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={target.value}
                                        onChange={(e) => {
                                          const newTargets = { ...structuredTargets };
                                          newTargets[paramId].value = parseFloat(e.target.value);
                                          setStructuredTargets(newTargets);
                                        }}
                                        style={{
                                          WebkitAppearance: "slider-vertical",
                                          width: 6,
                                          height: 180,
                                          borderRadius: 3,
                                          background: `linear-gradient(to top, var(--accent-primary) 0%, var(--accent-primary) ${target.value * 100}%, var(--surface-tertiary) ${target.value * 100}%, var(--surface-tertiary) 100%)`,
                                          outline: "none",
                                          cursor: "pointer",
                                          writingMode: "vertical-lr" as React.CSSProperties["writingMode"],
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {/* Confidence Slider */}
                                  <div className="hf-flex-col hf-items-center hf-flex-1">
                                    <label className="hf-label hf-text-xxs" style={{ marginBottom: 6 }}>
                                      Confidence
                                    </label>
                                    <span className="hf-mono hf-mb-sm" style={{
                                      fontSize: 15,
                                      fontWeight: 700,
                                      color: "var(--accent-primary)",
                                      minHeight: 20,
                                    }}>
                                      {target.confidence.toFixed(2)}
                                    </span>

                                    {/* Vertical Slider Wrapper */}
                                    <div style={{ height: 180 }} className="hf-flex-col hf-relative">
                                      {/* Scale markers */}
                                      <div className="hf-text-muted" style={{ position: "absolute", left: -24, top: -6, fontSize: 9 }}>1.0</div>
                                      <div className="hf-text-muted" style={{ position: "absolute", left: -24, top: 84, fontSize: 9 }}>0.5</div>
                                      <div className="hf-text-muted" style={{ position: "absolute", left: -24, bottom: -6, fontSize: 9 }}>0.0</div>

                                      {/* Vertical range input */}
                                      <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={target.confidence}
                                        onChange={(e) => {
                                          const newTargets = { ...structuredTargets };
                                          newTargets[paramId].confidence = parseFloat(e.target.value);
                                          setStructuredTargets(newTargets);
                                        }}
                                        style={{
                                          WebkitAppearance: "slider-vertical",
                                          width: 6,
                                          height: 180,
                                          borderRadius: 3,
                                          background: `linear-gradient(to top, var(--accent-primary) 0%, var(--accent-primary) ${target.confidence * 100}%, var(--surface-tertiary) ${target.confidence * 100}%, var(--surface-tertiary) 100%)`,
                                          outline: "none",
                                          cursor: "pointer",
                                          writingMode: "vertical-lr" as React.CSSProperties["writingMode"],
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Add Parameter Section */}
                          <div className="hf-mt-md">
                            <div className="hf-flex hf-gap-sm">
                              <input
                                type="text"
                                id="newParamId"
                                className="hf-input hf-flex-1"
                                placeholder="Parameter ID (e.g., warmth)"
                              />
                              <button
                                className="hf-btn hf-btn-primary"
                                onClick={() => {
                                  const input = document.getElementById("newParamId") as HTMLInputElement;
                                  const paramId = input.value.trim();
                                  if (paramId && !structuredTargets[paramId]) {
                                    setStructuredTargets({
                                      ...structuredTargets,
                                      [paramId]: { value: 0.5, confidence: 0.3 },
                                    });
                                    input.value = "";
                                  }
                                }}
                                style={{ padding: "10px 20px" }}
                              >
                                Add Parameter
                              </button>
                            </div>
                            <div className="hf-hint hf-mt-sm">
                              Default behavior parameter values for first-time callers (leave empty to use defaults)
                            </div>
                          </div>
                          </div>
                        ) : (
                          /* JSON Editor */
                          <div>
                            <textarea
                              className="hf-textarea hf-mono"
                              value={onboardingForm.defaultTargets}
                              onChange={(e) => setOnboardingForm({ ...onboardingForm, defaultTargets: e.target.value })}
                              placeholder='{"warmth": {"value": 0.7, "confidence": 0.3}, ...}'
                              style={{ minHeight: 200, fontSize: 13 }}
                            />
                            <div className="hf-hint">
                              Default behavior parameter values in JSON format
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="hf-flex hf-gap-md hf-justify-end">
                        <button
                          className="hf-btn hf-btn-secondary"
                          onClick={() => {
                            setEditingOnboarding(false);
                            setOnboardingSaveError(null);
                          }}
                          disabled={savingOnboarding}
                        >
                          Cancel
                        </button>
                        <button
                          className="hf-btn hf-btn-primary hf-text-bold"
                          onClick={handleSaveOnboarding}
                          disabled={savingOnboarding}
                          style={{ padding: "10px 24px" }}
                        >
                          {savingOnboarding ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </div>
                    </div>
                    <div className="ob-tab-preview-col">
                      <div className="ob-tab-preview-sticky">
                        <div className="ob-tab-preview-label">First Call Preview</div>
                        <OnboardingChatPreview
                          greeting={previewGreeting}
                          personaName={personaName || undefined}
                          phases={previewPhases}
                          maxHeight={540}
                        />
                      </div>
                    </div>
                    </div>
                  ) : (
                    /* View Mode — two-column layout */
                    <div className="ob-tab-layout">
                    <div className="ob-tab-content-col">

                  {/* Compact entity rows */}
                  <div className="hf-card hf-mb-lg" style={{ padding: 0, overflow: "hidden" }}>
                    {/* Persona */}
                    <div className="hf-list-row" style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>
                        {domain.onboardingIdentitySpec ? "\uD83D\uDC64" : "\u26A0\uFE0F"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="hf-text-sm hf-text-bold">Persona</div>
                        <div className="hf-text-xs hf-text-muted" style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {domain.onboardingIdentitySpec?.name || "Not configured"}
                        </div>
                      </div>
                      <div className="hf-flex hf-gap-sm" style={{ flexShrink: 0 }}>
                        {domain.onboardingIdentitySpec ? (
                          <>
                            <span className="hf-badge hf-badge-success">Set</span>
                            <Link
                              href={`/x/layers?overlayId=${domain.onboardingIdentitySpec.id}`}
                              className="hf-link-pill"
                            >
                              <Layers style={{ width: 12, height: 12 }} />
                              Layers
                            </Link>
                          </>
                        ) : (
                          <span className="hf-badge" style={{ color: "var(--status-error-text)" }}>Required</span>
                        )}
                      </div>
                    </div>

                    {/* #1316 — "Welcome Message" → "Domain greeting" */}
                    <div className="hf-list-row" style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{"\uD83D\uDCAC"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="hf-text-sm hf-text-bold">Domain greeting</div>
                        {domain.onboardingWelcome ? (
                          <div className="hf-text-xs hf-text-muted" style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {"\u201c"}{domain.onboardingWelcome}{"\u201d"}
                          </div>
                        ) : (
                          <div className="hf-text-xs hf-text-muted">
                            Not configured &mdash;{" "}
                            <button className="hf-link-inline" onClick={() => setEditingOnboarding(true)}>
                              add a domain greeting
                            </button>
                          </div>
                        )}
                      </div>
                      <span className={`hf-badge ${domain.onboardingWelcome ? "hf-badge-success" : ""}`} style={{ flexShrink: 0 }}>
                        {domain.onboardingWelcome ? "Set" : "Missing"}
                      </span>
                    </div>

                    {/* Flow Phases */}
                    <div className="hf-list-row" style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{"\uD83D\uDD04"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="hf-text-sm hf-text-bold">Flow Phases</div>
                        <div className="hf-text-xs hf-text-muted">
                          {domain.onboardingFlowPhases
                            ? `${(domain.onboardingFlowPhases as any).phases?.length || 0} phases defined`
                            : "Not configured"}
                        </div>
                      </div>
                      <span className={`hf-badge ${domain.onboardingFlowPhases ? "hf-badge-success" : ""}`} style={{ flexShrink: 0 }}>
                        {domain.onboardingFlowPhases ? "Set" : "Missing"}
                      </span>
                    </div>

                    {/* Default Targets */}
                    <div className="hf-list-row" style={{ padding: "12px 16px", borderBottom: "none" }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{"\u2699\uFE0F"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="hf-text-sm hf-text-bold">Default Targets</div>
                        <div className="hf-text-xs hf-text-muted">
                          {domain.onboardingDefaultTargets
                            ? `${Object.keys(domain.onboardingDefaultTargets as object).filter(k => !k.startsWith("_")).length} parameters`
                            : "Using system defaults"}
                        </div>
                      </div>
                      <span className={`hf-badge ${domain.onboardingDefaultTargets ? "hf-badge-success" : ""}`} style={{ flexShrink: 0 }}>
                        {domain.onboardingDefaultTargets ? "Set" : "System"}
                      </span>
                    </div>
                  </div>

                  {/* Flow Phases — vertical timeline */}
                  {domain.onboardingFlowPhases && (domain.onboardingFlowPhases as any).phases && (
                    <div className="hf-card hf-mb-lg" style={{ padding: 0, overflow: "hidden" }}>
                      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                        <h4 className="hf-text-sm hf-text-bold" style={{ margin: 0 }}>
                          Flow Phases
                        </h4>
                      </div>
                      {((domain.onboardingFlowPhases as any).phases || []).map((phase: any, idx: number) => (
                        <div
                          key={idx}
                          className="hf-list-row"
                          style={{
                            padding: "12px 16px",
                            alignItems: "flex-start",
                            borderBottom: idx === ((domain.onboardingFlowPhases as any).phases.length - 1) ? "none" : undefined,
                          }}
                        >
                          <div className="hf-number-badge" style={{ flexShrink: 0, marginTop: 2 }}>
                            {idx + 1}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="hf-flex hf-gap-sm" style={{ alignItems: "center" }}>
                              <span className="hf-text-sm hf-text-bold hf-capitalize">
                                {phase.phase}
                              </span>
                              {phase.duration && (
                                <span className="hf-badge" style={{ fontSize: 11 }}>
                                  {phase.duration}
                                </span>
                              )}
                            </div>
                            {phase.goals && phase.goals.length > 0 && (
                              <ul style={{
                                margin: "4px 0 0",
                                paddingLeft: 16,
                                fontSize: 12,
                                lineHeight: 1.5,
                                color: "var(--text-muted)",
                              }}>
                                {phase.goals.map((goal: string, gIdx: number) => (
                                  <li key={gIdx}>{goal}</li>
                                ))}
                              </ul>
                            )}
                            {phase.content && phase.content.length > 0 && (
                              <div className="hf-flex hf-gap-xs" style={{ marginTop: 4, flexWrap: "wrap" }}>
                                {phase.content.map((ref: any, cIdx: number) => (
                                  <span key={cIdx} className="hf-badge" style={{ fontSize: 11 }}>
                                    {"\uD83D\uDCCE"} {ref.instruction || "Media"}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Default Targets */}
                  {domain.onboardingDefaultTargets && Object.keys(domain.onboardingDefaultTargets as object).filter(k => !k.startsWith("_")).length > 0 && (
                    <div className="hf-card" style={{ padding: 0, overflow: "hidden", marginBottom: 0 }}>
                      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                        <h4 className="hf-text-sm hf-text-bold" style={{ margin: 0 }}>
                          Default Targets
                        </h4>
                      </div>
                      <div style={{ padding: 16 }}>
                        <div className="hf-grid hf-gap-md" style={{
                          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                        }}>
                          {Object.entries(domain.onboardingDefaultTargets as object)
                            .filter(([k]) => !k.startsWith("_"))
                            .map(([param, data]: [string, any]) => {
                              const value = data.value ?? data;
                              const confidence = data.confidence ?? null;
                              const normalizedValue = typeof value === 'number' ? value : 0;
                              const percentage = Math.round(normalizedValue * 100);

                              return (
                                <div key={param} style={{
                                  padding: "10px 12px",
                                  background: "var(--surface-secondary)",
                                  borderRadius: 8,
                                }}>
                                  <div className="hf-text-xs hf-text-bold hf-capitalize" style={{ marginBottom: 6 }}>
                                    {param.replace(/_/g, " ")}
                                  </div>
                                  <div className="hf-flex" style={{ alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                                    <span style={{
                                      fontSize: 18,
                                      fontWeight: 700,
                                      color: "var(--accent-primary)",
                                    }}>
                                      {percentage}%
                                    </span>
                                  </div>
                                  <div className="hf-progress-track-sm" style={{ marginBottom: confidence !== null ? 4 : 0 }}>
                                    <div className="hf-progress-fill" style={{
                                      width: `${percentage}%`,
                                      background: "var(--accent-primary)",
                                    }} />
                                  </div>
                                  {confidence !== null && (
                                    <div className="hf-text-xs hf-text-muted" style={{ marginTop: 2 }}>
                                      Conf: {Math.round(confidence * 100)}%
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                    <div className="ob-tab-preview-col">
                      <div className="ob-tab-preview-sticky">
                        <div className="ob-tab-preview-label">First Call Preview</div>
                        <OnboardingChatPreview
                          greeting={previewGreeting}
                          personaName={personaName || undefined}
                          phases={previewPhases}
                          maxHeight={540}
                        />
                      </div>
                    </div>
                </div>
                  )}
                </div>
  );
}
