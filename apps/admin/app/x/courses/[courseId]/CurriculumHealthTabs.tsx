"use client";

/**
 * CurriculumHealthTabs — tabbed curriculum inspector for the course detail page.
 *
 * Replaces the flat MetricCard grid with a tab strip. Each tab renders a live
 * list of the underlying artefact, so educators can see · understand · tweak
 * in one place without navigating between Content, Journey, and Curriculum
 * tabs.
 *
 * Tabs:
 *   1. Modules            — CurriculumEditor (reuse)
 *   2. Teaching Points    — assertions grouped by LO, with coverage dots
 *   3. Questions & MCQs   — MCQ list with TP + source provenance chips
 *   4. Tutor Instructions — assertions filtered to INSTRUCTION_SET, grouped by type
 *
 * Sources live above the tab strip as a header strip, not a tab — they are
 * upstream input, not downstream artefacts.
 */

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  HelpCircle,
  Layers,
  RefreshCw,
  Sparkles,
  Wrench,
  CheckCircle2,
  CircleDashed,
  Clock,
  CircleDot,
} from "lucide-react";
import CurriculumEditor from "@/app/x/subjects/_components/CurriculumEditor";
import { AssertionDetailDrawer } from "@/components/shared/AssertionDetailDrawer";
import { getCategoryStyle, CONTENT_CATEGORIES } from "@/lib/content-categories";
import type { CourseLinkageScorecard, CurriculumHealth } from "@/lib/content-trust/validate-lo-linkage";

// ── Types ────────────────────────────────────────────────

type TabKey = "modules" | "teaching-points" | "questions" | "instructions";

type Assertion = {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  trustLevel: string | null;
  linkConfidence: number | null;
  sourceName: string | null;
  session: number | null;
};

type McqItem = {
  id: string;
  questionText: string;
  questionType: string;
  /** #281 Slice 3b: provenance signal. AI_ASSISTED for generator-output;
   *  higher tiers (EXPERT_CURATED, ACCREDITED_MATERIAL, REGULATORY_STANDARD)
   *  for educator-imported question banks. Null = legacy row pre-migration. */
  trustLevel: string | null;
  assertion: { id: string; text: string; category: string; learningOutcomeRef: string | null } | null;
  sourceName: string | null;
  linkedToTp: boolean;
};

/** Individual regeneration actions passed from parent */
export interface RegenerateActions {
  onRegenerateModules?: () => Promise<void>;
  onReconcileTPs?: () => Promise<void>;
  onRegenerateMcqs?: () => Promise<void>;
  onReExtractInstructions?: () => Promise<void>;
  /** #317 — re-run the LO audience classifier on this curriculum. */
  onReclassifyLos?: () => Promise<void>;
}

interface Props {
  scorecard: CourseLinkageScorecard;
  courseId: string;
  curriculumId: string | null;
  isOperator: boolean;
  regenerateActions?: RegenerateActions;
  /** @deprecated Use regenerateActions instead */
  onRegenerate?: () => void;
  regenerating: boolean;
  /**
   * Called after a reconcile (manual or silent background). Parent should
   * re-fetch the scorecard so coverage dots update.
   */
  onScorecardRefresh?: () => void;
  /**
   * Issue #418 — when true, suppress the silent auto-reconcile useEffects
   * (orphans + MCQs). The parent uses this for preview-mode rendering on
   * authored-modules courses so that opening the Curriculum tab can't
   * mutate a curriculum that isn't the active source of truth. Manual
   * reconcile handlers still work — only the on-mount background fires
   * are gated.
   */
  readOnly?: boolean;
}

// ── Regenerate Dropdown ─────────────────────────────────

function RegenerateDropdown({
  scorecard,
  actions,
  onRegenerateFallback,
  regenerating,
  onScorecardRefresh,
}: {
  scorecard: CourseLinkageScorecard;
  actions?: RegenerateActions;
  onRegenerateFallback?: () => void;
  regenerating: boolean;
  onScorecardRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [runningItem, setRunningItem] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isRunning = regenerating || runningItem !== null;

  const runAction = async (key: string, fn?: () => Promise<void>) => {
    if (!fn || isRunning) return;
    setRunningItem(key);
    try {
      await fn();
      onScorecardRefresh?.();
    } finally {
      setRunningItem(null);
    }
  };

  const runAll = async () => {
    if (isRunning) return;
    const steps = [
      { key: "modules", fn: actions?.onRegenerateModules },
      { key: "tps", fn: actions?.onReconcileTPs },
      { key: "mcqs", fn: actions?.onRegenerateMcqs },
      { key: "instructions", fn: actions?.onReExtractInstructions },
      { key: "reclassifyLos", fn: actions?.onReclassifyLos },
    ].filter((s) => s.fn);
    for (const step of steps) {
      setRunningItem(step.key);
      try { await step.fn!(); } catch { /* continue */ }
    }
    setRunningItem(null);
    onScorecardRefresh?.();
  };

  // Badge text for each item
  const moduleBadge = `${scorecard.structure.activeModules} mods · ${scorecard.structure.learningOutcomes} LOs`;
  const tpLinked = scorecard.studentContent.linkedToOutcome;
  const tpTotal = scorecard.studentContent.total;
  const tpBadgeText = tpTotal === 0 ? "empty" : `${tpLinked} of ${tpTotal}`;
  const mcqBadgeText = scorecard.questions.total === 0 ? "empty" : `${scorecard.questions.total}`;
  const instrBadgeText = scorecard.tutorInstructions.total === 0 ? "empty" : `${scorecard.tutorInstructions.total} rules`;

  type Item = { key: string; icon: string; label: string; badge: string; warn: boolean; fn?: () => Promise<void> };
  const items: Item[] = [
    { key: "modules", icon: "📦", label: "Modules & LOs", badge: moduleBadge, warn: scorecard.structure.activeModules === 0, fn: actions?.onRegenerateModules },
    { key: "tps", icon: "🔗", label: "Teaching Point linking", badge: tpBadgeText, warn: tpLinked < tpTotal, fn: actions?.onReconcileTPs },
    { key: "mcqs", icon: "❓", label: "Questions & MCQs", badge: mcqBadgeText, warn: scorecard.questions.total === 0, fn: actions?.onRegenerateMcqs },
    { key: "instructions", icon: "📏", label: "Tutor Instructions", badge: instrBadgeText, warn: false, fn: actions?.onReExtractInstructions },
    { key: "reclassifyLos", icon: "👁", label: "Reclassify LO audiences", badge: "learner ↔ system", warn: false, fn: actions?.onReclassifyLos },
  ];

  // Fallback: if no actions provided, use the old single button
  if (!actions) {
    return (
      <button
        type="button"
        className="hf-btn hf-btn-primary hf-btn-sm"
        onClick={onRegenerateFallback}
        disabled={regenerating}
        title="Rebuild the curriculum from your uploaded content"
      >
        {regenerating ? (
          <><RefreshCw size={13} className="hf-glow-active" /> Reconciling…</>
        ) : (
          <><Sparkles size={13} /> Reconcile</>
        )}
      </button>
    );
  }

  return (
    <div className="regen-dropdown" ref={dropdownRef}>
      <button
        type="button"
        className="hf-btn hf-btn-primary hf-btn-sm"
        onClick={() => setOpen(!open)}
        disabled={isRunning}
      >
        {isRunning ? (
          <><RefreshCw size={13} className="hf-glow-active" /> Reconciling…</>
        ) : (
          <><Sparkles size={13} /> Reconcile… <ChevronDown size={12} /></>
        )}
      </button>
      {open && !isRunning && (
        <div className="regen-dropdown-menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`regen-dropdown-item${item.warn ? " regen-dropdown-item--warn" : ""}`}
              onClick={() => { setOpen(false); runAction(item.key, item.fn); }}
              disabled={!item.fn}
            >
              <span className="regen-dropdown-icon">{item.icon}</span>
              <span className="regen-dropdown-label">{item.label}</span>
              <span className={`regen-dropdown-badge${item.warn ? " regen-dropdown-badge--warn" : ""}`}>{item.badge}</span>
            </button>
          ))}
          <div className="regen-dropdown-divider" />
          <button
            type="button"
            className="regen-dropdown-item regen-dropdown-item--all"
            onClick={() => { setOpen(false); runAll(); }}
          >
            <span className="regen-dropdown-icon">🔄</span>
            <span className="regen-dropdown-label">Reconcile All</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────

export function CurriculumHealthTabs({
  scorecard,
  courseId,
  curriculumId,
  isOperator,
  regenerateActions,
  onRegenerate,
  regenerating,
  onScorecardRefresh,
  readOnly = false,
}: Props) {
  const defaultTab = pickDefaultTab(scorecard);
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

  const [reconciling, setReconciling] = useState(false);
  const [reconcileBanner, setReconcileBanner] = useState<string | null>(null);
  const [reconcilingMcqs, setReconcilingMcqs] = useState(false);

  const orphans = scorecard.studentContent.total - scorecard.studentContent.linkedToOutcome;
  const mcqOrphans = scorecard.questions.total - scorecard.questions.linkedToTp;

  // Silent auto-run on mount when there are orphaned outcomes and we haven't
  // already reconciled this curriculum within the 5-minute client window.
  // Fires once per curriculumId per 5 minutes via localStorage.
  useEffect(() => {
    // #418 — skip in read-only/preview mode so peeking at derived-mode on
    // an authored-modules course never mutates the curriculum.
    if (readOnly) return;
    if (!curriculumId || scorecard.structure.outcomesWithoutContent === 0) return;
    const key = `reconcile:${curriculumId}:lastRunAt`;
    const lastRun = Number(localStorage.getItem(key) || "0");
    if (Date.now() - lastRun < 5 * 60 * 1000) return;
    localStorage.setItem(key, String(Date.now()));
    // Fire-and-forget — failures swallowed silently (60s server cooldown
    // may 429 if multiple tabs race; that's fine).
    fetch(`/api/curricula/${curriculumId}/reconcile-orphans`, { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && res.matched > 0) {
          onScorecardRefresh?.();
        }
      })
      .catch(() => {});
  }, [curriculumId, scorecard.structure.outcomesWithoutContent, onScorecardRefresh, readOnly]);

  // #163 Phase 2 — silent background MCQ reconcile. Fires on mount when the
  // course has orphan MCQs and the 5-min client cooldown has expired.
  useEffect(() => {
    // #418 — same read-only gate as the orphan reconcile above.
    if (readOnly) return;
    if (!courseId || mcqOrphans === 0) return;
    const key = `reconcile-mcqs:${courseId}:lastRunAt`;
    const lastRun = Number(localStorage.getItem(key) || "0");
    if (Date.now() - lastRun < 5 * 60 * 1000) return;
    localStorage.setItem(key, String(Date.now()));
    fetch(`/api/courses/${courseId}/reconcile-mcqs`, { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && res.matched > 0) {
          onScorecardRefresh?.();
        }
      })
      .catch(() => {});
  }, [courseId, mcqOrphans, onScorecardRefresh, readOnly]);

  const handleReconcileMcqs = async () => {
    if (reconcilingMcqs) return;
    const confirmMsg =
      `This will try to match ${mcqOrphans} orphan MCQ${mcqOrphans !== 1 ? "s" : ""} ` +
      `to teaching points using AI similarity. It makes 1 embedding API call (~$0.001).`;
    if (!window.confirm(confirmMsg)) return;
    setReconcilingMcqs(true);
    setReconcileBanner(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/reconcile-mcqs`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) {
        if (res.status === 429) {
          setReconcileBanner(
            `MCQ reconcile just ran. Try again in ${data.retryAfter || 60} seconds.`,
          );
        } else {
          setReconcileBanner(`MCQ reconcile failed: ${data.error || "unknown error"}`);
        }
      } else {
        const matched = data.matched ?? 0;
        setReconcileBanner(
          matched === 0
            ? `No additional MCQ matches found.`
            : `Matched ${matched} MCQ${matched !== 1 ? "s" : ""} to teaching points via AI retagging.`,
        );
        onScorecardRefresh?.();
      }
    } catch (e: any) {
      setReconcileBanner(`MCQ reconcile failed: ${e?.message || "network error"}`);
    } finally {
      setReconcilingMcqs(false);
    }
  };

  const handleReconcile = async () => {
    if (!curriculumId || reconciling) return;
    const confirmMsg =
      `This will try to match ${orphans} orphan teaching point${orphans !== 1 ? "s" : ""} ` +
      `to learning outcomes using AI similarity. It makes 1 embedding API call (~$0.001).`;
    if (!window.confirm(confirmMsg)) return;
    setReconciling(true);
    setReconcileBanner(null);
    try {
      const res = await fetch(`/api/curricula/${curriculumId}/reconcile-orphans`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) {
        if (res.status === 429) {
          setReconcileBanner(
            `Reconcile just ran. Try again in ${data.retryAfter || 60} seconds.`,
          );
        } else {
          setReconcileBanner(`Reconcile failed: ${data.error || "unknown error"}`);
        }
      } else {
        const matched = data.matched ?? 0;
        const invalid = data.invalidRefs ?? 0;
        if (matched === 0) {
          setReconcileBanner(
            invalid > 0
              ? `No matches applied. AI returned ${invalid} invalid LO reference${invalid !== 1 ? "s" : ""}. Try reconciling the curriculum.`
              : `No additional matches found. Orphans may need manual linkage or new source content.`,
          );
        } else {
          setReconcileBanner(
            `Matched ${matched} additional teaching point${matched !== 1 ? "s" : ""} via AI retagging.`,
          );
        }
        onScorecardRefresh?.();
      }
    } catch (e: any) {
      setReconcileBanner(`Reconcile failed: ${e?.message || "network error"}`);
    } finally {
      setReconciling(false);
    }
  };

  const tabs: { key: TabKey; icon: ReactNode; label: string; badge: string; tone: TabTone }[] = [
    {
      key: "modules",
      icon: <Layers size={14} />,
      label: "Modules",
      badge: modulesBadge(scorecard),
      tone: modulesTone(scorecard),
    },
    {
      key: "teaching-points",
      icon: <BookOpen size={14} />,
      label: "Teaching Points",
      badge: tpBadge(scorecard),
      tone: tpTone(scorecard),
    },
    {
      key: "questions",
      icon: <HelpCircle size={14} />,
      label: "Questions & MCQs",
      badge: questionsBadge(scorecard),
      tone: questionsTone(scorecard),
    },
    {
      key: "instructions",
      icon: <Wrench size={14} />,
      label: "Tutor Instructions",
      badge: instructionsBadge(scorecard),
      tone: instructionsTone(scorecard),
    },
  ];

  return (
    <div className="hf-card curriculum-scorecard">
      {/* Header: title + regenerate */}
      <div className="curriculum-scorecard-header">
        <div className="curriculum-scorecard-title">
          <HealthPill health={scorecard.health} />
          <span className="hf-section-title">Curriculum health</span>
        </div>
        {isOperator && (regenerateActions || onRegenerate) && (
          <RegenerateDropdown
            scorecard={scorecard}
            actions={regenerateActions}
            onRegenerateFallback={onRegenerate}
            regenerating={regenerating}
            onScorecardRefresh={onScorecardRefresh}
          />
        )}
      </div>

      {/* Reconcile result banner (transient) */}
      {reconcileBanner && (
        <div className="hf-banner hf-banner-info hf-text-xs">
          <Sparkles size={12} /> {reconcileBanner}
          <button
            type="button"
            className="hf-btn-reset hf-ml-auto hf-text-placeholder"
            onClick={() => setReconcileBanner(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Sources header strip — upstream context, not a tab */}
      <SourcesStrip scorecard={scorecard} />

      {/* Tab buttons */}
      <div className="curriculum-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`curriculum-tab curriculum-tab--${tab.tone}${activeTab === tab.key ? " curriculum-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="curriculum-tab-icon">{tab.icon}</span>
            <span className="curriculum-tab-label">{tab.label}</span>
            <span className="curriculum-tab-badge">{tab.badge}</span>
          </button>
        ))}
      </div>

      {/* Active tab panel */}
      <div className="curriculum-tab-panel" role="tabpanel">
        {activeTab === "modules" && (
          <ModulesPanel curriculumId={curriculumId} />
        )}
        {activeTab === "teaching-points" && (
          <AssertionsPanel
            courseId={courseId}
            curriculumId={curriculumId}
            scope="content"
            emptyMessage="No teaching points yet. Upload source documents on the Content tab to extract them."
            showLoCoverage
          />
        )}
        {activeTab === "questions" && (
          <McqPanel courseId={courseId} />
        )}
        {activeTab === "instructions" && (
          <AssertionsPanel
            courseId={courseId}
            curriculumId={null}
            scope="instructions"
            emptyMessage="No tutor instructions yet. These come from COURSE_REFERENCE documents or custom rules."
            groupByCategory
          />
        )}
      </div>

      {/* Warnings strip */}
      {scorecard.warnings.length > 0 && (
        <ul className="curriculum-scorecard-warnings">
          {scorecard.warnings.map((w, i) => (
            <li key={i} className="hf-text-xs">
              <AlertTriangle size={11} className="hf-text-warning" /> {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tab tone helpers — drives the coloured dot on the tab button ──

type TabTone = "healthy" | "weak" | "bad" | "empty";

function pickDefaultTab(sc: CourseLinkageScorecard): TabKey {
  if (modulesTone(sc) !== "healthy") return "modules";
  if (tpTone(sc) !== "healthy") return "teaching-points";
  if (questionsTone(sc) !== "healthy") return "questions";
  if (instructionsTone(sc) !== "healthy") return "instructions";
  return "modules";
}

function modulesBadge(sc: CourseLinkageScorecard): string {
  const m = sc.structure.activeModules;
  const lo = sc.structure.learningOutcomes;
  if (m === 0) return "empty";
  return `${m} mods · ${lo} LOs`;
}
function modulesTone(sc: CourseLinkageScorecard): TabTone {
  if (sc.structure.activeModules === 0) return "empty";
  if (sc.structure.garbageDescriptions > 0) return "bad";
  if (sc.structure.outcomesWithoutContent > 0) return "weak";
  return "healthy";
}

function tpBadge(sc: CourseLinkageScorecard): string {
  if (sc.studentContent.total === 0) return "empty";
  return `${sc.studentContent.linkedToOutcome} of ${sc.studentContent.total} linked`;
}
function tpTone(sc: CourseLinkageScorecard): TabTone {
  if (sc.studentContent.total === 0) return "empty";
  if (sc.studentContent.linkedPct < 20) return "bad";
  if (sc.studentContent.linkedPct < 60) return "weak";
  return "healthy";
}

function questionsBadge(sc: CourseLinkageScorecard): string {
  if (sc.questions.total === 0) return "empty";
  return `${sc.questions.linkedToTp} of ${sc.questions.total} linked`;
}
function questionsTone(sc: CourseLinkageScorecard): TabTone {
  if (sc.questions.total === 0) return "empty";
  if (sc.questions.linkedPct < 20) return "bad";
  if (sc.questions.linkedPct < 50) return "weak";
  return "healthy";
}

function instructionsBadge(sc: CourseLinkageScorecard): string {
  if (sc.tutorInstructions.total === 0) return "none";
  return `${sc.tutorInstructions.total} rules`;
}
function instructionsTone(sc: CourseLinkageScorecard): TabTone {
  if (sc.tutorInstructions.total === 0) return "weak";
  return "healthy";
}

// ── Sources header strip ─────────────────────────────────

function SourcesStrip({ scorecard }: { scorecard: CourseLinkageScorecard }) {
  const { assessmentItems } = scorecard;

  // Assessment items are raw source-document questions (question banks, past
  // papers) — distinct from the generated MCQs shown in the Questions tab.
  // We surface them here so they don't get conflated with the MCQ badge.
  const extra =
    assessmentItems.total > 0
      ? ` · ${assessmentItems.total} source question${assessmentItems.total !== 1 ? "s" : ""} from question banks`
      : "";

  return (
    <div className="curriculum-sources-strip">
      <span className="hf-text-xs hf-text-muted">
        Built from your uploaded documents{extra}
      </span>
      <Link
        href={`/x/courses/${scorecard.course.id}?tab=intelligence`}
        className="hf-link hf-text-xs"
      >
        Manage sources →
      </Link>
    </div>
  );
}

// ── Modules panel ────────────────────────────────────────

function ModulesPanel({ curriculumId }: { curriculumId: string | null }) {
  if (!curriculumId) {
    return (
      <div className="hf-empty">
        <p className="hf-text-sm hf-text-muted">
          No curriculum yet. Upload content on the Content tab to generate one.
        </p>
      </div>
    );
  }
  return <CurriculumEditor curriculumId={curriculumId} />;
}

// ── Assertions panel (shared by Teaching Points + Tutor Instructions) ─

type LoMeta = { ref: string; description: string; moduleOrder: number; loOrder: number };

function AssertionsPanel({
  courseId,
  curriculumId,
  scope,
  emptyMessage,
  showLoCoverage = false,
  groupByCategory = false,
}: {
  courseId: string;
  curriculumId: string | null;
  scope: "content" | "instructions";
  emptyMessage: string;
  showLoCoverage?: boolean;
  groupByCategory?: boolean;
}) {
  const [items, setItems] = useState<Assertion[]>([]);
  const [loMeta, setLoMeta] = useState<Map<string, LoMeta>>(new Map());
  const [loading, setLoading] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/courses/${courseId}/assertions?scope=${scope}&limit=500`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.ok && Array.isArray(res.assertions)) {
          setItems(res.assertions);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, scope]);

  // Fetch curriculum LO metadata (for sorting + descriptions) when this panel
  // groups by LO. Uses the same endpoint the Modules tab reads from, so labels
  // and ordering always match between the two tabs.
  useEffect(() => {
    if (!curriculumId || !showLoCoverage) return;
    let cancelled = false;
    fetch(`/api/curricula/${curriculumId}/modules`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !Array.isArray(res.modules)) return;
        const map = new Map<string, LoMeta>();
        res.modules.forEach((m: any, mi: number) => {
          const los: Array<{ ref: string; description: string }> =
            m.learningObjectives ?? [];
          los.forEach((lo, li) => {
            if (!lo.ref) return;
            map.set(lo.ref, {
              ref: lo.ref,
              description: lo.description ?? "",
              moduleOrder: mi,
              loOrder: li,
            });
          });
        });
        setLoMeta(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [curriculumId, showLoCoverage]);

  // Keyboard nav when drawer is open
  const handleKeyNav = useCallback(
    (e: KeyboardEvent) => {
      if (!drawerId || items.length === 0) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const idx = items.findIndex((it) => it.id === drawerId);
      const next =
        e.key === "ArrowDown" ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      if (next !== idx) setDrawerId(items[next].id);
    },
    [drawerId, items],
  );

  useEffect(() => {
    if (!drawerId) return;
    document.addEventListener("keydown", handleKeyNav);
    return () => document.removeEventListener("keydown", handleKeyNav);
  }, [drawerId, handleKeyNav]);

  // Group by LO ref or category. When showing LO coverage, also surface LOs
  // from the curriculum that have zero assertions (so red "no coverage" dots
  // appear for them) and sort groups in curriculum order, not lexicographically.
  const orderedGroups = useMemo(() => {
    const groups = new Map<string, Assertion[]>();
    for (const a of items) {
      const key = groupByCategory
        ? a.category || "uncategorised"
        : a.learningOutcomeRef || "Unassigned";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }

    if (showLoCoverage && loMeta.size > 0) {
      // Seed every known LO so zero-coverage ones appear in the list
      for (const ref of loMeta.keys()) {
        if (!groups.has(ref)) groups.set(ref, []);
      }
      // Sort in curriculum order (module index, then LO index), Unassigned last
      return Array.from(groups.entries()).sort(([a], [b]) => {
        if (a === "Unassigned") return 1;
        if (b === "Unassigned") return -1;
        const ma = loMeta.get(a);
        const mb = loMeta.get(b);
        if (ma && mb) {
          if (ma.moduleOrder !== mb.moduleOrder) return ma.moduleOrder - mb.moduleOrder;
          return ma.loOrder - mb.loOrder;
        }
        if (ma) return -1;
        if (mb) return 1;
        return a.localeCompare(b, undefined, { numeric: true });
      });
    }

    if (groupByCategory) {
      return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    }

    // Fallback: natural sort on the ref string (LO1, LO2, ..., LO19)
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [items, groupByCategory, showLoCoverage, loMeta]);

  if (loading && items.length === 0) {
    return (
      <div className="curriculum-panel-loading">
        <div className="hf-spinner" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="hf-empty">
        <p className="hf-text-sm hf-text-muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <div className="curriculum-assertion-list">
        {orderedGroups.map(([groupKey, rows]) => {
          const meta = showLoCoverage ? loMeta.get(groupKey) : undefined;
          return (
            <div key={groupKey} className="curriculum-assertion-group">
              <div
                className="curriculum-assertion-group-header"
                title={meta?.description || undefined}
              >
                {showLoCoverage && groupKey !== "Unassigned" && (
                  <CoverageDot count={rows.length} />
                )}
                <span className="curriculum-assertion-group-label">{groupKey}</span>
                {meta?.description && (
                  <span className="curriculum-assertion-group-desc">
                    {meta.description}
                  </span>
                )}
                <span className="curriculum-assertion-group-count">({rows.length})</span>
              </div>
              {rows.length === 0 ? (
                <div className="curriculum-assertion-empty hf-text-xs hf-text-muted">
                  No teaching points linked to this outcome yet.
                </div>
              ) : (
                rows.map((a) => (
                  <AssertionRow
                    key={a.id}
                    assertion={a}
                    active={drawerId === a.id}
                    onSelect={() => setDrawerId(a.id)}
                    showLinkConfidence={showLoCoverage}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
      <AssertionDetailDrawer
        courseId={courseId}
        curriculumId={curriculumId}
        assertionId={drawerId}
        onClose={() => setDrawerId(null)}
        onSaved={() => {
          // Re-fetch the assertions list so the row moves into its new group
          // and its chip updates with the new confidence.
          setLoading(true);
          fetch(`/api/courses/${courseId}/assertions?scope=${scope}&limit=500`)
            .then((r) => r.json())
            .then((res) => {
              if (res.ok && Array.isArray(res.assertions)) {
                setItems(res.assertions);
              }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
        }}
      />
    </>
  );
}

function AssertionRow({
  assertion,
  active,
  onSelect,
  showLinkConfidence,
}: {
  assertion: Assertion;
  active: boolean;
  onSelect: () => void;
  showLinkConfidence: boolean;
}) {
  const cs = getCategoryStyle(assertion.category);
  const categoryMeta = CONTENT_CATEGORIES[assertion.category];
  // Prefer the human label ("Vocabulary") over the raw key ("vocabulary_highlight").
  // Fallback to a best-effort title-cased version when the category is unknown
  // to the registry — keeps unknown extraction types readable.
  const humanLabel =
    categoryMeta?.label ??
    assertion.category
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <button
      type="button"
      className={`hf-btn-reset curriculum-assertion-row${active ? " curriculum-assertion-row--active" : ""}`}
      onClick={onSelect}
      title={assertion.assertion}
    >
      {showLinkConfidence ? (
        <LinkConfidenceChip linkConfidence={assertion.linkConfidence} />
      ) : (
        <TrustBadge level={assertion.trustLevel} />
      )}
      <span
        className="hf-micro-badge-sm curriculum-assertion-category"
        style={{ background: cs.color }}
        title={`Category: ${assertion.category}`}
      >
        {humanLabel}
      </span>
      <span className="hf-flex-1 hf-text-secondary hf-text-xs hf-text-left">
        {assertion.assertion}
      </span>
      {assertion.sourceName && (
        <span className="hf-text-xs hf-text-placeholder curriculum-assertion-source">
          [{assertion.sourceName}]
        </span>
      )}
      {assertion.session != null && (
        <span className="hf-micro-badge-sm curriculum-assertion-session">
          S{assertion.session}
        </span>
      )}
    </button>
  );
}

// ── Coverage dot + trust badge ───────────────────────────

function CoverageDot({ count }: { count: number }) {
  const tone = count >= 3 ? "healthy" : count >= 1 ? "weak" : "bad";
  return (
    <span
      className={`curriculum-coverage-dot curriculum-coverage-dot--${tone}`}
      title={
        tone === "healthy"
          ? "Healthy coverage"
          : tone === "weak"
            ? "Weak coverage (<3 teaching points)"
            : "No teaching points"
      }
    />
  );
}

function LinkConfidenceChip({ linkConfidence }: { linkConfidence: number | null }) {
  if (linkConfidence == null) {
    return (
      <span
        className="curriculum-confidence-chip curriculum-confidence-chip--unknown"
        title="Link confidence not recorded (legacy row)"
      >
        ?
      </span>
    );
  }
  const pct = Math.round(linkConfidence * 100);
  const tone =
    linkConfidence >= 0.85 ? "strong" : linkConfidence >= 0.6 ? "ok" : "weak";
  return (
    <span
      className={`curriculum-confidence-chip curriculum-confidence-chip--${tone}`}
      title={`Link confidence: ${pct}%`}
    >
      {pct}%
    </span>
  );
}

function TrustBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const normalised = level.toUpperCase();
  const tone =
    normalised === "HIGH" || normalised === "VERIFIED"
      ? "high"
      : normalised === "LOW" || normalised === "UNVERIFIED"
        ? "low"
        : "med";
  return (
    <span
      className={`curriculum-trust-dot curriculum-trust-dot--${tone}`}
      title={`Trust: ${normalised.toLowerCase()}`}
    />
  );
}

// ── MCQ trust badge (#281 Slice 3b) ──────────────────────
//
// Maps ContentQuestion.trustLevel → a small inline badge shown next to each
// MCQ in the curriculum admin view. Provides educators a visual signal of
// where each question came from. AI_ASSISTED is the default and visually
// the least loud (muted); imported / accredited content gets a louder tone.
// UNVERIFIED and null render NOTHING so the panel doesn't get cluttered
// with badges on legacy rows that haven't been re-imported yet.

function McqTrustBadge({ level }: { level: string | null }) {
  if (!level || level === "UNVERIFIED") return null;
  const config: Record<string, { label: string; tone: string; title: string }> = {
    AI_ASSISTED: {
      label: "AI",
      tone: "hf-badge-muted",
      title: "AI-assisted: generated from extracted assertions. Lowest trust tier among populated rows.",
    },
    EXPERT_CURATED: {
      label: "Curated",
      tone: "hf-badge-info",
      title: "Expert-curated: imported from a question bank reviewed by a subject expert.",
    },
    ACCREDITED_MATERIAL: {
      label: "Accredited",
      tone: "hf-badge-success",
      title: "Accredited material: imported from an accrediting body's question bank.",
    },
    REGULATORY_STANDARD: {
      label: "Regulatory",
      tone: "hf-badge-success",
      title: "Regulatory standard: imported from an official regulatory body source.",
    },
  };
  const c = config[level];
  if (!c) return null;
  return (
    <span className={`hf-badge hf-badge-xs ${c.tone}`} title={c.title}>
      {c.label}
    </span>
  );
}

// ── MCQ panel ────────────────────────────────────────────
//
// Exported so authored-modules courses (which hide the parent
// CurriculumHealthTabs to suppress the scorecard + regenerate affordances)
// can still render this panel directly. Without this, educators on
// authored courses had no path to see their generated MCQs in the
// curriculum tab — the questions existed but weren't surfaced.

export function McqPanel({ courseId }: { courseId: string }) {
  const [items, setItems] = useState<McqItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/courses/${courseId}/questions?limit=500`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.ok && Array.isArray(res.questions)) {
          setItems(res.questions);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading && items.length === 0) {
    return (
      <div className="curriculum-panel-loading">
        <div className="hf-spinner" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="hf-empty">
        <p className="hf-text-sm hf-text-muted">
          No questions yet. Generate them from your teaching points on the Content tab.
        </p>
      </div>
    );
  }

  return (
    <div className="curriculum-mcq-list">
      {items.map((q) => (
        <div key={q.id} className="curriculum-mcq-row">
          <span className="hf-micro-badge-sm curriculum-mcq-type">{q.questionType}</span>
          <McqTrustBadge level={q.trustLevel} />
          <span className="hf-flex-1 hf-text-secondary hf-text-xs">{q.questionText}</span>
          {q.assertion?.learningOutcomeRef && (
            <span className="hf-micro-badge-sm curriculum-mcq-lo">
              {q.assertion.learningOutcomeRef}
            </span>
          )}
          {q.assertion ? (
            <span className="curriculum-mcq-tp-chip" title={q.assertion.text}>
              → TP
            </span>
          ) : (
            <span
              className="curriculum-mcq-tp-chip curriculum-mcq-tp-chip--unlinked"
              title="Not linked to a teaching point"
            >
              unlinked
            </span>
          )}
          {q.sourceName && (
            <span className="hf-text-xs hf-text-placeholder">[{q.sourceName}]</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Health pill (preserved from original) ────────────────

function HealthPill({ health }: { health: CurriculumHealth }) {
  const config: Record<CurriculumHealth, { label: string; icon: ReactNode; className: string }> = {
    ready: {
      label: "Ready",
      icon: <CheckCircle2 size={13} />,
      className: "curriculum-health-pill--ready",
    },
    nearly_there: {
      label: "Nearly there",
      icon: <CircleDot size={13} />,
      className: "curriculum-health-pill--nearly",
    },
    needs_attention: {
      label: "Needs attention",
      icon: <AlertTriangle size={13} />,
      className: "curriculum-health-pill--attention",
    },
    not_started: {
      label: "Not started",
      icon: <Clock size={13} />,
      className: "curriculum-health-pill--notstarted",
    },
  };
  const c = config[health];
  return (
    <span className={`curriculum-health-pill ${c.className}`}>
      {c.icon}
      {c.label}
    </span>
  );
}
