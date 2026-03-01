"use client";

/**
 * TeachPlanStep — "Plan Sessions" step for the Teach wizard.
 *
 * Phase A: Intent capture (session count, duration, emphasis, assessments)
 * Phase B: Async curriculum generation (polling via useTaskPoll)
 * Phase C: Module review (reorderable, removable, expandable)
 *
 * Uses the assertion-based generateContentSpec API (not the goals-based generate-plan).
 * All domain-linked source assertions are included automatically.
 */

import { useState, useEffect, useCallback } from "react";

/** @system-constant polling — Poll interval for teach plan readiness checks */
const TEACH_PLAN_POLL_MS = 10_000;
import { SessionCountPicker } from "@/components/shared/SessionCountPicker";
import { SortableList } from "@/components/shared/SortableList";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { LessonPlanModelPicker } from "@/components/shared/LessonPlanModelPicker";
import type { LessonPlanModel } from "@/lib/lesson-plan/types";
import { reorderItems } from "@/lib/sortable/reorder";
import { useTaskPoll, type PollableTask } from "@/hooks/useTaskPoll";
import { FieldHint } from "@/components/shared/FieldHint";
import { WIZARD_HINTS } from "@/lib/wizard-hints";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ArrowRight,
  BookOpen,
  Loader2,
  RotateCcw,
  SkipForward,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

// ── Types ──────────────────────────────────────────

interface TeachPlanStepProps {
  domainId: string;
  setData: (key: string, value: unknown) => void;
  getData: <T = unknown>(key: string) => T | undefined;
  onNext: () => void;
  onPrev: () => void;
}

import type { LegacyCurriculumModuleJSON as CurriculumModule } from "@/lib/types/json-fields";

type Phase = "intents" | "generating" | "review";
type Emphasis = "breadth" | "balanced" | "depth";
type Assessment = "formal" | "light" | "none";

const DURATIONS = [15, 20, 30, 45, 60] as const;
const EMPHASIS_OPTIONS: Emphasis[] = ["breadth", "balanced", "depth"];
const ASSESSMENT_OPTIONS: Assessment[] = ["formal", "light", "none"];

// ── Component ──────────────────────────────────────

export function TeachPlanStep({
  domainId,
  setData,
  getData,
  onNext,
  onPrev,
}: TeachPlanStepProps) {
  // Content availability from the content step (step 2)
  const contentAvailable = getData<boolean>("contentAvailable") ?? false;
  const upstreamContentCount = getData<number>("contentCount") ?? 0;
  const extractionInProgress = getData<boolean>("extractionInProgress") ?? false;
  const packSourceCount = getData<number>("packSourceCount") ?? 0;

  // Subject scoping (Teach flow — set by content step)
  const subjectIds = getData<string[]>("subjectIds");

  // Restore state from data bag
  const restoredTaskId = getData<string>("contentSpecTaskId") || null;
  const restoredModules = getData<CurriculumModule[]>("curriculumModules");

  // Phase — prioritise: existing modules > active task > fresh
  const [phase, setPhase] = useState<Phase>(
    restoredModules && restoredModules.length > 0 ? "review"
    : restoredTaskId ? "generating"
    : "intents"
  );

  // Intent state
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [durationMins, setDurationMins] = useState(15);
  const [emphasis, setEmphasis] = useState<Emphasis>("balanced");
  const [assessments, setAssessments] = useState<Assessment>("light");
  const [lessonPlanModel, setLessonPlanModel] = useState<LessonPlanModel>("direct_instruction");

  // Generation state
  const [taskId, setTaskId] = useState<string | null>(restoredTaskId);
  const [error, setError] = useState<string | null>(null);

  // Review state
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [contentSpecId, setContentSpecId] = useState<string | null>(null);

  // Restore saved intents and modules on mount
  useEffect(() => {
    const saved = getData<{
      sessionCount: number | null;
      durationMins: number;
      emphasis: Emphasis;
      assessments: Assessment;
      lessonPlanModel?: LessonPlanModel;
    }>("curriculumIntents");
    if (saved) {
      if (saved.sessionCount != null) setSessionCount(saved.sessionCount);
      if (saved.durationMins) setDurationMins(saved.durationMins);
      if (saved.emphasis) setEmphasis(saved.emphasis);
      if (saved.assessments) setAssessments(saved.assessments);
      if (saved.lessonPlanModel) setLessonPlanModel(saved.lessonPlanModel);
    }
    // Check for error from parent-level poll
    const currError = getData<string>("curriculumError");
    if (currError) {
      setError(currError);
      setData("curriculumError", null);
    }
    // Restore modules if already generated (skeleton or enriched)
    const savedModules = getData<CurriculumModule[]>("curriculumModules");
    if (savedModules && savedModules.length > 0) {
      setModules(savedModules);
      setContentSpecId(getData<string>("contentSpecId") || null);
      setEnriching(!!getData<boolean>("curriculumEnriching"));
      setPhase("review");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether we're showing skeleton (pre-enrichment) modules
  const [enriching, setEnriching] = useState(false);
  // Live progress message from server
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  // ── Extraction-in-progress auto-refresh ────────────
  const [livePointCount, setLivePointCount] = useState<number>(upstreamContentCount);
  const [extractionDone, setExtractionDone] = useState(!extractionInProgress);

  useEffect(() => {
    if (!extractionInProgress || !domainId) return;

    let cancelled = false;

    const checkPoints = async () => {
      try {
        const statsParams = new URLSearchParams();
        if (subjectIds?.length) statsParams.set("subjectIds", subjectIds.join(","));
        const statsQs = statsParams.toString();
        const res = await fetch(`/api/domains/${domainId}/content-stats${statsQs ? `?${statsQs}` : ""}`);
        if (!res.ok) return;
        const data = await res.json();
        const count = data.assertionCount ?? 0;
        if (!cancelled) {
          setLivePointCount(count);
          if (count > 0) {
            // Update data bag so Generate uses real count
            setData("contentCount", count);
            setData("contentAvailable", true);
          }
          // Check if all sources are done extracting
          if (data.allExtracted) {
            setExtractionDone(true);
            setData("extractionInProgress", false);
          }
        }
      } catch {
        // Silently continue — next poll will retry
      }
    };

    // Initial check
    checkPoints();

    const interval = setInterval(checkPoints, TEACH_PLAN_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [extractionInProgress, domainId, subjectIds, setData]);

  // ── Task Polling ──────────────────────────────────

  useTaskPoll({
    taskId,
    onProgress: useCallback((task: PollableTask) => {
      setError(null);
      const ctx = task.context || {};

      // Update progress message from server
      if (ctx.message) {
        setProgressMessage(ctx.message);
      }

      // Phase 1 complete: skeleton modules available — show immediately
      if (ctx.skeletonReady && ctx.skeletonModules && phase === "generating") {
        const skeletonMods: CurriculumModule[] = ctx.skeletonModules.map((m: { id?: string; title?: string; description?: string; sortOrder?: number }, i: number) => ({
          id: m.id || `MOD-${i + 1}`,
          title: m.title || `Module ${i + 1}`,
          description: m.description || "",
          learningOutcomes: [],
          assessmentCriteria: [],
          keyTerms: [],
          estimatedDurationMinutes: null,
          sortOrder: m.sortOrder || i + 1,
        }));
        setModules(skeletonMods);
        setData("curriculumModules", skeletonMods);
        setEnriching(true);
        setPhase("review");
      }
    }, [phase, setData]),
    onComplete: useCallback((task: PollableTask) => {
      const ctx = task.context || {};
      if (ctx.error || !ctx.result) {
        setError(ctx.error || "Generation completed but no result returned");
        setPhase("intents");
        setTaskId(null);
        setData("contentSpecTaskId", null);
        return;
      }

      const result = ctx.result;
      // Load enriched modules from the created/updated content spec
      if (result.contentSpec && result.moduleCount > 0) {
        fetchModules(result.contentSpec.id);
        setContentSpecId(result.contentSpec.id);
        setData("contentSpecId", result.contentSpec.id);
      } else if (phase !== "review") {
        // Only show error if we don't already have skeleton modules
        setError("No modules generated — check that content sources have teaching points");
        setPhase("intents");
      }

      setEnriching(false);
      setTaskId(null);
      setData("contentSpecTaskId", null);
    }, [phase, setData]), // eslint-disable-line react-hooks/exhaustive-deps
    onError: useCallback((message: string) => {
      // If we have skeleton modules, keep showing them — just note the enrichment failed
      if (phase === "review") {
        setEnriching(false);
        // Skeleton modules are still usable — don't throw user back to intents
        return;
      }
      setError(message);
      setPhase("intents");
      setTaskId(null);
      setData("contentSpecTaskId", null);
    }, [phase, setData]),
  });

  // ── Fetch modules from content spec ──────────────

  const fetchModules = useCallback(async (specId: string) => {
    try {
      const res = await fetch(`/api/specs/${specId}`);
      const data = await res.json();
      const specConfig = data.spec?.config || data.config;
      if (specConfig?.modules && Array.isArray(specConfig.modules)) {
        const mods = specConfig.modules as CurriculumModule[];
        setModules(mods);
        setData("curriculumModules", mods);
        setPhase("review");
      } else {
        setError("Content spec has no modules");
        setPhase("intents");
      }
    } catch (err: unknown) {
      setError(`Failed to load modules: ${err instanceof Error ? err.message : "Unknown error"}`);
      setPhase("intents");
    }
  }, [setData]);

  // ── Handlers ──────────────────────────────────────

  const saveIntents = useCallback(() => {
    const intents = {
      sessionCount: sessionCount || null,
      durationMins,
      emphasis,
      assessments,
      lessonPlanModel,
    };
    setData("curriculumIntents", intents);
    setData("lessonPlanModel", lessonPlanModel);
  }, [sessionCount, durationMins, emphasis, assessments, lessonPlanModel, setData]);

  const handleGenerate = useCallback(async () => {
    if (taskId || phase === "generating") return;
    saveIntents();
    setError(null);
    setPhase("generating");

    try {
      const res = await fetch(`/api/domains/${domainId}/generate-content-spec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          async: true,
          regenerate: true,
          subjectIds: subjectIds?.length ? subjectIds : undefined,
          intents: {
            sessionCount: sessionCount || undefined,
            durationMins,
            emphasis,
            assessments,
            lessonPlanModel,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Generation request failed");
      setTaskId(data.taskId);
      setData("contentSpecTaskId", data.taskId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setPhase("intents");
    }
  }, [taskId, phase, domainId, sessionCount, durationMins, emphasis, assessments, lessonPlanModel, subjectIds, saveIntents, setData]);

  const handleAccept = useCallback(() => {
    saveIntents();
    setData("contentSpecGenerated", true);
    setData("moduleCount", modules.length);
    setData("lessonPlanMode", "reviewed");
    setData("curriculumModules", modules);
    if (contentSpecId) {
      setData("contentSpecId", contentSpecId);
    }
    onNext();
  }, [saveIntents, setData, modules, contentSpecId, onNext]);

  const handleSkip = useCallback(() => {
    setData("lessonPlanMode", "skipped");
    setData("contentSpecGenerated", false);
    onNext();
  }, [setData, onNext]);

  const handleReorder = useCallback((from: number, to: number) => {
    const next = reorderItems(modules, from, to);
    setModules(next);
    setData("curriculumModules", next);
  }, [modules, setData]);

  const handleRemove = useCallback((index: number) => {
    const next = modules.filter((_, i) => i !== index);
    setModules(next);
    setData("curriculumModules", next);
  }, [modules, setData]);

  const toggleExpand = useCallback((moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  // ── Render ──────────────────────────────────────

  return (
    <div className={`hf-card${enriching ? " hf-glow-active" : ""}`} style={{ maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <BookOpen style={{ width: 22, height: 22, color: "var(--accent-primary)" }} />
        <h2 className="hf-section-title" style={{ margin: 0 }}>
          Plan Your Sessions
        </h2>
      </div>

      {error && <ErrorBanner error={error} />}

      {/* ── No Content Warning ──────────── */}
      {!contentAvailable && !extractionInProgress && phase === "intents" && (
        <div className="hf-banner hf-banner-warning hf-mb-md">
          <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span>
            No content uploaded yet. Go back to the Content step to upload or select
            teaching material before generating a curriculum.
          </span>
        </div>
      )}

      {/* Extraction in progress — friendly status */}
      {extractionInProgress && !extractionDone && phase === "intents" && (
        <div className="hf-banner hf-banner-info hf-mb-md hf-glow-active">
          <RefreshCw style={{ width: 16, height: 16, flexShrink: 0, animation: "spin 2s linear infinite" }} />
          <div className="hf-flex-col hf-gap-xs">
            <span>
              Extracting teaching points from {packSourceCount} file{packSourceCount !== 1 ? "s" : ""}...
            </span>
            {livePointCount > 0 ? (
              <span className="hf-text-xs hf-text-muted">
                {livePointCount} point{livePointCount !== 1 ? "s" : ""} found so far — you can generate now or wait for more
              </span>
            ) : (
              <span className="hf-text-xs hf-text-muted">
                This usually takes 30-60 seconds. You can generate a plan now or wait.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Content count badge when content exists */}
      {(contentAvailable || extractionDone) && livePointCount > 0 && phase === "intents" && (
        <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md">
          <span className="dtw-accordion-badge">{livePointCount}</span>
          <span className="hf-text-xs hf-text-muted">
            teaching point{livePointCount !== 1 ? "s" : ""} available
            {extractionInProgress && !extractionDone && " (still extracting...)"}
          </span>
        </div>
      )}

      {/* ── Phase A: Intent Capture ──────────── */}
      {phase === "intents" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <p className="hf-section-desc" style={{ margin: 0 }}>
            Tell us how you want to structure your teaching. We&apos;ll generate a curriculum
            from your uploaded content.
          </p>

          {/* Teaching Model */}
          <div>
            <div className="hf-mb-xs">
              <FieldHint label="Teaching model" hint={WIZARD_HINTS["course.model"]} labelClass="hf-label" />
            </div>
            <LessonPlanModelPicker value={lessonPlanModel} onChange={setLessonPlanModel} />
          </div>

          {/* Session Count */}
          <div>
            <div style={{ marginBottom: 8 }}>
              <FieldHint label="How many sessions?" hint={WIZARD_HINTS["teach.plan"]} labelClass="hf-label" />
            </div>
            <SessionCountPicker value={sessionCount} onChange={setSessionCount} />
            <div className="hf-hint" style={{ marginTop: 4 }}>
              Leave blank for AI to decide based on content volume
            </div>
          </div>

          {/* Duration */}
          <div>
            <div className="hf-label" style={{ marginBottom: 8 }}>
              Session duration
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DURATIONS.map((d) => (
                <ChipButton key={d} selected={durationMins === d} onClick={() => setDurationMins(d)}>
                  {d} min
                </ChipButton>
              ))}
            </div>
          </div>

          {/* Emphasis */}
          <div>
            <div className="hf-label" style={{ marginBottom: 8 }}>
              Teaching emphasis
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EMPHASIS_OPTIONS.map((e) => (
                <ChipButton key={e} selected={emphasis === e} onClick={() => setEmphasis(e)}>
                  {e === "breadth" ? "Breadth-first" : e === "depth" ? "Depth-first" : "Balanced"}
                </ChipButton>
              ))}
            </div>
            <div className="hf-hint" style={{ marginTop: 4 }}>
              {emphasis === "breadth"
                ? "Many smaller modules covering all topics at surface level"
                : emphasis === "depth"
                  ? "Fewer, deeper modules with more learning outcomes each"
                  : "A balance of breadth and depth across modules"}
            </div>
          </div>

          {/* Assessments */}
          <div>
            <div className="hf-label" style={{ marginBottom: 8 }}>
              Include assessments?
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <ChipButton selected={assessments === "formal"} onClick={() => setAssessments("formal")}>
                Yes (formal)
              </ChipButton>
              <ChipButton selected={assessments === "light"} onClick={() => setAssessments("light")}>
                Light checks
              </ChipButton>
              <ChipButton selected={assessments === "none"} onClick={() => setAssessments("none")}>
                No assessments
              </ChipButton>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
            <button onClick={onPrev} className="dtw-btn-back">
              <ChevronLeft style={{ width: 16, height: 16 }} /> Back
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSkip} className="dtw-btn-skip">
                <SkipForward style={{ width: 14, height: 14 }} /> Skip
              </button>
              <button
                onClick={handleGenerate}
                disabled={!contentAvailable && !extractionInProgress}
                className={`dtw-btn-next ${contentAvailable || extractionInProgress ? "dtw-btn-next-enabled" : "dtw-btn-next-disabled"}`}
                title={contentAvailable || extractionInProgress ? undefined : "Upload content first"}
              >
                {extractionInProgress && !extractionDone && livePointCount === 0
                  ? <>Plan Anyway <ArrowRight style={{ width: 16, height: 16 }} /></>
                  : <>Generate Lesson Plan <ArrowRight style={{ width: 16, height: 16 }} /></>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phase B: Generating ──────────── */}
      {phase === "generating" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "40px 0" }}>
          <div className="hf-spinner hf-icon-lg hf-spinner-thick" />
          <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
            {progressMessage || "Generating curriculum from your content..."}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Analysing teaching points and organising into modules. This may take 30-60 seconds.
          </div>

          <div style={{ paddingTop: 16 }}>
            <button
              onClick={() => {
                setTaskId(null);
                setData("contentSpecTaskId", null);
                setPhase("intents");
              }}
              className="dtw-btn-back"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Phase C: Module Review ──────────── */}
      {phase === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="hf-section-desc" style={{ margin: 0 }}>
            {modules.length} module{modules.length !== 1 ? "s" : ""} generated.
            {enriching
              ? " Adding learning outcomes and detail..."
              : " Drag to reorder, remove unwanted modules, or expand to see details."}
          </p>

          {enriching && (
            <div className="hf-glow-active" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-secondary)", fontSize: 13, color: "var(--text-muted)" }}>
              <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite", flexShrink: 0 }} />
              Enriching modules with learning outcomes, assessment criteria, and key terms...
            </div>
          )}

          <SortableList
            items={modules}
            onReorder={handleReorder}
            onRemove={handleRemove}
            getItemId={(m) => m.id}
            emptyLabel="No modules — try regenerating"
            renderCard={(mod, _index) => (
              <ModuleCard
                module={mod}
                expanded={expandedModules.has(mod.id)}
                onToggle={() => toggleExpand(mod.id)}
              />
            )}
          />

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
            <button onClick={onPrev} className="dtw-btn-back">
              <ChevronLeft style={{ width: 16, height: 16 }} /> Back
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  setModules([]);
                  setData("curriculumModules", []);
                  setPhase("intents");
                }}
                className="dtw-btn-skip"
              >
                <RotateCcw style={{ width: 14, height: 14 }} /> Regenerate
              </button>
              <button
                onClick={handleAccept}
                disabled={modules.length === 0}
                className="dtw-btn-next"
              >
                Accept & Continue <ArrowRight style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Module Card ──────────────────────────────────────

function ModuleCard({
  module: mod,
  expanded,
  onToggle,
}: {
  module: CurriculumModule;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          padding: "4px 0",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>
            {mod.id}: {mod.title}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {mod.learningOutcomes?.length || 0} outcomes
            {mod.estimatedDurationMinutes ? ` · ${mod.estimatedDurationMinutes} min` : ""}
            {mod.keyTerms?.length ? ` · ${mod.keyTerms.length} terms` : ""}
          </div>
        </div>
        {expanded ? (
          <ChevronUp style={{ width: 16, height: 16, color: "var(--text-muted)", flexShrink: 0 }} />
        ) : (
          <ChevronDown style={{ width: 16, height: 16, color: "var(--text-muted)", flexShrink: 0 }} />
        )}
      </div>

      {expanded && (
        <div style={{ paddingTop: 8, paddingLeft: 4, fontSize: 13, color: "var(--text-secondary)" }}>
          {mod.description && (
            <p style={{ margin: "0 0 8px", color: "var(--text-primary)" }}>{mod.description}</p>
          )}

          {mod.learningOutcomes?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Learning Outcomes
              </div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {mod.learningOutcomes.map((lo, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>{lo}</li>
                ))}
              </ul>
            </div>
          )}

          {mod.assessmentCriteria && mod.assessmentCriteria.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Assessment Criteria
              </div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {mod.assessmentCriteria.map((ac, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>{ac}</li>
                ))}
              </ul>
            </div>
          )}

          {mod.keyTerms && mod.keyTerms.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                Key Terms
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {mod.keyTerms.map((term, i) => (
                  <span
                    key={i}
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      background: "var(--surface-secondary)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared UI ──────────────────────────────────────

function ChipButton({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={"hf-chip" + (selected ? " hf-chip-selected" : "")}
    >
      {children}
    </button>
  );
}
