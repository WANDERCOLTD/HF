'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  BookMarked, FileText, Plus, Pencil,
  Sparkles, BarChart3, Sliders, Shield, AlertTriangle,
  ChevronRight, Upload, Target, Ban, Users2, MessageCircle,
  ListOrdered, Clock, X as XIcon, Check,
} from 'lucide-react';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import { TrustBadge } from '@/app/x/content-sources/_components/shared/badges';
import { OnboardingPreview, type OnboardingPhase as OBPhase } from '@/components/shared/OnboardingPreview';
import { OnboardingEditor } from '@/components/shared/OnboardingEditor';
import { CourseSetupTracker } from '@/components/shared/CourseSetupTracker';
import { CourseHowTab } from './CourseHowTab';
import {
  archetypeLabel,
  type PlaybookItem,
  type SystemSpec,
  type SpecDetail,
  type SpecGroup,
} from '@/lib/course/group-specs';
import { TEACHING_MODE_LABELS, INTERACTION_PATTERN_LABELS, type TeachingMode, type InteractionPattern } from '@/lib/content-trust/resolve-config';
import { getTeachingProfile, resolveTeachingProfile } from '@/lib/content-trust/teaching-profiles';
import { getAudienceOption, AUDIENCE_OPTIONS } from '@/lib/prompt/composition/transforms/audience';
import type { GoalTemplate, PlaybookConfig, OnboardingFlowPhases } from '@/lib/types/json-fields';
import type { SetupStatusInput } from '@/hooks/useCourseSetupStatus';

// ── Types ──────────────────────────────────────────────

type SubjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultTrustLevel: string;
  teachingProfile: string | null;
  sourceCount: number;
  curriculumCount: number;
  assertionCount: number;
};

type MethodBreakdown = { teachMethod: string; count: number; reviewed: number };

type PersonaInfo = {
  name: string;
  extendsAgent: string | null | undefined;
  roleStatement: string | null;
  primaryGoal: string | null;
} | null;

type SessionPlanInfo = {
  estimatedSessions: number;
  totalDurationMins: number;
  generatedAt?: string | null;
} | null;

export type CourseOverviewTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    config?: Record<string, unknown> | null;
    domain: { id: string; name: string; slug: string };
  };
  subjects: SubjectSummary[];
  contentMethods: MethodBreakdown[];
  contentTotal: number;
  isOperator: boolean;
  persona: PersonaInfo;
  specGroups: { measure: SpecGroup; adapt: SpecGroup; guard: SpecGroup };
  sessionPlan: SessionPlanInfo;
  // CourseSetupTracker props
  sessions: SetupStatusInput['sessions'];
  onSimCall?: () => void;
  // Callbacks for state updates that live in parent
  onContentRefresh?: (methods: MethodBreakdown[], total: number) => void;
  onDetailUpdate?: (updater: (prev: any) => any) => void;
};

// ── Goal type labels (shared with /x/goals page) ───────

const GOAL_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  LEARN: { label: 'Learn', color: 'var(--accent-primary)' },
  ACHIEVE: { label: 'Achieve', color: 'var(--status-warning-text)' },
  CHANGE: { label: 'Change', color: 'var(--badge-purple-text)' },
  CONNECT: { label: 'Connect', color: 'var(--badge-pink-text)' },
  SUPPORT: { label: 'Support', color: 'var(--status-success-text)' },
  CREATE: { label: 'Create', color: 'var(--badge-cyan-text)' },
};

// ── Section Header ─────────────────────────────────────

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider">
      <Icon size={18} className="hf-text-muted" />
      <h2 className="hf-section-title hf-mb-0">{title}</h2>
    </div>
  );
}

// ── Spec Chip List ─────────────────────────────────────

function SpecChipList({ specs, icon: Icon, label }: {
  specs: SpecGroup;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  if (specs.length === 0) return null;
  return (
    <div className="hf-card-compact">
      <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
        <Icon size={15} className="hf-text-muted" />
        <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">{label}</span>
      </div>
      <div className="hf-flex-col hf-gap-xs">
        {specs.map(s => (
          <div key={s.slug} className="hf-flex hf-gap-sm hf-items-start">
            <ChevronRight size={12} className="hf-text-placeholder hf-flex-shrink-0 hf-mt-xs" />
            <div>
              <div className="hf-text-sm">{s.name}</div>
              {s.description && (
                <div className="hf-text-xs hf-text-muted">
                  {s.description.length > 100 ? s.description.slice(0, 100) + '...' : s.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

export function CourseOverviewTab({
  courseId,
  detail,
  subjects,
  contentMethods,
  contentTotal,
  isOperator,
  persona,
  specGroups,
  sessionPlan,
  sessions,
  onSimCall,
  onContentRefresh,
  onDetailUpdate,
}: CourseOverviewTabProps) {
  const config = (detail.config || {}) as PlaybookConfig;
  const goals = config.goals || [];
  const constraints = config.constraints || [];
  const audienceId = config.audience || '';
  const audienceOption = audienceId ? getAudienceOption(audienceId) : null;
  const onboardingPhases = config.onboardingFlowPhases?.phases || [];

  // ── Teaching focus state ──────────────────────────────
  const [teachingFocusDraft, setTeachingFocusDraft] = useState((config as any).teachingFocus || '');
  const [teachingFocusSaving, setTeachingFocusSaving] = useState(false);
  const [teachingFocusSaved, setTeachingFocusSaved] = useState(false);

  // ── Backfill state ────────────────────────────────────
  const [backfilling, setBackfilling] = useState(false);

  // ── Inline edit states ────────────────────────────────
  const [editingGoals, setEditingGoals] = useState(false);
  const [editingConstraints, setEditingConstraints] = useState(false);
  const [editingAudience, setEditingAudience] = useState(false);
  const [newConstraint, setNewConstraint] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Config save helper ────────────────────────────────
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

  // ── Onboarding data (lazy-loaded) ────────────────────
  const [onboarding, setOnboarding] = useState<{
    phases: OBPhase[];
    personaName?: string;
    domainWelcome?: string;
  } | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);

  useEffect(() => {
    setOnboardingLoading(true);
    fetch(`/api/courses/${courseId}/onboarding`)
      .then(r => r.json())
      .then(data => {
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

  return (
    <>
      {/* ── Setup Tracker ──────────────────────────────── */}
      <CourseSetupTracker
        courseId={courseId}
        detail={detail}
        subjects={subjects}
        sessions={sessions}
        onSimCall={onSimCall}
      />

      {/* ── Goals ─────────────────────────────────────── */}
      <SectionHeader title="Goals" icon={Target} />
      <div className="hf-card-compact hf-mb-lg">
        {goals.length === 0 ? (
          <div className="hf-text-sm hf-text-muted">
            No goals configured. Set goals in the Course Setup wizard to track learner progress.
          </div>
        ) : (
          <div className="hf-flex-col hf-gap-sm">
            {goals.map((g, i) => {
              const typeConfig = GOAL_TYPE_CONFIG[g.type] || { label: g.type, color: 'var(--text-muted)' };
              return (
                <div key={i} className="hf-flex hf-gap-sm hf-items-start cov-goal-row">
                  <span
                    className="hf-badge hf-badge-sm"
                    style={{ color: typeConfig.color, borderColor: typeConfig.color }}
                  >
                    {typeConfig.label}
                  </span>
                  <div className="hf-flex-1">
                    <div className="hf-text-sm">{g.name}</div>
                    {g.description && (
                      <div className="hf-text-xs hf-text-muted">{g.description}</div>
                    )}
                  </div>
                  {g.isAssessmentTarget && (
                    <span className="hf-badge hf-badge-sm hf-badge-warning" title={`Assessment target — ${Math.round((g.assessmentConfig?.threshold || 0.8) * 100)}% threshold`}>
                      Assessment
                    </span>
                  )}
                  {g.isDefault && (
                    <span className="hf-badge hf-badge-sm hf-badge-muted">Default</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Boundaries (Constraints) ──────────────────── */}
      <SectionHeader title="Boundaries" icon={Ban} />
      <div className="hf-card-compact hf-mb-lg">
        {constraints.length === 0 && !editingConstraints ? (
          <div className="hf-flex hf-flex-between hf-items-center">
            <span className="hf-text-sm hf-text-muted">No boundaries set. These are things the AI should never do.</span>
            {isOperator && (
              <button className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => setEditingConstraints(true)}>
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
                    >
                      Add
                    </button>
                    <button
                      className="hf-btn hf-btn-xs hf-btn-secondary"
                      onClick={() => { setEditingConstraints(false); setNewConstraint(''); }}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <button className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => setEditingConstraints(true)}>
                    <Pencil size={11} /> Edit
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Audience ──────────────────────────────────── */}
      <SectionHeader title="Audience" icon={Users2} />
      <div className="hf-card-compact hf-mb-lg">
        {!audienceOption && !editingAudience ? (
          <div className="hf-flex hf-flex-between hf-items-center">
            <span className="hf-text-sm hf-text-muted">No audience set. The AI will use a neutral register.</span>
            {isOperator && (
              <button className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => setEditingAudience(true)}>
                <Pencil size={11} /> Set
              </button>
            )}
          </div>
        ) : editingAudience ? (
          <div className="hf-flex-col hf-gap-xs">
            {AUDIENCE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`cov-audience-option ${audienceId === opt.id ? 'cov-audience-active' : ''}`}
                onClick={async () => {
                  await saveConfig({ audience: opt.id });
                  setEditingAudience(false);
                }}
                disabled={saving}
              >
                <div className="hf-flex hf-flex-between hf-items-center">
                  <span className="hf-text-sm hf-text-bold">{opt.label}</span>
                  <span className="hf-text-xs hf-text-muted">{opt.ages}</span>
                </div>
                <div className="hf-text-xs hf-text-muted">{opt.description}</div>
              </button>
            ))}
            <button className="hf-btn hf-btn-xs hf-btn-secondary hf-mt-xs" onClick={() => setEditingAudience(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="hf-flex hf-flex-between hf-items-center">
            <div>
              <div className="hf-text-sm hf-text-bold">{audienceOption!.label}</div>
              <div className="hf-text-xs hf-text-muted">
                Age {audienceOption!.ages} &mdash; {audienceOption!.description}
              </div>
            </div>
            {isOperator && (
              <button className="hf-btn hf-btn-xs hf-btn-outline" onClick={() => setEditingAudience(true)}>
                <Pencil size={11} /> Change
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── First Call Structure ──────────────────────── */}
      <SectionHeader title="First Call Structure" icon={MessageCircle} />
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
          <div className="hf-text-sm hf-text-muted">
            No first call flow configured. The onboarding wizard generates this automatically.
          </div>
        )}
      </div>

      {/* ── Onboarding Editor (operators only) ──────── */}
      {isOperator && (
        <div className="hf-mb-lg">
          <OnboardingEditor
            courseId={courseId}
            domainId={detail.domain.id}
            domainName={detail.domain.name}
            isOperator={isOperator}
            compact
          />
        </div>
      )}

      {/* ── Teaching Methods ──────────────────────────── */}
      {contentMethods.length > 0 && (
        <div className="hf-mb-lg">
          <div className="hf-flex hf-items-center hf-gap-sm hf-mb-sm">
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">
              Teaching Methods
            </div>
            {isOperator && contentMethods.some((m) => m.teachMethod === 'unassigned') && (
              <button
                className="hf-btn hf-btn-xs hf-btn-outline"
                disabled={backfilling}
                onClick={async () => {
                  setBackfilling(true);
                  try {
                    const res = await fetch(`/api/courses/${courseId}/backfill-teach-methods`, { method: 'POST' });
                    const data = await res.json();
                    if (data.ok && data.updated > 0 && onContentRefresh) {
                      const bd = await fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then(r => r.json());
                      if (bd.ok) {
                        onContentRefresh(bd.methods || [], bd.total || 0);
                      }
                    }
                  } catch { /* ignore */ }
                  setBackfilling(false);
                }}
              >
                {backfilling ? 'Assigning\u2026' : `Assign ${contentMethods.find((m) => m.teachMethod === 'unassigned')?.count ?? 0} unassigned`}
              </button>
            )}
          </div>
          <TeachMethodStats methods={contentMethods} total={contentTotal} />
        </div>
      )}

      {/* ── Teaching Approach (subject profiles) ──────── */}
      {subjects.some((s) => s.teachingProfile) && (
        <div className="hf-card-compact hf-mb-lg">
          <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
            <Sparkles size={15} className="hf-text-accent" />
            <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">Teaching Approach</span>
          </div>
          {subjects.filter((s) => s.teachingProfile).map((sub) => {
            const profile = getTeachingProfile(sub.teachingProfile);
            if (!profile) return null;
            const modeLabel = TEACHING_MODE_LABELS[profile.teachingMode as TeachingMode]?.label ?? profile.teachingMode;
            const patternLabel = INTERACTION_PATTERN_LABELS[profile.interactionPattern as InteractionPattern]?.label ?? profile.interactionPattern;
            return (
              <div key={sub.id} className="hf-mb-sm">
                <div className="hf-flex hf-gap-sm hf-items-center hf-text-sm">
                  <strong>{sub.name}</strong>
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
                className="hf-input hf-text-sm"
                rows={3}
                style={{ width: '100%', resize: 'vertical' }}
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

          {subjects.some((s) => s.sourceCount > 0) && (
            <div className="hf-text-xs hf-text-muted hf-mt-xs">
              Course-level overrides and uploaded reference docs take priority.
            </div>
          )}
        </div>
      )}

      {/* ── What You're Teaching ──────────────────────── */}
      <div className="hf-flex hf-flex-between hf-items-center hf-mb-md hf-section-divider">
        <div className="hf-flex hf-gap-sm hf-items-center">
          <BookMarked size={18} className="hf-text-muted" />
          <h2 className="hf-section-title hf-mb-0">What You&apos;re Teaching</h2>
        </div>
        {isOperator && subjects.length > 0 && (
          <Link
            href={`/x/courses/new?domainId=${detail.domain.id}`}
            className="hf-btn-sm hf-btn-secondary"
          >
            <Plus size={13} />
            Add Subject
          </Link>
        )}
      </div>

      {subjects.length === 0 ? (
        <div className="hf-empty-compact hf-mb-lg">
          <BookMarked size={36} className="hf-text-tertiary hf-mb-sm" />
          <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No subjects yet</div>
          <p className="hf-text-xs hf-text-muted hf-mb-md">Subjects are created when you upload content or use the Course Setup wizard.</p>
          {isOperator && (
            <Link href={`/x/courses/new?domainId=${detail.domain.id}`} className="hf-btn hf-btn-primary">
              <Plus size={14} />
              Set Up Course
            </Link>
          )}
        </div>
      ) : (
        <div className="hf-card-grid-md hf-mb-lg">
          {subjects.map((sub) => (
            <div key={sub.id} className="hf-card-compact">
              <Link
                href={`/x/courses/${courseId}/subjects/${sub.id}`}
                className="hf-card-link-inner"
              >
                <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
                  <BookMarked size={16} className="hf-text-accent hf-flex-shrink-0" />
                  <h3 className="hf-heading-sm hf-mb-0 hf-flex-1">{sub.name}</h3>
                  <TrustBadge level={sub.defaultTrustLevel} />
                </div>
                {sub.description && (
                  <p className="hf-text-xs hf-text-muted hf-mb-sm hf-line-clamp-2">{sub.description}</p>
                )}
                <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted">
                  {sub.sourceCount === 0 ? (
                    <span className="hf-text-warning hf-flex hf-items-center hf-gap-xs">
                      <AlertTriangle size={12} />No content yet
                    </span>
                  ) : (
                    <span><FileText size={12} className="hf-icon-inline" />{sub.sourceCount} sources</span>
                  )}
                  <span>{sub.assertionCount} teaching points</span>
                  {sub.curriculumCount > 0 && <span>{sub.curriculumCount} curricula</span>}
                </div>
              </Link>
              {isOperator && sub.sourceCount === 0 && (
                <Link
                  href={`/x/courses/${courseId}/subjects/${sub.id}`}
                  className="hf-btn-sm hf-btn-primary hf-mt-sm"
                >
                  <Upload size={13} />
                  Upload Content
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── How It's Taught ───────────────────────────── */}
      <SectionHeader title="How It's Taught" icon={Sparkles} />
      <div className="hf-mb-lg">
        {persona ? (
          <div className="hf-card-compact hf-mb-md">
            <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
              <Sparkles size={15} className="hf-text-accent" />
              <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">AI Personality</span>
            </div>
            <div className="hf-heading-sm hf-mb-xs">{persona.name}</div>
            {persona.extendsAgent && (
              <div className="hf-mb-sm">
                <span className="hf-text-xs hf-tag-pill">
                  {archetypeLabel(persona.extendsAgent)} archetype
                </span>
              </div>
            )}
            {persona.roleStatement && (
              <p className="hf-text-sm hf-text-secondary hf-mb-xs hf-quote">
                &ldquo;{persona.roleStatement}&rdquo;
              </p>
            )}
            {persona.primaryGoal && (
              <p className="hf-text-xs hf-text-muted">Goal: {persona.primaryGoal}</p>
            )}
          </div>
        ) : (
          <div className="hf-card-compact hf-mb-md">
            <div className="hf-text-sm hf-text-muted">
              No AI personality configured. The system will use the default archetype.
            </div>
          </div>
        )}

        {(specGroups.measure.length > 0 || specGroups.adapt.length > 0 || specGroups.guard.length > 0) && (
          <div className="hf-card-grid-md">
            <SpecChipList specs={specGroups.measure} icon={BarChart3} label="What's Measured" />
            <SpecChipList specs={specGroups.adapt} icon={Sliders} label="How It Adapts" />
            <SpecChipList specs={specGroups.guard} icon={Shield} label="Guardrails" />
          </div>
        )}

        {specGroups.measure.length === 0 && specGroups.adapt.length === 0 && specGroups.guard.length === 0 && (
          <div className="hf-card-compact">
            <div className="hf-text-sm hf-text-muted">
              System measurement and adaptation specs will be shown here once configured.
            </div>
          </div>
        )}
      </div>

      {/* ── Teaching Instructions (from CourseHowTab) ── */}
      <CourseHowTab
        courseId={courseId}
        detail={detail}
        subjects={subjects}
        isOperator={isOperator}
        persona={persona}
        onDetailUpdate={onDetailUpdate}
      />

      {/* ── Session Plan Summary ──────────────────────── */}
      {sessionPlan && sessionPlan.estimatedSessions > 0 && (
        <>
          <SectionHeader title="Session Plan" icon={ListOrdered} />
          <div className="hf-card-compact hf-mb-lg">
            <div className="hf-flex hf-gap-lg">
              <div>
                <div className="hf-text-lg hf-text-bold">{sessionPlan.estimatedSessions}</div>
                <div className="hf-text-xs hf-text-muted">Sessions</div>
              </div>
              {sessionPlan.totalDurationMins > 0 && (
                <div>
                  <div className="hf-text-lg hf-text-bold">
                    {sessionPlan.totalDurationMins >= 60
                      ? `${Math.round(sessionPlan.totalDurationMins / 60 * 10) / 10}h`
                      : `${sessionPlan.totalDurationMins}m`
                    }
                  </div>
                  <div className="hf-text-xs hf-text-muted">Total Duration</div>
                </div>
              )}
              {sessionPlan.totalDurationMins > 0 && sessionPlan.estimatedSessions > 0 && (
                <div>
                  <div className="hf-text-lg hf-text-bold">
                    {Math.round(sessionPlan.totalDurationMins / sessionPlan.estimatedSessions)}m
                  </div>
                  <div className="hf-text-xs hf-text-muted">Avg per Session</div>
                </div>
              )}
            </div>
            {sessionPlan.generatedAt && (
              <div className="hf-text-xs hf-text-placeholder hf-mt-sm">
                Generated {new Date(sessionPlan.generatedAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
