'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles, MessageCircle, Ban, ChevronDown, ChevronRight,
  Plus, Pencil, X as XIcon, Upload, ArrowRight, RefreshCw,
} from 'lucide-react';
import { PlanSummary, type PlanSession } from '@/app/x/courses/_components/PlanSummary';
import { getLessonPlanModel } from '@/lib/lesson-plan/models';
import { OnboardingPreview, type OnboardingPhase as OBPhase } from '@/components/shared/OnboardingPreview';
import { getTeachingProfile, resolveTeachingProfile } from '@/lib/content-trust/teaching-profiles';
import { TEACHING_MODE_LABELS, INTERACTION_PATTERN_LABELS, type TeachingMode, type InteractionPattern } from '@/lib/content-trust/resolve-config';
import type { PlaybookConfig } from '@/lib/types/json-fields';

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
  sessionPlan: {
    entries: Array<{ session: number; type: string; label: string }>;
    estimatedSessions: number;
    totalDurationMins: number;
    model?: string | null;
    generatedAt?: string | null;
  } | null;
  onTabChange?: (tab: string) => void;
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

type InstructionItem = {
  id: string;
  assertion: string;
  category: string;
  chapter: string | null;
  section: string | null;
  tags: string[];
  depth: number | null;
  sourceName: string | null;
};

type InstructionsData = {
  categories: Record<string, InstructionItem[]>;
  totals: Record<string, number>;
  grandTotal: number;
  sourceCount: number;
};

// ── Section Header ─────────────────────────────────────

function SectionHeader({ title, icon: Icon, subtitle }: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  subtitle?: string;
}) {
  return (
    <div className="hf-flex hf-flex-col hf-mb-md hf-section-divider">
      <div className="hf-flex hf-gap-sm hf-items-center">
        <Icon size={18} className="hf-text-muted" />
        <h2 className="hf-section-title hf-mb-0">{title}</h2>
      </div>
      {subtitle && (
        <p className="hf-text-xs hf-text-muted hf-mt-xs hf-mb-0">{subtitle}</p>
      )}
    </div>
  );
}

// ── Session Flow Pipeline ──────────────────────────────

function SessionFlowPipeline({ items }: { items: InstructionItem[] }) {
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
        <div className="hf-flex hf-flex-col hf-gap-xs hf-mt-sm">
          {validItems.length === 0 ? (
            <span className="hf-text-sm hf-text-muted">No instructions extracted — try re-extracting the reference document.</span>
          ) : validItems.map((item) => (
            <div key={item.id} className="cd-instruction-item">
              <span className="cd-instruction-bullet" />
              <span className="hf-text-sm">{item.assertion}</span>
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
  sessionPlan,
  onTabChange,
  onDetailUpdate,
}: CourseHowTabProps) {
  const config = (detail.config || {}) as PlaybookConfig;
  const constraints = config.constraints || [];

  // ── State ────────────────────────────────────────────
  const [instructions, setInstructions] = useState<InstructionsData | null>(null);
  const [instructionsLoading, setInstructionsLoading] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(CATEGORY_ORDER));
  const [onboarding, setOnboarding] = useState<{ phases: OBPhase[]; personaName?: string; domainWelcome?: string } | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);
  const [reExtractResult, setReExtractResult] = useState<{ triggered: number; total: number } | null>(null);

  // ── Constraint editing state ─────────────────────────
  const [editingConstraints, setEditingConstraints] = useState(false);
  const [newConstraint, setNewConstraint] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Teaching focus state ─────────────────────────────
  const [teachingFocusDraft, setTeachingFocusDraft] = useState((config as any).teachingFocus || '');
  const [teachingFocusSaving, setTeachingFocusSaving] = useState(false);
  const [teachingFocusSaved, setTeachingFocusSaved] = useState(false);

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

  // ── Lazy-load onboarding ─────────────────────────────
  useEffect(() => {
    setOnboardingLoading(true);
    fetch(`/api/courses/${courseId}/onboarding`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setOnboarding({
            phases: data.phases || [],
            personaName: data.personaName,
            domainWelcome: data.domainWelcome,
          });
        }
      })
      .catch(() => {})
      .finally(() => setOnboardingLoading(false));
  }, [courseId]);

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
  const planModel = sessionPlan?.model ? getLessonPlanModel(sessionPlan.model) : null;
  const planModelLabel = planModel?.label || sessionPlan?.model || 'Custom';

  // totalTPs not currently displayed in HOW tab — available if needed

  return (
    <>
      {/* ── 1. Lesson Plan Summary ──────────────────────── */}
      {sessionPlan && sessionPlan.entries.length > 0 && (
        <>
          <SectionHeader title="Your Lesson Plan" icon={Sparkles} />
          <div className="hf-card-compact hf-mb-lg">
            <PlanSummary
              state="ready"
              sessions={sessionPlan.entries.map((e) => ({
                type: e.type,
                label: e.label,
              }))}
            />
            <div className="hf-flex hf-flex-between hf-items-center hf-mt-md">
              <div className="hf-text-xs hf-text-muted">
                {sessionPlan.estimatedSessions} sessions
                {sessionPlan.totalDurationMins > 0 && (
                  <> &middot; ~{sessionPlan.totalDurationMins >= 60
                    ? `${Math.round(sessionPlan.totalDurationMins / 60 * 10) / 10}h`
                    : `${sessionPlan.totalDurationMins}m`
                  }</>
                )}
                {' '}&middot; {planModelLabel}
              </div>
              <button
                className="hf-btn hf-btn-xs hf-btn-ghost"
                onClick={() => onTabChange?.('lessons')}
                type="button"
              >
                View full plan <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 2. First Call Flow ───────────────────────────── */}
      <SectionHeader
        title="First Call"
        icon={MessageCircle}
        subtitle="How session 1 works — the onboarding experience"
      />
      <div className="hf-card-compact hf-mb-lg">
        {onboardingLoading ? (
          <div className="hf-text-sm hf-text-muted hf-glow-active">Loading first call structure...</div>
        ) : onboarding && onboarding.phases.length > 0 ? (
          <OnboardingPreview
            phases={onboarding.phases}
            personaName={onboarding.personaName}
            greeting={onboarding.domainWelcome}
            maxHeight={280}
          />
        ) : (
          <div className="hf-flex hf-flex-col hf-items-center hf-gap-sm hf-py-md">
            <div className="hf-text-sm hf-text-muted">No first call flow configured.</div>
            <button className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => onTabChange?.('settings')}>
              Configure in Settings
            </button>
          </div>
        )}
      </div>

      {/* ── 3. Every Session Flow ───────────────────────── */}
      {!instructionsLoading && sessionFlowItems.length > 0 && (
        <>
          <SectionHeader
            title="Every Session"
            icon={Sparkles}
            subtitle="How sessions 2+ are structured (from your course reference)"
          />
          <div className="hf-card-compact hf-mb-lg">
            <SessionFlowPipeline items={sessionFlowItems} />
          </div>
        </>
      )}

      {/* ── 4. Teaching Approach ─────────────────────────── */}
      {subjects.some((s) => s.teachingProfile) && (
        <>
          <SectionHeader title="Teaching Approach" icon={Sparkles} />
          <div className="hf-card-compact hf-mb-lg">
            {subjects.filter((s) => s.teachingProfile).map((sub) => {
              const profile = getTeachingProfile(sub.teachingProfile);
              if (!profile) return null;
              const modeLabel = TEACHING_MODE_LABELS[profile.teachingMode as TeachingMode]?.label ?? profile.teachingMode;
              const patternLabel = INTERACTION_PATTERN_LABELS[profile.interactionPattern as InteractionPattern]?.label ?? profile.interactionPattern;
              return (
                <div key={sub.id} className="hf-mb-sm">
                  <div className="hf-flex hf-gap-sm hf-items-center hf-text-sm">
                    <Link href={`/x/courses/${courseId}/subjects/${sub.id}`} className="hf-link"><strong>{sub.name}</strong></Link>
                    <span className="hf-badge hf-badge-sm hf-badge-accent">{profile.key}</span>
                  </div>
                  <p className="hf-text-xs hf-text-muted hf-mt-xs hf-mb-0">
                    {profile.description}
                  </p>
                  <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-mt-xs">
                    <span>Teaching mode: {modeLabel}</span>
                    <span>Interaction: {patternLabel}</span>
                  </div>
                  <div className="hf-text-xs hf-text-muted hf-mt-xs">
                    Best for: {profile.bestFor}
                  </div>
                </div>
              );
            })}

            {/* Editable teaching focus (course-level override) */}
            {isOperator && (
              <div className="cov-teaching-focus-box hf-mt-md">
                <label className="hf-label hf-text-xs">Teaching Focus (course-level)</label>
                <textarea
                  value={teachingFocusDraft}
                  onChange={(e) => { setTeachingFocusDraft(e.target.value); setTeachingFocusSaved(false); }}
                  placeholder={(() => {
                    const sub = subjects.find((s) => s.teachingProfile);
                    if (!sub) return 'Describe what students should take away...';
                    const resolved = resolveTeachingProfile(sub);
                    return resolved?.teachingFocus || 'Describe what students should take away...';
                  })()}
                  className="hf-input hf-text-sm cov-teaching-focus-textarea"
                  rows={3}
                />
                <div className="hf-flex hf-gap-sm hf-items-center hf-mt-xs">
                  <button
                    onClick={async () => {
                      setTeachingFocusSaving(true);
                      try {
                        await saveConfig({ teachingFocus: teachingFocusDraft.trim() || null });
                        setTeachingFocusSaved(true);
                      } finally {
                        setTeachingFocusSaving(false);
                      }
                    }}
                    disabled={teachingFocusSaving}
                    className="hf-btn hf-btn-primary hf-btn-xs"
                    type="button"
                  >
                    {teachingFocusSaving ? 'Saving...' : 'Save'}
                  </button>
                  {teachingFocusSaved && <span className="hf-text-xs hf-text-success">Saved</span>}
                  {!teachingFocusDraft && subjects.some((s) => s.teachingProfile) && (
                    <span className="hf-text-xs hf-text-muted">
                      Inherited from subject profile
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 5. Extracted Teaching Instructions ───────────── */}
      <SectionHeader title="Teaching Instructions" icon={Sparkles} />
      <div className="hf-mb-lg">
        {instructionsLoading ? (
          <div className="hf-card-compact">
            <div className="hf-text-sm hf-text-muted hf-glow-active">Loading teaching instructions...</div>
          </div>
        ) : instructions && instructions.grandTotal > 0 ? (
          <>
            {/* Summary line + re-extract button */}
            <div className="cd-instruction-summary hf-flex hf-flex-between hf-items-center hf-mb-sm">
              <span className="hf-text-xs hf-text-muted">
                {instructions.grandTotal} teaching instruction{instructions.grandTotal !== 1 ? 's' : ''}
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

            {/* Category cards — skip session_flow (rendered above as pipeline) */}
            {CATEGORY_ORDER
              .filter((key) => {
                const items = instructions.categories[key];
                return items && items.length > 0;
              })
              .map((key) => (
                <InstructionCategory
                  key={key}
                  categoryKey={key}
                  items={instructions.categories[key]}
                  expanded={expandedCategories.has(key)}
                  onToggle={() => toggleCategory(key)}
                />
              ))
            }
          </>
        ) : (
          <div className="hf-card-compact">
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
          </div>
        )}
      </div>

      {/* ── 6. Boundaries ───────────────────────────────── */}
      <SectionHeader title="Boundaries" icon={Ban} />
      <div className="hf-card-compact hf-mb-lg">
        {constraints.length === 0 && !editingConstraints ? (
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
            <div className="hf-flex hf-flex-wrap hf-gap-sm">
              {constraints.map((c, i) => (
                <span key={i} className="cov-constraint-chip">
                  <Ban size={11} className="hf-flex-shrink-0" />
                  <span>{c}</span>
                  {isOperator && editingConstraints && (
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
                </span>
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
