"use client";

/**
 * CourseCurriculumTab — structural spine of the course.
 *
 * Epic #131 #138. The home the curriculum has never had. Renders:
 *   1. A data-quality scorecard banner (LO coverage, FK coverage, garbage count)
 *   2. The existing CurriculumEditor for inline module/LO editing
 *   3. A "Regenerate curriculum" button that calls the new POST endpoint
 *      wrapping extractCurriculumFromAssertions → syncModulesToDB → reconciler
 *   4. A persistent warning banner after regen if the lesson plan may be stale
 *
 * The scorecard + regenerate flow are the structural prevention for the
 * incident #137 root cause: the curriculum was invisible, so its rot went
 * unnoticed. Making it visible + fixable from one screen is the fix.
 *
 * #418: explicit viewMode toggle + flash fix. The page passes
 * `activeCurriculumMode` (resolved from setup-status) and we gate the body
 * on it — so the wrong panel never mounts first on Authored courses. A
 * segmented toggle lets educators peek at the other view in read-only mode.
 */

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { CourseLinkageScorecard } from "@/lib/content-trust/validate-lo-linkage";
import { CurriculumHealthTabs, McqPanel, type RegenerateActions } from "./CurriculumHealthTabs";
import { AuthoredModulesPanel } from "./_components/AuthoredModulesPanel";
import "./course-curriculum-tab.css";

interface CourseCurriculumTabProps {
  courseId: string;
  /** Playbook ID (same as courseId in most cases, needed for MCQ reset) */
  playbookId?: string;
  /**
   * Optional curriculumId hint from the course page's sessions fetch. The
   * scorecard endpoint resolves its own curriculum-id authoritatively, so
   * this prop is only used as a fallback for the CurriculumEditor while the
   * scorecard is still loading.
   */
  curriculumId?: string | null;
  isOperator: boolean;
  onSwitchTab?: (tab: string) => void;
  /**
   * #418 — the source of truth for which curriculum mode is active.
   * Resolved by the parent course page via the setup-status endpoint and
   * passed down. While null we render only a spinner so the wrong panel
   * never flashes on mount.
   */
  activeCurriculumMode: "authored" | "derived" | null;
}

interface RegenerateResponse {
  ok: boolean;
  curriculumId?: string;
  moduleCount?: number;
  warnings?: string[];
  reconcile?: { assertionsScanned: number; fkWritten: number };
  lessonPlanStaleWarning?: boolean;
  orphanedProgressSlugs?: string[];
  error?: string;
  /** #317 — reclassify-los free-form summary; appears in the success banner. */
  message?: string;
}

export function CourseCurriculumTab({
  courseId,
  playbookId,
  curriculumId: curriculumIdProp,
  isOperator,
  onSwitchTab,
  activeCurriculumMode,
}: CourseCurriculumTabProps) {
  const [scorecard, setScorecard] = useState<CourseLinkageScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<RegenerateResponse | null>(null);

  // #418 — explicit toggle between "authored" and "derived" views. Defaults
  // to whatever the page reports as the active mode; educator can flip to
  // preview the other view (read-only). Stays null while the parent is
  // still resolving the mode.
  const [viewMode, setViewMode] = useState<"authored" | "derived" | null>(null);
  useEffect(() => {
    if (activeCurriculumMode && viewMode === null) {
      setViewMode(activeCurriculumMode);
    }
  }, [activeCurriculumMode, viewMode]);

  // Authoritative curriculum id comes from the scorecard response. Until that
  // loads, fall back to the hint passed in by the course page.
  const curriculumId = scorecard?.curriculumId ?? curriculumIdProp ?? null;

  // ── Load scorecard ────────────────────────────────────────
  const loadScorecard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/curriculum-scorecard`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed to load scorecard");
      } else {
        setScorecard(data.scorecard);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    loadScorecard();
  }, [loadScorecard]);

  // ── Regenerate handler ────────────────────────────────────
  const handleRegenerate = useCallback(async () => {
    if (regenerating) return;
    const confirmMsg =
      "Reconcile the curriculum from extracted content?\n\n" +
      "This will rewrite modules and learning objectives using the A3-hardened AI prompt. " +
      "Existing lesson plan session assignments will be preserved but may go stale if modules change.\n\n" +
      "This makes one AI call.";
    if (!window.confirm(confirmMsg)) return;

    setRegenerating(true);
    setRegenResult(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/regenerate-curriculum`, {
        method: "POST",
      });
      const data = (await res.json()) as RegenerateResponse;
      setRegenResult(data);
      if (data.ok) {
        await loadScorecard();
      }
    } catch (e) {
      setRegenResult({ ok: false, error: e instanceof Error ? e.message : "Network error" });
    } finally {
      setRegenerating(false);
    }
  }, [courseId, regenerating, loadScorecard]);

  // ── Reconcile TPs handler ─────────────────────────────────
  const handleReconcileTPs = useCallback(async () => {
    if (!curriculumId) return;
    const res = await fetch(`/api/curricula/${curriculumId}/reconcile-orphans`, { method: "POST" });
    const data = await res.json();
    if (data.ok) await loadScorecard();
  }, [curriculumId, loadScorecard]);

  // ── MCQ regenerate handler ────────────────────────────────
  const handleRegenerateMcqs = useCallback(async () => {
    const pid = playbookId || courseId;
    const res = await fetch(`/api/playbooks/${pid}/reset-mcqs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (data.ok) await loadScorecard();
  }, [playbookId, courseId, loadScorecard]);

  // ── Re-extract instructions handler ───────────────────────
  const handleReExtractInstructions = useCallback(async () => {
    const res = await fetch(`/api/courses/${courseId}/re-extract-instructions`, { method: "POST" });
    const data = await res.json();
    if (data.ok) await loadScorecard();
  }, [courseId, loadScorecard]);

  // ── Reclassify LO audiences handler (#317) ────────────────
  const handleReclassifyLos = useCallback(async () => {
    if (!curriculumId) return;
    const res = await fetch(`/api/curricula/${curriculumId}/reclassify-los`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.ok) {
      // Surface a quick summary so the operator sees the audience-split impact.
      setRegenResult({
        ok: true,
        message: `Reclassified ${data.total} LOs — ${data.applied} applied, ${data.queued} queued for review${data.skipped ? `, ${data.skipped} skipped (human-overridden)` : ""}.`,
      });
      await loadScorecard();
    } else {
      setRegenResult({ ok: false, error: data.error ?? "Reclassify failed" });
    }
  }, [curriculumId, loadScorecard]);

  // ── Regenerate actions bundle ─────────────────────────────
  const fullRegenerateActions: RegenerateActions | undefined = isOperator ? {
    onRegenerateModules: handleRegenerate,
    onReconcileTPs: handleReconcileTPs,
    onRegenerateMcqs: handleRegenerateMcqs,
    onReExtractInstructions: handleReExtractInstructions,
    onReclassifyLos: handleReclassifyLos,
  } : undefined;

  // In preview mode (peeking at the inactive view), expose only the
  // link-only / idempotent actions — never the destructive regen/extract.
  const previewRegenerateActions: RegenerateActions | undefined = isOperator ? {
    onReconcileTPs: handleReconcileTPs,
    onRegenerateMcqs: handleRegenerateMcqs,
  } : undefined;

  // ── Render ─────────────────────────────────────────────────
  // #418 — gate on activeCurriculumMode before mounting any panel so the
  // Authored view doesn't flash through Derived on mount. The old guard
  // (`loading && !scorecard`) returned the spinner only briefly, then
  // proceeded with `modulesAuthored === null`, which caused the flash.
  if (activeCurriculumMode === null || viewMode === null) {
    return (
      <div className="hf-stack-md">
        <div className="hf-spinner" />
      </div>
    );
  }

  // While the scorecard fetch is still in flight on a fresh mount, also
  // show the spinner — the body needs both signals.
  if (loading && !scorecard) {
    return (
      <div className="hf-stack-md">
        <div className="hf-spinner" />
      </div>
    );
  }

  const isPreview = viewMode !== activeCurriculumMode;

  // ── Header: segmented toggle + preview banner ─────────────
  const header = (
    <div className="curriculum-mode-toolbar">
      <ModeToggle
        viewMode={viewMode}
        activeMode={activeCurriculumMode}
        onChange={(m) => setViewMode(m)}
      />
      {isPreview && (
        <div className="hf-banner hf-banner-info curriculum-mode-preview-banner">
          <span>
            Preview only — this is what {viewMode === "derived" ? "AI extraction" : "the Course Reference"} would produce.{" "}
            <strong>{activeCurriculumMode === "authored" ? "Authored" : "Derived"} modules</strong> are in use for this course.
          </span>
        </div>
      )}
    </div>
  );

  // ── Authored panel branch ─────────────────────────────────
  if (viewMode === "authored") {
    // Empty-state edge case: if activeMode is "authored" but
    // PlaybookConfig.modules is empty (declared "Yes" with no valid table),
    // AuthoredModulesPanel already renders its own empty state — we
    // intentionally leave that path to the child.
    return (
      <div className="hf-stack-md">
        {header}
        {error && <div className="hf-banner hf-banner-error">{error}</div>}
        <AuthoredModulesPanel
          courseId={playbookId ?? courseId}
          isOperator={isOperator}
        />
        {/* For authored-modules courses: show ONLY the MCQ list (the part
            educators actually need to see) without the scorecard / regen
            affordances. Renders standalone via the exported McqPanel.
            Suppressed in preview mode — the derived view below has its
            own MCQ panel inside CurriculumHealthTabs. */}
        {!isPreview && (
          <section className="hf-card curriculum-mode-mcq-section">
            <header className="curriculum-mode-mcq-header">
              <h3 className="hf-section-title curriculum-mode-mcq-title">
                Generated questions
              </h3>
              <span className="hf-text-xs hf-text-muted">
                MCQs created from your uploaded learner-facing content. Trust badge per row indicates provenance.
              </span>
            </header>
            <McqPanel courseId={courseId} />
          </section>
        )}
        {regenResult && (
          <RegenerateResult result={regenResult} onSwitchTab={onSwitchTab} />
        )}
      </div>
    );
  }

  // ── Derived panel branch ──────────────────────────────────
  // Either Derived is the active mode (full actions) or the user is peeking
  // at Derived on an Authored course (read-only, subset of actions).
  return (
    <div className="hf-stack-md">
      {header}
      {error && <div className="hf-banner hf-banner-error">{error}</div>}

      {!curriculumId && (
        <div className="hf-empty">
          <p className="hf-text-sm hf-text-muted">
            No curriculum yet. Upload content on the Content tab to generate one.
          </p>
        </div>
      )}

      {/* #208: Curriculum exists but has zero modules — surface a recovery CTA
          before the rest of the scorecard renders, so educators don't see a
          health card with no actionable next step. Suppressed in preview
          mode (the CTA would clobber the authored modules). */}
      {!isPreview
        && !!curriculumId
        && (scorecard?.structure?.activeModules ?? 0) === 0 && (
        <div className="hf-banner hf-banner-warning">
          <div>
            <AlertTriangle size={14} />
            <strong> Curriculum has no modules.</strong>{" "}
            The course was created but module generation didn't complete. The
            lesson plan view will be unavailable until modules are generated.
          </div>
          {isOperator && (
            <button
              type="button"
              className="hf-btn hf-btn-primary hf-mt-sm"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? "Reconciling…" : "Reconcile curriculum"}
            </button>
          )}
        </div>
      )}

      {scorecard && curriculumId && (
        <CurriculumHealthTabs
          scorecard={scorecard}
          courseId={courseId}
          curriculumId={curriculumId}
          isOperator={isOperator}
          regenerateActions={isPreview ? previewRegenerateActions : fullRegenerateActions}
          regenerating={regenerating}
          onScorecardRefresh={loadScorecard}
          readOnly={isPreview}
        />
      )}

      {regenResult && (
        <RegenerateResult result={regenResult} onSwitchTab={onSwitchTab} />
      )}
    </div>
  );
}

// ── Mode toggle (#418) ───────────────────────────────────────
//
// Segmented control between Authored and Derived. The active mode (the
// one driving the course at runtime) gets an "Active" tag so peeking at
// the other mode never reads as a setting change.
function ModeToggle({
  viewMode,
  activeMode,
  onChange,
}: {
  viewMode: "authored" | "derived";
  activeMode: "authored" | "derived";
  onChange: (mode: "authored" | "derived") => void;
}) {
  return (
    <div className="curriculum-mode-toggle" role="tablist" aria-label="Curriculum source">
      {(["authored", "derived"] as const).map((mode) => {
        const isActive = viewMode === mode;
        const isRuntime = activeMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`curriculum-mode-toggle__btn${isActive ? " curriculum-mode-toggle__btn--selected" : ""}`}
            onClick={() => onChange(mode)}
          >
            <span className="curriculum-mode-toggle__label">
              {mode === "authored" ? "Authored" : "Derived"}
            </span>
            {isRuntime && (
              <span className="curriculum-mode-toggle__tag" aria-label="active mode">
                Active
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Regenerate result banner ─────────────────────────────────

function RegenerateResult({
  result,
  onSwitchTab,
}: {
  result: RegenerateResponse;
  onSwitchTab?: (tab: string) => void;
}) {
  if (!result.ok) {
    return (
      <div className="hf-banner hf-banner-error">
        <AlertTriangle size={14} /> Regeneration failed: {result.error}
      </div>
    );
  }

  // #317 — when the action came from "Reclassify LO audiences", we get a
  // bespoke `message` field instead of moduleCount. Show that verbatim.
  if (result.message) {
    return (
      <div className="hf-banner hf-banner-success">
        <div>
          <CheckCircle2 size={14} />
          <strong> Reclassified.</strong> {result.message}
        </div>
      </div>
    );
  }

  const moduleWord = result.moduleCount === 1 ? "module" : "modules";
  const linkCount = result.reconcile?.fkWritten ?? 0;
  const linkLine = linkCount > 0
    ? ` Connected ${linkCount} teaching point${linkCount !== 1 ? "s" : ""} to learning outcomes.`
    : "";
  return (
    <div className="hf-banner hf-banner-success">
      <div>
        <CheckCircle2 size={14} />
        <strong> Curriculum regenerated.</strong>{" "}
        {result.moduleCount} {moduleWord} created.{linkLine}
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <ul className="hf-text-xs hf-mt-xs">
          {result.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {result.lessonPlanStaleWarning && (
        <div className="hf-text-xs hf-mt-sm">
          <AlertTriangle size={11} className="hf-text-warning" /> Your module structure
          changed — the lesson plan may need regenerating too.{" "}
          {onSwitchTab ? (
            <button
              type="button"
              className="hf-link"
              onClick={() => onSwitchTab("design")}
            >
              Go to the Design tab →
            </button>
          ) : (
            <Link href="?tab=design" className="hf-link">
              Go to the Design tab →
            </Link>
          )}
        </div>
      )}

      {result.orphanedProgressSlugs && result.orphanedProgressSlugs.length > 0 && (
        <div className="hf-text-xs hf-mt-sm">
          <AlertTriangle size={11} className="hf-text-warning" />{" "}
          {result.orphanedProgressSlugs.length} module(s) had caller progress but were
          removed: {result.orphanedProgressSlugs.join(", ")}
        </div>
      )}
    </div>
  );
}
