'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles, Ban, ChevronDown, ChevronRight,
  Plus, Pencil, X as XIcon, Upload, RefreshCw,
} from 'lucide-react';
import type { PlaybookConfig } from '@/lib/types/json-fields';
import { SectionHeader } from './SectionHeader';

// ── Types ──────────────────────────────────────────────

export type CourseHowTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    config?: Record<string, unknown> | null;
    domain: { id: string; name: string; slug: string };
  };
  subjects: Array<{
    id: string; slug: string; name: string; description: string | null;
    defaultTrustLevel: string; teachingProfile: string | null;
    sourceCount: number; curriculumCount: number; assertionCount: number;
  }>;
  isOperator: boolean;
  persona: {
    name: string;
    extendsAgent: string | null | undefined;
    roleStatement: string | null;
    primaryGoal: string | null;
  } | null;
  onDetailUpdate?: (updater: (prev: any) => any) => void;
};

// ── Instruction category config ────────────────────────

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  teaching_rule:          { label: 'Teaching Rules',  icon: '\u{1F4CF}' },
  session_flow:           { label: 'Session Flow',    icon: '\u{1F504}' },
  scaffolding_technique:  { label: 'Scaffolding',     icon: '\u{1FA9C}' },
  skill_framework:        { label: 'Skills Framework', icon: '\u{1F4CA}' },
  communication_rule:     { label: 'Communication',   icon: '\u{1F4AC}' },
  assessment_approach:    { label: 'Assessment',       icon: '\u2705'   },
  differentiation:        { label: 'Differentiation',  icon: '\u{1F3AF}' },
  edge_case:              { label: 'Edge Cases',       icon: '\u26A1'   },
};

const CATEGORY_ORDER = [
  'teaching_rule',
  'scaffolding_technique',
  'skill_framework',
  'edge_case',
  'communication_rule',
  'assessment_approach',
  'differentiation',
];

export type InstructionItem = {
  id: string;
  assertion: string;
  category: string;
  chapter: string | null;
  section: string | null;
  tags: string[];
  depth: number | null;
  sourceName: string | null;
  fromCourseRef?: boolean;
};

type InstructionsData = {
  categories: Record<string, InstructionItem[]>;
  totals: Record<string, number>;
  grandTotal: number;
  sourceCount: number;
};

// ── Session Flow Pipeline ──────────────────────────────

export function SessionFlowPipeline({ items }: { items: InstructionItem[] }) {
  // Detect sequential phases: look for numbered or arrow-separated steps
  const phases = items.map((item) => {
    const text = item.assertion.replace(/^\d+[\.\)]\s*/, '').trim();
    return { id: item.id, text };
  });

  return (
    <div className="cd-flow-pipeline">
      {phases.map((phase, i) => (
        <div key={phase.id} className="cd-flow-step">
          <span className="cd-flow-step-num">{i + 1}</span>
          <span className="cd-flow-step-label">{phase.text}</span>
        </div>
      ))}
    </div>
  );
}

// ── Instruction Category Card ──────────────────────────

function InstructionCategory({
  categoryKey,
  items,
  expanded,
  onToggle,
}: {
  categoryKey: string;
  items: InstructionItem[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const config = CATEGORY_LABELS[categoryKey] || { label: categoryKey, icon: '\u{1F4CB}' };
  // Filter out blank assertions that may have been stored
  const validItems = items.filter((item) => item.assertion?.trim());

  return (
    <div className="cd-instruction-card hf-card-compact hf-mb-sm">
      <button
        className="cd-category-header"
        onClick={onToggle}
        type="button"
      >
        <span className="cd-category-icon">{config.icon}</span>
        <span className="hf-text-sm hf-text-bold hf-flex-1">{config.label}</span>
        <span className="hf-badge hf-badge-sm hf-badge-muted">{validItems.length}</span>
        {expanded ? <ChevronDown size={14} className="hf-text-muted" /> : <ChevronRight size={14} className="hf-text-muted" />}
      </button>

      {expanded && (
        <div className="hf-flex-col hf-gap-xs hf-mt-sm">
          {validItems.length === 0 ? (
            <span className="hf-text-sm hf-text-muted">No instructions extracted — try re-extracting the reference document.</span>
          ) : validItems.map((item) => (
            <div key={item.id} className="cd-instruction-item">
              <span className="cd-instruction-bullet" />
              <span className="hf-text-sm">{item.assertion.replace(/^[\s•\-–—]+/, '')}</span>
              {item.fromCourseRef && (
                <span className="hf-badge hf-badge-xs hf-badge-accent" title="From Course Reference">ref</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

export function CourseHowTab({
  courseId,
  detail,
  subjects,
  isOperator,
  persona,
  onDetailUpdate,
}: CourseHowTabProps) {
  const config = (detail.config || {}) as PlaybookConfig;
  const constraints = config.constraints || [];

  // ── State ────────────────────────────────────────────
  const [instructions, setInstructions] = useState<InstructionsData | null>(null);
  const [instructionsLoading, setInstructionsLoading] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(CATEGORY_ORDER));
  const [reExtracting, setReExtracting] = useState(false);
  const [reExtractResult, setReExtractResult] = useState<{ triggered: number; total: number } | null>(null);

  // ── Constraint editing state ─────────────────────────
  const [editingConstraints, setEditingConstraints] = useState(false);
  const [newConstraint, setNewConstraint] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Teaching focus state ─────────────────────────────

  // ── Config save helper ───────────────────────────────
  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: patch }),
      });
      const data = await res.json();
      if (data.ok && onDetailUpdate) {
        onDetailUpdate((prev: any) => prev ? {
          ...prev,
          config: { ...(prev.config || {}), ...patch },
        } : prev);
      }
      return data.ok;
    } finally {
      setSaving(false);
    }
  }, [detail.id, onDetailUpdate]);

  // ── Lazy-load instructions ───────────────────────────
  useEffect(() => {
    setInstructionsLoading(true);
    fetch(`/api/courses/${courseId}/course-instructions`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setInstructions({
            categories: data.categories || {},
            totals: data.totals || {},
            grandTotal: data.grandTotal || 0,
            sourceCount: data.sourceCount || 0,
          });
        }
      })
      .catch(() => {})
      .finally(() => setInstructionsLoading(false));
  }, [courseId]);

  // ── Helpers ──────────────────────────────────────────
  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleReExtract = useCallback(async () => {
    setReExtracting(true);
    setReExtractResult(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/re-extract-instructions`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setReExtractResult({ triggered: data.triggered, total: data.total });
        // Re-fetch instructions after a delay to let extraction complete
        if (data.triggered > 0) {
          setTimeout(() => {
            setInstructionsLoading(true);
            fetch(`/api/courses/${courseId}/course-instructions`)
              .then((r) => r.json())
              .then((d) => {
                if (d.ok) {
                  setInstructions({
                    categories: d.categories || {},
                    totals: d.totals || {},
                    grandTotal: d.grandTotal || 0,
                    sourceCount: d.sourceCount || 0,
                  });
                }
              })
              .catch(() => {})
              .finally(() => {
                setInstructionsLoading(false);
                setReExtracting(false);
                setTimeout(() => setReExtractResult(null), 5000);
              });
          }, 8000); // Give extraction time to complete
        } else {
          setReExtracting(false);
        }
      } else {
        setReExtracting(false);
      }
    } catch {
      setReExtracting(false);
    }
  }, [courseId]);

  const sessionFlowItems = instructions?.categories?.session_flow || [];

  // Auto-extract boundary items from teaching_rule + edge_case assertions
  const PROHIBITION_RE = /\b(never|do not|don'?t|avoid|must not|should not|shouldn'?t|forbidden|prohibited|not allowed)\b/i;
  const boundaryItemIds = new Set<string>();
  const extractedBoundaries = instructions
    ? [...(instructions.categories.teaching_rule || []), ...(instructions.categories.edge_case || [])]
        .filter((item) => {
          if (!PROHIBITION_RE.test(item.assertion)) return false;
          boundaryItemIds.add(item.id);
          return true;
        })
        .map((item) => item.assertion.replace(/^[\s•\-–—]+/, ''))
    : [];
  // Merge: manual constraints first, then extracted (deduped)
  const manualSet = new Set(constraints.map((c) => c.toLowerCase().trim()));
  const allBoundaries = [
    ...constraints,
    ...extractedBoundaries.filter((b) => !manualSet.has(b.toLowerCase().trim())),
  ];

  // Filter boundary items out of instruction categories to avoid duplication
  const filteredCategories = instructions
    ? Object.fromEntries(
        Object.entries(instructions.categories).map(([key, items]) => [
          key,
          (key === 'teaching_rule' || key === 'edge_case')
            ? items.filter((item) => !boundaryItemIds.has(item.id))
            : items,
        ]),
      )
    : {};

  return (
    <>
      {/* ── Course Reference Builder CTA ───────────────── */}
      {isOperator && (
        <div className="hf-mb-md">
          <Link
            href={`/x/course-reference?courseId=${courseId}`}
            className="hf-btn hf-btn-sm hf-btn-outline hf-flex hf-items-center hf-gap-xs"
          >
            <Pencil size={13} />
            {instructions && instructions.grandTotal > 0 ? 'Edit Course Reference' : 'Build Course Reference'}
          </Link>
        </div>
      )}

      {/* ── 3. Extracted Teaching Instructions ───────────── */}
      <SectionHeader title="Teaching Instructions" icon={Sparkles} />
      <div className="hf-mb-lg">
        {instructionsLoading || reExtracting ? (
          <div className="hf-card-compact">
            <div className="hf-text-sm hf-text-muted hf-glow-active">
              {reExtracting ? 'Extracting teaching instructions from your sources...' : 'Loading teaching instructions...'}
            </div>
          </div>
        ) : instructions && instructions.grandTotal > 0 ? (
          <>
            {/* Summary line + re-extract button */}
            <div className="cd-instruction-summary hf-flex hf-flex-between hf-items-center hf-mb-sm">
              <span className="hf-text-xs hf-text-muted">
                {instructions.grandTotal - (instructions.totals?.assessment_approach || 0) - boundaryItemIds.size} teaching instruction{(instructions.grandTotal - (instructions.totals?.assessment_approach || 0) - boundaryItemIds.size) !== 1 ? 's' : ''}
                {' '}&middot; {instructions.sourceCount} reference doc{instructions.sourceCount !== 1 ? 's' : ''}
                {reExtractResult && (
                  <span className="hf-text-success"> &mdash; Re-extracted {reExtractResult.triggered} source{reExtractResult.triggered !== 1 ? 's' : ''}</span>
                )}
              </span>
              {isOperator && (
                <button
                  className="hf-btn hf-btn-xs hf-btn-ghost"
                  onClick={handleReExtract}
                  disabled={reExtracting}
                  title="Re-extract teaching instructions from all reference docs"
                  type="button"
                >
                  <RefreshCw size={12} className={reExtracting ? 'hf-spin' : ''} />
                  {reExtracting ? 'Re-extracting...' : 'Re-extract'}
                </button>
              )}
            </div>

            {/* Category cards — skip session_flow (pipeline above), assessment_approach (What tab), boundary items (below) */}
            {CATEGORY_ORDER
              .filter((key) => {
                if (key === 'assessment_approach') return false;
                const items = filteredCategories[key];
                return items && items.length > 0;
              })
              .map((key) => (
                <InstructionCategory
                  key={key}
                  categoryKey={key}
                  items={filteredCategories[key] as InstructionItem[]}
                  expanded={expandedCategories.has(key)}
                  onToggle={() => toggleCategory(key)}
                />
              ))
            }
          </>
        ) : (
          <div className="hf-card-compact">
            {subjects.some((s) => s.sourceCount > 0) ? (
              <>
                <div className="hf-text-sm hf-text-muted hf-mb-sm">
                  No instructions extracted yet. Your sources may still be processing,
                  or no teaching reference doc was uploaded.
                </div>
                <div className="hf-flex hf-gap-sm">
                  {isOperator && (
                    <button
                      className="hf-btn hf-btn-sm hf-btn-secondary"
                      onClick={handleReExtract}
                      disabled={reExtracting}
                      type="button"
                    >
                      <RefreshCw size={13} className={reExtracting ? 'hf-spin' : ''} />
                      {reExtracting ? 'Extracting...' : 'Re-extract'}
                    </button>
                  )}
                  {isOperator && subjects.length > 0 && (
                    <Link
                      href={`/x/courses/${courseId}/subjects/${subjects[0].id}`}
                      className="hf-btn hf-btn-sm hf-btn-outline"
                    >
                      <Upload size={13} />
                      Upload Reference Doc
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="hf-text-sm hf-text-muted hf-mb-sm">
                  No teaching reference uploaded yet. Upload a course reference doc and the AI will extract
                  your teaching rules, session flow, and scaffolding techniques automatically.
                </div>
                {isOperator && subjects.length > 0 && (
                  <Link
                    href={`/x/courses/${courseId}/subjects/${subjects[0].id}`}
                    className="hf-btn hf-btn-sm hf-btn-primary"
                  >
                    <Upload size={13} />
                    Upload Reference Doc
                  </Link>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 4. Boundaries ───────────────────────────────── */}
      <SectionHeader title="Boundaries" icon={Ban} />
      <div className="hf-card-compact hf-mb-lg">
        {allBoundaries.length === 0 && !editingConstraints ? (
          <div className="hf-flex hf-flex-between hf-items-center">
            <span className="hf-text-sm hf-text-muted">No boundaries set. These are things the AI should never do.</span>
            {isOperator && (
              <button className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => setEditingConstraints(true)} type="button">
                <Plus size={12} /> Add
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="hf-flex-col hf-gap-xs">
              {allBoundaries.map((c, i) => (
                <div key={i} className="cd-instruction-item">
                  <Ban size={12} className="hf-text-error" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span className="hf-text-sm">{c}</span>
                  {isOperator && editingConstraints && i < constraints.length && (
                    <button
                      className="cov-chip-remove"
                      onClick={async () => {
                        const updated = constraints.filter((_, j) => j !== i);
                        await saveConfig({ constraints: updated });
                        setEditingConstraints(updated.length > 0);
                      }}
                      disabled={saving}
                      type="button"
                    >
                      <XIcon size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {isOperator && (
              <div className="hf-mt-sm">
                {editingConstraints ? (
                  <div className="hf-flex hf-gap-xs hf-items-center">
                    <input
                      className="hf-input hf-input-sm hf-flex-1"
                      placeholder="Never drill vocabulary in isolation..."
                      value={newConstraint}
                      onChange={(e) => setNewConstraint(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newConstraint.trim()) {
                          const updated = [...constraints, newConstraint.trim()];
                          saveConfig({ constraints: updated });
                          setNewConstraint('');
                        }
                      }}
                    />
                    <button
                      className="hf-btn hf-btn-xs hf-btn-primary"
                      disabled={!newConstraint.trim() || saving}
                      onClick={async () => {
                        if (!newConstraint.trim()) return;
                        await saveConfig({ constraints: [...constraints, newConstraint.trim()] });
                        setNewConstraint('');
                      }}
                      type="button"
                    >
                      Add
                    </button>
                    <button
                      className="hf-btn hf-btn-xs hf-btn-secondary"
                      onClick={() => { setEditingConstraints(false); setNewConstraint(''); }}
                      type="button"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <button className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => setEditingConstraints(true)} type="button">
                    <Pencil size={11} /> Edit
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
