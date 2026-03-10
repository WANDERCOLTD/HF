'use client';

/**
 * OnboardingEditor — editable first-call onboarding phases.
 *
 * Two layout modes:
 *   compact=false (default): two-column — editor left, chat preview right
 *   compact=true: single-column — editor, collapsible preview below
 *
 * Self-contained: fetches data from /api/courses/:id/onboarding on mount.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Compass, Paperclip, RotateCcw, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { SortableList } from '@/components/shared/SortableList';
import { reorderItems } from '@/lib/sortable/reorder';
import { OnboardingChatPreview, type ChatPhase } from '@/components/shared/OnboardingChatPreview';
import type { OnboardingPhase } from '@/lib/types/json-fields';

// ── Types ──────────────────────────────────────────────

export interface OnboardingEditorProps {
  courseId: string;
  domainId: string;
  domainName: string | null;
  isOperator: boolean;
  /** Single-column layout for inline rail use */
  compact?: boolean;
}

type OnboardingSource = 'course' | 'domain' | 'none';
type DomainMediaItem = { id: string; title: string | null; fileName: string; mimeType: string };
type PhaseWithId = OnboardingPhase & { _id: string };

// ── Component ──────────────────────────────────────────

export function OnboardingEditor({
  courseId,
  domainId,
  domainName,
  isOperator,
  compact = false,
}: OnboardingEditorProps) {
  // Loading
  const [loading, setLoading] = useState(true);
  const [onboardingSource, setOnboardingSource] = useState<OnboardingSource>('none');

  // Editor state
  const [structuredPhases, setStructuredPhases] = useState<PhaseWithId[]>([]);
  const savedPhasesRef = useRef<string>('[]');

  // Domain context for preview
  const [domainWelcome, setDomainWelcome] = useState<string | null>(null);
  const [personaName, setPersonaName] = useState<string | null>(null);
  const [domainMedia, setDomainMedia] = useState<DomainMediaItem[]>([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Compact: preview disclosure
  const [previewOpen, setPreviewOpen] = useState(false);

  // Dirty tracking
  const isDirty = useMemo(() => {
    return JSON.stringify(structuredPhases) !== savedPhasesRef.current;
  }, [structuredPhases]);

  // ── Fetch on mount ──────────────────────────────────

  const fetchOnboarding = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/onboarding`);
      const data = await res.json();
      if (data.ok) {
        setOnboardingSource(data.source === 'fallback' ? 'domain' : data.source);
        setDomainWelcome(data.domainWelcome || null);
        setPersonaName(data.personaName || null);
        setDomainMedia(data.media || []);

        const phasesArr = Array.isArray(data.phases) ? data.phases : data.phases?.phases;
        if (Array.isArray(phasesArr) && phasesArr.length > 0) {
          const withIds = phasesArr.map((p: OnboardingPhase) => ({
            ...p,
            _id: crypto.randomUUID(),
          }));
          setStructuredPhases(withIds);
          savedPhasesRef.current = JSON.stringify(withIds);
        } else {
          setStructuredPhases([]);
          savedPhasesRef.current = '[]';
        }
      }
    } catch (err) {
      console.error('[OnboardingEditor] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => { fetchOnboarding(); }, [fetchOnboarding]);

  // ── Preview phases (live from editor) ───────────────

  const previewPhases: ChatPhase[] = useMemo(() =>
    structuredPhases.map((p) => ({
      phase: p.phase,
      duration: p.duration,
      goals: p.goals,
    })),
    [structuredPhases],
  );

  // ── Save handler ────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const phasesPayload = structuredPhases.length > 0
        ? { phases: structuredPhases.map(({ _id, ...rest }) => rest) }
        : null;
      const res = await fetch(`/api/courses/${courseId}/onboarding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingFlowPhases: phasesPayload }),
      });
      const data = await res.json();
      if (data.ok) {
        savedPhasesRef.current = JSON.stringify(structuredPhases);
        setOnboardingSource('course');
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError(data.error || 'Failed to save');
      }
    } catch {
      setSaveError('Network error');
    } finally {
      setSaving(false);
    }
  }, [courseId, structuredPhases]);

  // ── Reset handler ───────────────────────────────────

  const handleReset = useCallback(async () => {
    if (!confirm('Reset to institution default? Your course-level customisations will be removed.')) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/onboarding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingFlowPhases: null }),
      });
      const data = await res.json();
      if (data.ok) {
        setLoading(true);
        await fetchOnboarding();
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError(data.error || 'Failed to reset');
      }
    } catch {
      setSaveError('Network error');
    } finally {
      setSaving(false);
    }
  }, [courseId, fetchOnboarding]);

  // ── Cancel (revert to saved) ────────────────────────

  const handleCancel = useCallback(() => {
    setStructuredPhases(JSON.parse(savedPhasesRef.current));
    setSaveError(null);
  }, []);

  // ── Seed default phases ─────────────────────────────

  const seedDefaults = useCallback(() => {
    const defaults: PhaseWithId[] = [
      { _id: crypto.randomUUID(), phase: 'welcome', duration: '2min', goals: ['Greet learner and establish rapport'] },
      { _id: crypto.randomUUID(), phase: 'discover', duration: '5min', goals: ['Assess prior knowledge'] },
      { _id: crypto.randomUUID(), phase: 'close', duration: '2min', goals: ['Summarise and preview next session'] },
    ];
    setStructuredPhases(defaults);
  }, []);

  // ── Phase editor card (shared between compact & full) ──

  const renderPhaseCard = (phase: PhaseWithId, index: number) => (
    <div className="hf-flex-1">
      <div className="hf-flex hf-gap-sm hf-mb-sm">
        <div className="hf-flex-1">
          <label className="hf-label">Phase Name</label>
          <input
            type="text"
            className="hf-input"
            placeholder="e.g. welcome, discover, teach"
            value={phase.phase}
            disabled={!isOperator}
            onChange={(e) => {
              const updated = [...structuredPhases];
              updated[index] = { ...updated[index], phase: e.target.value };
              setStructuredPhases(updated);
            }}
          />
        </div>
        <div>
          <label className="hf-label">Duration</label>
          <input
            type="text"
            className="hf-input"
            placeholder="e.g. 2min"
            value={phase.duration}
            disabled={!isOperator}
            onChange={(e) => {
              const updated = [...structuredPhases];
              updated[index] = { ...updated[index], duration: e.target.value };
              setStructuredPhases(updated);
            }}
          />
        </div>
      </div>
      <div className="hf-mb-sm">
        <label className="hf-label">Goals (one per line)</label>
        <textarea
          className="hf-textarea"
          rows={2}
          placeholder="Greet learner and establish rapport"
          value={(phase.goals || []).join('\n')}
          disabled={!isOperator}
          onChange={(e) => {
            const updated = [...structuredPhases];
            updated[index] = { ...updated[index], goals: e.target.value.split('\n').filter((g) => g.trim()) };
            setStructuredPhases(updated);
          }}
        />
      </div>

      {/* Media attachments */}
      {(phase.content || []).length > 0 && (
        <div className="hf-mb-sm">
          {(phase.content || []).map((ref, ci) => {
            const media = domainMedia.find((m) => m.id === ref.mediaId);
            return (
              <div key={ci} className="hf-flex hf-gap-sm hf-items-center hf-mb-xs">
                <Paperclip size={12} className="hf-text-muted hf-flex-shrink-0" />
                <span className="hf-text-xs hf-flex-1 hf-truncate">{media?.title || media?.fileName || ref.mediaId}</span>
                <input
                  type="text"
                  className="hf-input hf-text-xs"
                  placeholder="Instruction..."
                  value={ref.instruction || ''}
                  disabled={!isOperator}
                  onChange={(e) => {
                    const updated = [...structuredPhases];
                    const newContent = [...(updated[index].content || [])];
                    newContent[ci] = { ...newContent[ci], instruction: e.target.value };
                    updated[index] = { ...updated[index], content: newContent };
                    setStructuredPhases(updated);
                  }}
                />
                {isOperator && (
                  <button
                    className="hf-btn-ghost hf-text-xs hf-text-muted"
                    onClick={() => {
                      const updated = [...structuredPhases];
                      const newContent = (updated[index].content || []).filter((_, j) => j !== ci);
                      updated[index] = { ...updated[index], content: newContent.length > 0 ? newContent : undefined };
                      setStructuredPhases(updated);
                    }}
                  >
                    &times;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {isOperator && domainMedia.length > 0 && (
        <select
          className="hf-select hf-text-xs"
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            const existing = phase.content || [];
            if (existing.some((c) => c.mediaId === e.target.value)) return;
            const updated = [...structuredPhases];
            updated[index] = { ...updated[index], content: [...existing, { mediaId: e.target.value }] };
            setStructuredPhases(updated);
          }}
        >
          <option value="">+ Attach media to this phase...</option>
          {domainMedia
            .filter((m) => !(phase.content || []).some((c) => c.mediaId === m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>{m.title || m.fileName}</option>
            ))}
        </select>
      )}
    </div>
  );

  // ── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="hf-flex hf-justify-center hf-py-lg">
        <div className="hf-spinner" />
      </div>
    );
  }

  // Empty state
  if (onboardingSource === 'none' && structuredPhases.length === 0) {
    return (
      <div className="hf-empty-compact">
        <Compass size={28} className="hf-text-tertiary hf-mb-sm" />
        <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No onboarding flow configured</div>
        <p className="hf-text-xs hf-text-muted hf-mb-md">
          Set up the onboarding flow on the Institution page, or create one for this course.
        </p>
        {isOperator && (
          <div className="hf-flex hf-gap-sm hf-justify-center">
            {domainId && (
              <Link
                href={`/x/domains?id=${domainId}&tab=onboarding`}
                className="hf-btn-sm hf-btn-secondary"
              >
                Set Up on Institution
              </Link>
            )}
            <button className="hf-btn-sm hf-btn-primary" onClick={seedDefaults}>
              Create for This Course
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Banners ──

  const banners = (
    <>
      {onboardingSource === 'domain' && !isDirty && (
        <div className="hf-banner hf-banner-info hf-mb-sm">
          Inherited from <strong>{domainName || 'Institution'}</strong>. Editing will create a custom version for this course.
        </div>
      )}
      {onboardingSource === 'domain' && isDirty && (
        <div className="hf-banner hf-banner-warning hf-mb-sm">
          You are creating a custom onboarding flow for this course.
        </div>
      )}
      {onboardingSource === 'course' && (
        <div className="hf-banner hf-banner-success hf-mb-sm hf-flex hf-flex-between hf-items-center">
          <span>Custom journey for this course</span>
          {isOperator && (
            <button
              className="hf-btn-sm hf-btn-secondary"
              onClick={handleReset}
              disabled={saving}
            >
              <RotateCcw size={13} />
              Reset to Default
            </button>
          )}
        </div>
      )}
      {saveSuccess && <div className="hf-banner hf-banner-success hf-mb-sm">Onboarding flow saved.</div>}
      {saveError && <div className="hf-banner hf-banner-error hf-mb-sm">{saveError}</div>}
    </>
  );

  // ── Phase list ──

  const phaseList = (
    <SortableList
      items={structuredPhases}
      getItemId={(p) => p._id}
      onReorder={(from, to) => setStructuredPhases(reorderItems(structuredPhases, from, to))}
      disabled={!isOperator}
      onAdd={isOperator ? () => setStructuredPhases([...structuredPhases, {
        _id: crypto.randomUUID(),
        phase: '',
        duration: '3min',
        goals: [],
      }]) : undefined}
      onRemove={(i) => setStructuredPhases(structuredPhases.filter((_, idx) => idx !== i))}
      addLabel="Add Phase"
      emptyLabel="No phases — add your first onboarding phase"
      renderCard={renderPhaseCard}
    />
  );

  // ── Save bar ──

  const saveBar = isDirty && isOperator && (
    <div className={compact ? "hf-flex hf-gap-sm hf-justify-end hf-mt-md" : "cd-save-bar"}>
      {compact && <span className="hf-text-xs hf-text-muted hf-flex-1">Unsaved changes</span>}
      {!compact && <span className="cd-save-bar-msg">Unsaved changes</span>}
      <button className="hf-btn-sm hf-btn-secondary" onClick={handleCancel}>
        Cancel
      </button>
      <button className="hf-btn-sm hf-btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );

  // ── Compact mode: single column ──

  if (compact) {
    return (
      <div>
        {banners}
        {phaseList}

        {/* Collapsible preview */}
        <button
          className="hf-flex hf-items-center hf-gap-xs hf-text-xs hf-text-muted hf-mt-md"
          onClick={() => setPreviewOpen(!previewOpen)}
          type="button"
        >
          <ChevronDown
            size={13}
            style={{ transform: previewOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
          />
          First Call Preview
        </button>
        {previewOpen && (
          <div className="hf-mt-sm">
            <OnboardingChatPreview
              greeting={domainWelcome || undefined}
              personaName={personaName || undefined}
              phases={previewPhases}
              maxHeight={400}
            />
          </div>
        )}

        {saveBar}
      </div>
    );
  }

  // ── Full mode: two-column ──

  return (
    <div className="hf-mt-md">
      {banners}

      <div className="ob-tab-layout">
        <div className="ob-tab-edit-col">
          {phaseList}
        </div>
        <div className="ob-tab-preview-col">
          <div className="ob-tab-preview-sticky">
            <div className="ob-tab-preview-label">First Call Preview</div>
            <OnboardingChatPreview
              greeting={domainWelcome || undefined}
              personaName={personaName || undefined}
              phases={previewPhases}
              maxHeight={540}
            />
          </div>
        </div>
      </div>

      {saveBar}
    </div>
  );
}
