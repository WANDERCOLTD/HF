"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { X, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import "./prompt-tuner.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parameter from the /api/playbooks/:id/targets endpoint */
export interface TunerParameter {
  parameterId: string;
  name: string;
  definition: string | null;
  domainGroup: string | null;
  interpretationHigh: string | null;
  interpretationLow: string | null;
  systemValue: number | null;
  playbookValue: number | null;
  effectiveValue: number;
  effectiveScope: string;
}

/** A pending change the educator has made */
export interface PendingChange {
  type: "target" | "config";
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
  parameterId?: string;
  numericValue?: number;
  configKey?: string;
  configValue?: string;
}

export interface PromptTunerSidebarProps {
  open: boolean;
  llmPrompt: Record<string, any> | null;
  callerId: string;
  callerName: string;
  playbookId: string | null;
  onApplied: (changes: PendingChange[]) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Approach config options
// ---------------------------------------------------------------------------

const STYLE_OPTIONS = [
  { value: "socratic", label: "Socratic", desc: "Lead with questions" },
  { value: "directive", label: "Directive", desc: "Explain first, then check" },
  { value: "reflective", label: "Reflective", desc: "Metacognitive prompts" },
  { value: "open", label: "Open", desc: "Adaptive mix" },
] as const;

const AUDIENCE_OPTIONS = [
  { value: "primary", label: "Primary (5\u201311)" },
  { value: "secondary", label: "Secondary (11\u201316)" },
  { value: "sixth-form", label: "Sixth-form (16\u201319)" },
  { value: "higher-ed", label: "Higher Ed" },
  { value: "adult-professional", label: "Professional" },
  { value: "adult-casual", label: "Casual" },
  { value: "mixed", label: "Mixed / Adaptive" },
] as const;

const MODE_OPTIONS = [
  { value: "recall", label: "Recall", desc: "Spaced retrieval" },
  { value: "comprehension", label: "Comprehension", desc: "Read & discuss" },
  { value: "practice", label: "Practice", desc: "Worked examples" },
  { value: "syllabus", label: "Syllabus", desc: "Structured progression" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: number): string {
  return v.toFixed(2);
}

/** Humanise a BEH-PARAM-NAME into "Param Name" */
function humanise(parameterId: string): string {
  return parameterId
    .replace(/^BEH-/i, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Group parameters by domainGroup, with nice group labels */
function groupParameters(params: TunerParameter[]): { group: string; params: TunerParameter[] }[] {
  const map = new Map<string, TunerParameter[]>();
  for (const p of params) {
    const g = p.domainGroup || "Other";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(p);
  }
  // Sort groups alphabetically, but put "Other" last
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    })
    .map(([group, params]) => ({ group, params }));
}

/** Extract a config value by sniffing the llmPrompt instructions text */
function extractConfigValue(
  llmPrompt: Record<string, any> | null,
  options: readonly { value: string }[],
  instructionKey: string,
  metadataKey: string,
  fallback: string,
): string {
  const instr = llmPrompt?.instructions;
  if (instr?.[instructionKey] && typeof instr[instructionKey] === "string") {
    const text = instr[instructionKey].toLowerCase();
    for (const opt of options) {
      if (text.includes(opt.value)) return opt.value;
    }
  }
  return llmPrompt?.metadata?.[metadataKey] ?? fallback;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptTunerSidebar({
  open,
  llmPrompt,
  callerId,
  callerName,
  playbookId,
  onApplied,
  onClose,
}: PromptTunerSidebarProps): React.ReactElement | null {
  // --- Fetch real parameters from the targets API ---
  const [parameters, setParameters] = useState<TunerParameter[]>([]);
  const [paramsLoading, setParamsLoading] = useState(false);
  const [paramsError, setParamsError] = useState<string | null>(null);

  useEffect(() => {
    if (!playbookId || !open) return;
    let cancelled = false;
    setParamsLoading(true);
    setParamsError(null);

    fetch(`/api/playbooks/${playbookId}/targets`)
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setParameters(result.parameters);
        } else {
          setParamsError(result.error || "Failed to load parameters");
        }
      })
      .catch((err) => {
        if (!cancelled) setParamsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setParamsLoading(false);
      });

    return () => { cancelled = true; };
  }, [playbookId, open]);

  // --- Extract current config from llmPrompt ---
  const currentStyle = useMemo(
    () => extractConfigValue(llmPrompt, STYLE_OPTIONS, "teaching_style", "interactionPattern", "open"),
    [llmPrompt],
  );
  const currentAudience = useMemo(
    () => extractConfigValue(llmPrompt, AUDIENCE_OPTIONS, "audience", "audience", "secondary"),
    [llmPrompt],
  );
  const currentMode = useMemo(
    () => extractConfigValue(llmPrompt, MODE_OPTIONS, "pedagogy_mode", "teachingMode", "comprehension"),
    [llmPrompt],
  );

  // --- Draft state (persists while component is mounted) ---
  const [draftTargets, setDraftTargets] = useState<Record<string, number>>({});
  const [draftStyle, setDraftStyle] = useState(currentStyle);
  const [draftAudience, setDraftAudience] = useState(currentAudience);
  const [draftMode, setDraftMode] = useState(currentMode);
  const [scope, setScope] = useState<"course" | "learner" | null>(null);
  const approachLocked = scope === "learner";
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [activeLearnerCount, setActiveLearnerCount] = useState<number | null>(null);

  // Fetch ACTIVE enrollment count so the Apply button can show consequence up front.
  useEffect(() => {
    if (!playbookId || !open) return;
    let cancelled = false;
    fetch(`/api/playbooks/${playbookId}/enrollments?status=ACTIVE`)
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        const count =
          result?.count ??
          (Array.isArray(result?.enrollments) ? result.enrollments.length : null);
        if (typeof count === "number") setActiveLearnerCount(count);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [playbookId, open]);

  // Reset scope when panel is closed so next open forces a fresh choice.
  useEffect(() => {
    if (!open) setScope(null);
  }, [open]);

  // Sync draft targets from API data (only when params first load, not on every render)
  useEffect(() => {
    if (parameters.length === 0) return;
    setDraftTargets((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of parameters) {
        if (!(p.parameterId in next)) {
          next[p.parameterId] = p.effectiveValue;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [parameters]);

  // Sync config drafts when llmPrompt changes (e.g. after recompose)
  useEffect(() => {
    setDraftStyle(currentStyle);
  }, [currentStyle]);
  useEffect(() => {
    setDraftAudience(currentAudience);
  }, [currentAudience]);
  useEffect(() => {
    setDraftMode(currentMode);
  }, [currentMode]);

  // Flipping to learner scope snaps pending Approach changes back to current —
  // those fields are course-level only and can't be saved per-learner.
  useEffect(() => {
    if (scope === "learner") {
      setDraftStyle(currentStyle);
      setDraftAudience(currentAudience);
      setDraftMode(currentMode);
    }
  }, [scope, currentStyle, currentAudience, currentMode]);

  // Clear stale result/error banner when user starts a new round of changes.
  useEffect(() => {
    if (applyResult) setApplyResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // --- Group parameters ---
  const grouped = useMemo(() => groupParameters(parameters), [parameters]);

  // --- Compute pending changes ---
  const pendingChanges = useMemo(() => {
    const changes: PendingChange[] = [];

    // Target changes
    for (const p of parameters) {
      const draft = draftTargets[p.parameterId];
      if (draft !== undefined && Math.abs(p.effectiveValue - draft) > 0.01) {
        changes.push({
          type: "target",
          key: p.parameterId,
          label: p.name || humanise(p.parameterId),
          oldValue: fmt(p.effectiveValue),
          newValue: fmt(draft),
          parameterId: p.parameterId,
          numericValue: draft,
        });
      }
    }

    // Config changes
    if (draftStyle !== currentStyle) {
      changes.push({
        type: "config", key: "style", label: "Teaching Style",
        oldValue: currentStyle, newValue: draftStyle,
        configKey: "interactionPattern", configValue: draftStyle,
      });
    }
    if (draftAudience !== currentAudience) {
      changes.push({
        type: "config", key: "audience", label: "Audience",
        oldValue: currentAudience, newValue: draftAudience,
        configKey: "audience", configValue: draftAudience,
      });
    }
    if (draftMode !== currentMode) {
      changes.push({
        type: "config", key: "mode", label: "Learning Mode",
        oldValue: currentMode, newValue: draftMode,
        configKey: "teachingMode", configValue: draftMode,
      });
    }

    return changes;
  }, [draftTargets, draftStyle, draftAudience, draftMode, parameters, currentStyle, currentAudience, currentMode]);

  // --- Reset all drafts ---
  const handleDiscard = useCallback(() => {
    const map: Record<string, number> = {};
    for (const p of parameters) {
      map[p.parameterId] = p.effectiveValue;
    }
    setDraftTargets(map);
    setDraftStyle(currentStyle);
    setDraftAudience(currentAudience);
    setDraftMode(currentMode);
    setApplyError(null);
  }, [parameters, currentStyle, currentAudience, currentMode]);

  // --- Apply changes ---
  const handleApply = useCallback(async () => {
    if (!playbookId || !scope || pendingChanges.length === 0) return;
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);

    try {
      const targetChanges = pendingChanges.filter((c) => c.type === "target");
      const configChanges = pendingChanges.filter((c) => c.type === "config");

      // 1. Write target changes — route depends on scope
      if (targetChanges.length > 0) {
        const url =
          scope === "learner"
            ? `/api/callers/${callerId}/behavior-targets`
            : `/api/playbooks/${playbookId}/targets`;
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targets: targetChanges.map((c) => ({
              parameterId: c.parameterId,
              targetValue: c.numericValue,
            })),
          }),
        });
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || "Failed to update targets");
      }

      // 2. Write config changes — playbook config is course-scoped only.
      //    Learner-scoped Approach overrides would need a caller-config concept
      //    which doesn't exist yet — block the save with a clear error.
      if (configChanges.length > 0) {
        if (scope === "learner") {
          throw new Error(
            "Teaching Style / Audience / Mode can only be changed at the course level. " +
              "Switch scope to 'This course' to apply, or discard these changes.",
          );
        }
        const configUpdate: Record<string, string> = {};
        for (const c of configChanges) {
          if (c.configKey && c.configValue) {
            configUpdate[c.configKey] = c.configValue;
          }
        }
        const res = await fetch(`/api/playbooks/${playbookId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: configUpdate }),
        });
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || "Failed to update config");
      }

      // 3. Recompose — single caller on learner scope, fan-out on course scope.
      if (scope === "learner") {
        const res = await fetch(`/api/callers/${callerId}/compose-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triggerType: "TUNER" }),
        });
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || "Failed to recompose");
        setApplyResult(`Applied to ${callerName || "this learner"}. Next prompt updated.`);
      } else {
        const res = await fetch(`/api/playbooks/${playbookId}/recompose-all`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triggerType: "TUNER_FANOUT" }),
        });
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || "Failed to recompose course");
        const { total = 0, succeeded = 0, failed = 0 } = result;
        if (failed > 0) {
          console.warn(`[tuner] Fan-out recompose: ${succeeded}/${total} succeeded`, result.errors);
          setApplyResult(`Applied to ${succeeded} of ${total} learners. ${failed} could not be updated — try again or contact support.`);
        } else {
          setApplyResult(`Applied course-wide. Recomposed ${succeeded} learner${succeeded === 1 ? "" : "s"}.`);
        }
      }

      // 4. Notify parent
      onApplied(pendingChanges);
    } catch (err: any) {
      setApplyError(err.message || "Apply failed");
    } finally {
      setApplying(false);
    }
  }, [playbookId, callerId, callerName, pendingChanges, onApplied, scope]);

  // --- Toggle group collapse ---
  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const hasChanges = pendingChanges.length > 0;

  return (
    <div className={`ps-tuner-sidebar${open ? "" : " ps-tuner-sidebar--hidden"}`}>
      {/* Header */}
      <div className="ps-tuner-header">
        <div className="ps-tuner-header-text">
          <span className="ps-tuner-title">Prompt Tuner</span>
          <span className="ps-tuner-subtitle">
            {scope === null
              ? "Choose who these changes apply to"
              : scope === "course"
              ? `All learners${activeLearnerCount !== null ? ` (${activeLearnerCount})` : ""}`
              : callerName || "This learner"}
            {hasChanges && (
              <span className="ps-tuner-badge">{pendingChanges.length} change{pendingChanges.length !== 1 ? "s" : ""}</span>
            )}
          </span>
        </div>
        <button className="ps-tuner-close" onClick={onClose} aria-label="Close tuner">
          <X size={14} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="ps-tuner-body">
        {/* Step 1: Scope picker — always shown first, required before tuning */}
        <div className="ps-tuner-section ps-tuner-scope-section">
          <div className="ps-tuner-section-title">Apply changes to</div>
          <div className="ps-tuner-scope-cards">
            <button
              type="button"
              className={`ps-tuner-scope-card${scope === "course" ? " ps-tuner-scope-card--active" : ""}`}
              onClick={() => setScope("course")}
            >
              <span className="ps-tuner-scope-card-title">This course</span>
              <span className="ps-tuner-scope-card-desc">
                {activeLearnerCount !== null
                  ? `All ${activeLearnerCount} active learner${activeLearnerCount === 1 ? "" : "s"}`
                  : "All active learners"}
              </span>
            </button>
            <button
              type="button"
              className={`ps-tuner-scope-card${scope === "learner" ? " ps-tuner-scope-card--active" : ""}`}
              onClick={() => setScope("learner")}
            >
              <span className="ps-tuner-scope-card-title">{callerName || "This learner"}</span>
              <span className="ps-tuner-scope-card-desc">Only this learner</span>
            </button>
          </div>
        </div>

        {scope === null ? (
          <div className="ps-tuner-empty-scope">
            Pick a scope above to start tuning.
          </div>
        ) : (
          <>
        {/* Loading / Error */}
        {paramsLoading && (
          <div className="ps-tuner-loading">
            <span className="hf-spinner hf-spinner-sm" />
            Loading parameters...
          </div>
        )}
        {paramsError && (
          <div className="hf-banner hf-banner-error ps-tuner-error">{paramsError}</div>
        )}

        {/* Approach selectors (always shown first — most intuitive) */}
        <div className={`ps-tuner-section${approachLocked ? " ps-tuner-section--locked" : ""}`}>
          <div className="ps-tuner-section-title">
            Approach
            {approachLocked && (
              <span className="ps-tuner-locked-hint">Course-level only</span>
            )}
          </div>
          <div className="ps-tuner-selectors">
            <label className="ps-tuner-select-row">
              <span className="ps-tuner-select-label">Style</span>
              <select
                value={draftStyle}
                onChange={(e) => setDraftStyle(e.target.value)}
                disabled={approachLocked}
                className={`ps-tuner-select${draftStyle !== currentStyle ? " ps-tuner-select--changed" : ""}`}
              >
                {STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="ps-tuner-select-row">
              <span className="ps-tuner-select-label">Audience</span>
              <select
                value={draftAudience}
                onChange={(e) => setDraftAudience(e.target.value)}
                disabled={approachLocked}
                className={`ps-tuner-select${draftAudience !== currentAudience ? " ps-tuner-select--changed" : ""}`}
              >
                {AUDIENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="ps-tuner-select-row">
              <span className="ps-tuner-select-label">Mode</span>
              <select
                value={draftMode}
                onChange={(e) => setDraftMode(e.target.value)}
                disabled={approachLocked}
                className={`ps-tuner-select${draftMode !== currentMode ? " ps-tuner-select--changed" : ""}`}
              >
                {MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Data-driven behavior dials, grouped by domainGroup */}
        {!paramsLoading && grouped.map(({ group, params }) => {
          const isCollapsed = collapsedGroups.has(group);
          const groupChangedCount = params.filter((p) => {
            const draft = draftTargets[p.parameterId];
            return draft !== undefined && Math.abs(p.effectiveValue - draft) > 0.01;
          }).length;

          return (
            <div key={group} className="ps-tuner-section">
              <button
                className="ps-tuner-group-header"
                onClick={() => toggleGroup(group)}
              >
                <span className="ps-tuner-group-chevron">
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </span>
                <span className="ps-tuner-section-title">{group}</span>
                <span className="ps-tuner-group-count">{params.length}</span>
                {groupChangedCount > 0 && (
                  <span className="ps-tuner-group-changed">{groupChangedCount} changed</span>
                )}
              </button>

              {!isCollapsed && (
                <div className="ps-tuner-dials">
                  {params.map((p) => {
                    const draft = draftTargets[p.parameterId] ?? p.effectiveValue;
                    const changed = Math.abs(p.effectiveValue - draft) > 0.01;
                    const lowLabel = p.interpretationLow || "Low";
                    const highLabel = p.interpretationHigh || "High";

                    return (
                      <div
                        key={p.parameterId}
                        className={`ps-tuner-dial${changed ? " ps-tuner-dial--changed" : ""}`}
                        title={p.definition || undefined}
                      >
                        <div className="ps-tuner-dial-header">
                          <span className="ps-tuner-dial-label">
                            {p.name || humanise(p.parameterId)}
                          </span>
                          <span className="ps-tuner-dial-value">{fmt(draft)}</span>
                        </div>
                        <div className="ps-tuner-dial-row">
                          <span className="ps-tuner-dial-low">{lowLabel}</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={draft}
                            aria-label={p.name || humanise(p.parameterId)}
                            aria-valuetext={fmt(draft)}
                            onChange={(e) =>
                              setDraftTargets((prev) => ({
                                ...prev,
                                [p.parameterId]: parseFloat(e.target.value),
                              }))
                            }
                            className="ps-tuner-slider"
                          />
                          <span className="ps-tuner-dial-high">{highLabel}</span>
                        </div>
                        {p.effectiveScope !== "DEFAULT" && (
                          <div className="ps-tuner-dial-scope">
                            {p.effectiveScope === "PLAYBOOK" ? "Course override" : "System default"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Pending changes */}
        {hasChanges && (
          <div className="ps-tuner-section">
            <div className="ps-tuner-section-title">
              Pending Changes ({pendingChanges.length})
            </div>
            <div className="ps-tuner-pending">
              {pendingChanges.map((c) => (
                <div key={c.key} className="ps-tuner-pending-item">
                  <span className="ps-tuner-pending-label">{c.label}</span>
                  <span className="ps-tuner-pending-values">
                    <span className="ps-tuner-pending-old">{c.oldValue}</span>
                    <span className="ps-tuner-pending-arrow">&rarr;</span>
                    <span className="ps-tuner-pending-new">{c.newValue}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback banners */}
        {applyError && (
          <div className="hf-banner hf-banner-error ps-tuner-error">
            {applyError}
          </div>
        )}
        {applyResult && !applyError && (
          <div className="hf-banner hf-banner-success ps-tuner-error">
            {applyResult}
          </div>
        )}
          </>
        )}
      </div>

      {/* Sticky footer */}
      <div className="ps-tuner-footer">
        {scope === null ? (
          <div className="ps-tuner-no-changes">
            Pick a scope to start tuning
          </div>
        ) : hasChanges ? (
          <>
            <button
              className="hf-btn hf-btn-primary ps-tuner-apply"
              onClick={handleApply}
              disabled={applying || !playbookId}
            >
              {applying ? (
                <>
                  <span className="hf-spinner hf-spinner-sm" />
                  Applying...
                </>
              ) : scope === "course" ? (
                `Apply to course${activeLearnerCount !== null ? ` (${activeLearnerCount} learner${activeLearnerCount === 1 ? "" : "s"})` : ""}`
              ) : (
                `Apply to ${callerName || "this learner"} only`
              )}
            </button>
            <button
              className="hf-btn hf-btn-secondary ps-tuner-discard"
              onClick={handleDiscard}
              disabled={applying}
            >
              <RotateCcw size={12} />
              Discard
            </button>
          </>
        ) : (
          <div className="ps-tuner-no-changes">
            Adjust dials or approach to see changes
          </div>
        )}
      </div>
    </div>
  );
}
