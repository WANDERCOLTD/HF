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
 */

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { CourseLinkageScorecard } from "@/lib/content-trust/validate-lo-linkage";
import { CurriculumHealthTabs } from "./CurriculumHealthTabs";
import "./course-curriculum-tab.css";

interface CourseCurriculumTabProps {
  courseId: string;
  /**
   * Optional curriculumId hint from the course page's sessions fetch. The
   * scorecard endpoint resolves its own curriculum-id authoritatively, so
   * this prop is only used as a fallback for the CurriculumEditor while the
   * scorecard is still loading.
   */
  curriculumId?: string | null;
  isOperator: boolean;
  onSwitchTab?: (tab: string) => void;
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
}

export function CourseCurriculumTab({
  courseId,
  curriculumId: curriculumIdProp,
  isOperator,
  onSwitchTab,
}: CourseCurriculumTabProps) {
  const [scorecard, setScorecard] = useState<CourseLinkageScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<RegenerateResponse | null>(null);

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
      "Regenerate the curriculum from extracted content?\n\n" +
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

  // ── Render ─────────────────────────────────────────────────
  // Wait for the scorecard fetch before deciding whether a curriculum exists —
  // the scorecard response is the authoritative source. If the scorecard
  // returns and curriculumId is still null, surface the empty state.
  if (loading && !scorecard) {
    return (
      <div className="hf-stack-md">
        <div className="hf-spinner" />
      </div>
    );
  }

  if (!curriculumId) {
    return (
      <div className="hf-empty">
        <p className="hf-text-sm hf-text-muted">
          No curriculum yet. Upload content on the Content tab to generate one.
        </p>
      </div>
    );
  }

  return (
    <div className="hf-stack-md">
      {error && <div className="hf-banner hf-banner-error">{error}</div>}

      {scorecard && (
        <CurriculumHealthTabs
          scorecard={scorecard}
          courseId={courseId}
          curriculumId={curriculumId}
          isOperator={isOperator}
          onRegenerate={isOperator ? handleRegenerate : undefined}
          regenerating={regenerating}
          onScorecardRefresh={loadScorecard}
        />
      )}

      {/* Regeneration result */}
      {regenResult && (
        <RegenerateResult result={regenResult} onSwitchTab={onSwitchTab} />
      )}
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
