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

import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
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
  sourceName: string | null;
  session: number | null;
};

type McqItem = {
  id: string;
  questionText: string;
  questionType: string;
  assertion: { id: string; text: string; category: string; learningOutcomeRef: string | null } | null;
  sourceName: string | null;
  linkedToTp: boolean;
};

interface Props {
  scorecard: CourseLinkageScorecard;
  courseId: string;
  curriculumId: string | null;
  isOperator: boolean;
  onRegenerate?: () => void;
  regenerating: boolean;
}

// ── Main component ───────────────────────────────────────

export function CurriculumHealthTabs({
  scorecard,
  courseId,
  curriculumId,
  isOperator,
  onRegenerate,
  regenerating,
}: Props) {
  const defaultTab = pickDefaultTab(scorecard);
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

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
        {onRegenerate && (
          <button
            type="button"
            className="hf-btn hf-btn-primary hf-btn-sm"
            onClick={onRegenerate}
            disabled={regenerating}
            title="Rebuild the curriculum from your uploaded content"
          >
            {regenerating ? (
              <>
                <RefreshCw size={13} className="hf-glow-active" /> Regenerating…
              </>
            ) : (
              <>
                <Sparkles size={13} /> Regenerate
              </>
            )}
          </button>
        )}
      </div>

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
        href={`/x/courses/${scorecard.course.id}?tab=content`}
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
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
      <AssertionDetailDrawer
        courseId={courseId}
        assertionId={drawerId}
        onClose={() => setDrawerId(null)}
      />
    </>
  );
}

function AssertionRow({
  assertion,
  active,
  onSelect,
}: {
  assertion: Assertion;
  active: boolean;
  onSelect: () => void;
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
      <TrustBadge level={assertion.trustLevel} />
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

// ── MCQ panel ────────────────────────────────────────────

function McqPanel({ courseId }: { courseId: string }) {
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
