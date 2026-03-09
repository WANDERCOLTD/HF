'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles, Users2, GraduationCap, BarChart3, Sliders, Shield,
  ChevronRight, Pencil,
} from 'lucide-react';
import { archetypeLabel, type SpecGroup } from '@/lib/course/group-specs';
import { getAudienceOption, AUDIENCE_OPTIONS } from '@/lib/prompt/composition/transforms/audience';
import type { PlaybookConfig } from '@/lib/types/json-fields';

// -- Types ----------------------------------------------------------

export type CourseWhoTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    config?: Record<string, unknown> | null;
    domain: { id: string; name: string; slug: string };
  };
  isOperator: boolean;
  persona: {
    name: string;
    extendsAgent: string | null | undefined;
    roleStatement: string | null;
    primaryGoal: string | null;
  } | null;
  specGroups: { measure: SpecGroup; adapt: SpecGroup; guard: SpecGroup };
  onDetailUpdate?: (updater: (prev: any) => any) => void;
};

type CallerSummary = {
  id: string;
  name: string | null;
  phone: string | null;
  callCount: number;
  enrolledAt: string | null;
  status: string | null;
  createdAt: string;
};

// -- Section Header -------------------------------------------------

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider">
      <Icon size={18} className="hf-text-muted" />
      <h2 className="hf-section-title hf-mb-0">{title}</h2>
    </div>
  );
}

// -- Spec Chip List -------------------------------------------------

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
      <div className="hf-flex hf-flex-col hf-gap-xs">
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

// -- Relative time helper -------------------------------------------

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// -- Main Component -------------------------------------------------

export function CourseWhoTab({
  courseId,
  detail,
  isOperator,
  persona,
  specGroups,
  onDetailUpdate,
}: CourseWhoTabProps) {
  const config = (detail.config || {}) as PlaybookConfig;
  const audienceId = config.audience || '';
  const audienceOption = audienceId ? getAudienceOption(audienceId) : null;

  // -- Audience editing state ---------------------------------------
  const [editingAudience, setEditingAudience] = useState(false);
  const [saving, setSaving] = useState(false);

  // -- Callers lazy-load state --------------------------------------
  const [callers, setCallers] = useState<CallerSummary[]>([]);
  const [callersTotal, setCallersTotal] = useState(0);
  const [callersLoading, setCallersLoading] = useState(true);

  // -- Config save helper -------------------------------------------
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

  // -- Load callers on mount ----------------------------------------
  useEffect(() => {
    setCallersLoading(true);
    fetch(`/api/courses/${courseId}/students`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setCallers(data.students || []);
          setCallersTotal(data.total ?? (data.students || []).length);
        }
      })
      .catch(() => {})
      .finally(() => setCallersLoading(false));
  }, [courseId]);

  const visibleCallers = callers.slice(0, 5);

  return (
    <>
      {/* -- AI Personality ---------------------------------------- */}
      <SectionHeader title="AI Personality" icon={Sparkles} />
      <div className="hf-card-compact hf-mb-lg">
        {persona ? (
          <>
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
          </>
        ) : (
          <div className="hf-text-sm hf-text-muted">
            No AI personality configured. The system will use the default archetype.
          </div>
        )}
      </div>

      {/* -- Audience ---------------------------------------------- */}
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
          <div className="hf-flex hf-flex-col hf-gap-xs">
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

      {/* -- Students ---------------------------------------------- */}
      <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider">
        <GraduationCap size={18} className="hf-text-muted" />
        <h2 className="hf-section-title hf-mb-0">Students</h2>
        {!callersLoading && callersTotal > 0 && (
          <span className="hf-badge hf-badge-sm hf-badge-accent">{callersTotal}</span>
        )}
      </div>
      <div className="hf-card-compact hf-mb-lg">
        {callersLoading ? (
          <div className="hf-flex hf-items-center hf-gap-sm">
            <span className="hf-spinner hf-spinner-sm" />
            <span className="hf-text-sm hf-text-muted">Loading students...</span>
          </div>
        ) : callers.length === 0 ? (
          <div className="hf-flex hf-flex-col hf-items-center hf-gap-sm hf-py-md">
            <GraduationCap size={28} className="hf-text-tertiary" />
            <div className="hf-text-sm hf-text-muted">No students enrolled yet.</div>
            <Link href={`/x/callers`} className="hf-btn hf-btn-xs hf-btn-outline">
              <Users2 size={12} /> Manage enrolment
            </Link>
          </div>
        ) : (
          <>
            <div className="hf-flex hf-flex-col hf-gap-sm">
              {visibleCallers.map((caller) => (
                <div key={caller.id} className="hf-flex hf-items-center hf-gap-sm">
                  <GraduationCap size={14} className="hf-text-muted hf-flex-shrink-0" />
                  <div className="hf-flex-1 hf-text-sm">
                    {caller.name || caller.phone || 'Unknown'}
                  </div>
                  <div className="hf-flex hf-gap-sm hf-items-center">
                    {caller.callCount > 0 && (
                      <span className="hf-text-xs hf-text-muted">
                        {caller.callCount} call{caller.callCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    {caller.enrolledAt && (
                      <span className="hf-text-xs hf-text-placeholder">
                        {relativeTime(caller.enrolledAt)}
                      </span>
                    )}
                    <span className={`hf-badge hf-badge-sm ${caller.callCount > 0 ? 'hf-badge-success' : 'hf-badge-muted'}`}>
                      {caller.callCount > 0 ? 'Active' : 'New'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {callersTotal > 5 && (
              <div className="hf-mt-sm">
                <Link href="/x/callers" className="hf-text-xs hf-text-accent hf-link">
                  +{callersTotal - 5} more &mdash; View all &rarr;
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {/* -- Learning Intelligence ------------------------------------- */}
      {isOperator && (
        <>
          <SectionHeader title="Learning Intelligence" icon={BarChart3} />
          <div className="hf-mb-lg">
            {(specGroups.measure.length > 0 || specGroups.adapt.length > 0 || specGroups.guard.length > 0) ? (
              <div className="hf-card-grid-md">
                <SpecChipList specs={specGroups.measure} icon={BarChart3} label="What's Measured" />
                <SpecChipList specs={specGroups.adapt} icon={Sliders} label="How It Adapts" />
                <SpecChipList specs={specGroups.guard} icon={Shield} label="Safety Rules" />
              </div>
            ) : (
              <div className="hf-card-compact">
                <div className="hf-text-sm hf-text-muted">
                  Measurement and adaptation settings will appear here once configured.
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
