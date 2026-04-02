'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  ChevronLeft, ChevronRight, ArrowLeft, BookOpen,
  Image, Layers as LayersIcon,
} from 'lucide-react';
import { EditableTitle } from '@/components/shared/EditableTitle';
import { SessionTPList, type TPItem, type SessionOption } from '@/components/shared/SessionTPList';
import {
  SESSION_TYPES, TEACHING_SESSION_TYPE_ENTRIES, SESSION_TYPE_ICONS, getSessionTypeColor, getSessionTypeLabel, isFormStop,
} from '@/lib/lesson-plan/session-ui';
import './session-detail.css';

// ── Types ──────────────────────────────────────────────

type SessionMediaRef = {
  mediaId: string;
  fileName?: string;
  captionText?: string | null;
  figureRef?: string | null;
  mimeType?: string;
};

type SessionEntry = {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  notes?: string | null;
  estimatedDurationMins?: number | null;
  assertionCount?: number | null;
  learningOutcomeRefs?: string[] | null;
  assertionIds?: string[] | null;
  media?: SessionMediaRef[] | null;
};

type SessionsData = {
  plan: { entries: SessionEntry[]; estimatedSessions: number; generatedAt?: string | null } | null;
  modules: Array<{ id: string; slug: string; title: string; description: string | null; estimatedDurationMinutes: number | null; sortOrder: number; learningObjectiveCount: number }>;
  curriculumId: string | null;
  subjectCount: number;
};

type MediaMapData = {
  sessions: Array<{ session: number; label: string; images: SessionMediaRef[] }>;
  unassigned: SessionMediaRef[];
  stats: { total: number; assigned: number; unassigned: number };
};

// ── Props ──────────────────────────────────────────────

interface SessionDetailClientProps {
  courseId: string;
  sessionNum: number;
}

// ── Component ──────────────────────────────────────────

export function SessionDetailClient({ courseId, sessionNum }: SessionDetailClientProps) {
  const router = useRouter();
  const { data: authSession } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((authSession?.user?.role as string) || '');

  // Data
  const [sessionsData, setSessionsData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // TPs
  const [sessionTPs, setSessionTPs] = useState<Record<number, TPItem[]>>({});
  const [unassignedTPs, setUnassignedTPs] = useState<TPItem[]>([]);
  const [tpLoaded, setTpLoaded] = useState(false);

  // Media
  const [mediaMap, setMediaMap] = useState<MediaMapData | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load data ────────────────────────────────────────

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/courses/${courseId}/sessions`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setSessionsData(data);

          // Load TPs if curriculum exists
          if (data.curriculumId) {
            fetch(`/api/curricula/${data.curriculumId}/session-assertions?courseId=${courseId}`)
              .then((r) => r.json())
              .then((tpData) => {
                if (tpData.ok) {
                  const bySession: Record<number, TPItem[]> = {};
                  if (tpData.sessions) {
                    for (const [key, group] of Object.entries(tpData.sessions)) {
                      bySession[Number(key)] = (group as any).assertions || [];
                    }
                  }
                  setSessionTPs(bySession);
                  setUnassignedTPs(tpData.unassigned || []);
                }
              })
              .catch(() => {})
              .finally(() => setTpLoaded(true));

            // Load media map
            fetch(`/api/curricula/${data.curriculumId}/lesson-plan/media-map`)
              .then((r) => r.json())
              .then((mmData) => { if (mmData.ok) setMediaMap(mmData); })
              .catch(() => {});
          } else {
            setTpLoaded(true);
          }
        } else {
          setError(data.error || 'Failed to load sessions');
          setTpLoaded(true);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Network error'))
      .finally(() => setLoading(false));
  }, [courseId]);

  // ── Derived data ─────────────────────────────────────

  const entries = sessionsData?.plan?.entries || [];
  const totalSessions = entries.length;
  const entry = entries[sessionNum - 1] || null;
  const curriculumId = sessionsData?.curriculumId || null;

  const sessionTPOptions: SessionOption[] = useMemo(
    () => entries.map((e, i) => ({ session: i + 1, label: e.label })),
    [entries],
  );

  const currentMediaImages = useMemo(() => {
    if (!mediaMap) return [];
    const sm = mediaMap.sessions.find((s) => s.session === sessionNum);
    return sm?.images || [];
  }, [mediaMap, sessionNum]);

  // ── Save helper ──────────────────────────────────────

  const saveEntries = useCallback(async (updatedEntries: SessionEntry[]) => {
    if (!curriculumId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/curricula/${curriculumId}/lesson-plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: updatedEntries }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Save failed');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [curriculumId]);

  const updateEntry = useCallback((patch: Partial<SessionEntry>) => {
    if (!sessionsData?.plan) return;
    const updated = entries.map((e, i) =>
      i === sessionNum - 1 ? { ...e, ...patch } : e,
    );
    setSessionsData((prev) => prev ? {
      ...prev,
      plan: prev.plan ? { ...prev.plan, entries: updated } : null,
    } : null);
    saveEntries(updated);
  }, [entries, sessionNum, sessionsData, saveEntries]);

  const debouncedUpdateEntry = useCallback((patch: Partial<SessionEntry>) => {
    // Optimistic local update immediately
    if (!sessionsData?.plan) return;
    const updated = entries.map((e, i) =>
      i === sessionNum - 1 ? { ...e, ...patch } : e,
    );
    setSessionsData((prev) => prev ? {
      ...prev,
      plan: prev.plan ? { ...prev.plan, entries: updated } : null,
    } : null);

    // Debounce the save
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => saveEntries(updated), 800);
  }, [entries, sessionNum, sessionsData, saveEntries]);

  // ── Title save ───────────────────────────────────────

  const handleTitleSave = useCallback(async (newTitle: string) => {
    updateEntry({ label: newTitle });
  }, [updateEntry]);

  // ── TP move handler ──────────────────────────────────

  const handleTPMove = useCallback((assertionId: string, toSession: number) => {
    let movedTp: TPItem | undefined;

    setSessionTPs((prev) => {
      const next: Record<number, TPItem[]> = {};
      for (const [key, tps] of Object.entries(prev)) {
        const found = tps.find((tp) => tp.id === assertionId);
        if (found) movedTp = found;
        next[Number(key)] = tps.filter((tp) => tp.id !== assertionId);
      }
      return next;
    });

    setUnassignedTPs((prev) => {
      const found = prev.find((tp) => tp.id === assertionId);
      if (found) movedTp = found;
      return prev.filter((tp) => tp.id !== assertionId);
    });

    queueMicrotask(() => {
      if (!movedTp) return;
      const tp = movedTp;
      if (toSession === 0) {
        setUnassignedTPs((prev) => [...prev, tp]);
      } else {
        setSessionTPs((prev) => ({
          ...prev,
          [toSession]: [...(prev[toSession] || []), tp],
        }));
      }

      if (curriculumId && entries.length) {
        const updatedEntries = entries.map((e, i) => {
          const session = i + 1;
          const currentIds = (e.assertionIds || []).filter((id) => id !== assertionId);
          if (session === toSession) currentIds.push(assertionId);
          return { ...e, assertionIds: currentIds.length > 0 ? currentIds : undefined };
        });
        setSessionsData((prev) => prev ? {
          ...prev,
          plan: prev.plan ? { ...prev.plan, entries: updatedEntries } : null,
        } : null);
        fetch(`/api/curricula/${curriculumId}/lesson-plan`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: updatedEntries }),
        }).catch(() => {});
      }
    });
  }, [curriculumId, entries]);

  // ── Retry ────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    setError(null);
    setSessionsData(null);
    setLoading(true);
    fetch(`/api/courses/${courseId}/sessions`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setSessionsData(data);
        else setError(data.error || 'Failed to load');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Network error'))
      .finally(() => setLoading(false));
  }, [courseId]);

  // ── Render: Loading ──────────────────────────────────

  if (loading) {
    return (
      <div className="hf-empty">
        <div className="hf-spinner" />
        <p>Loading session...</p>
      </div>
    );
  }

  // ── Render: Error ────────────────────────────────────

  if (error) {
    return (
      <div className="hf-card" style={{ marginTop: 16 }}>
        <div className="hf-banner hf-banner-error">{error}</div>
        <div className="hf-flex hf-gap-sm" style={{ marginTop: 12 }}>
          <button onClick={handleRetry} className="hf-btn hf-btn-secondary hf-btn-sm">Retry</button>
          <Link href={`/x/courses/${courseId}`} className="hf-btn hf-btn-secondary hf-btn-sm">
            <ArrowLeft size={13} /> Back to Course
          </Link>
        </div>
      </div>
    );
  }

  // ── Render: Not Found ────────────────────────────────

  if (!entry || sessionNum < 1 || sessionNum > totalSessions || isNaN(sessionNum)) {
    return (
      <div className="hf-card" style={{ marginTop: 16 }}>
        <p className="hf-text-muted">
          Session {sessionNum} does not exist.{totalSessions > 0 && ` This course has ${totalSessions} session${totalSessions !== 1 ? 's' : ''}.`}
        </p>
        <Link href={`/x/courses/${courseId}`} className="sd-back-link" style={{ marginTop: 12 }}>
          <ArrowLeft size={14} /> Back to Course
        </Link>
      </div>
    );
  }

  // ── Render: Session Detail ───────────────────────────

  const typeColor = getSessionTypeColor(entry.type);
  const typeLabel = getSessionTypeLabel(entry.type);
  const TypeIcon = SESSION_TYPE_ICONS[entry.type];
  const loRefs = entry.learningOutcomeRefs || [];
  const tpsForSession = sessionTPs[sessionNum] || [];
  const module = sessionsData?.modules?.find((m) => m.id === entry.moduleId);

  return (
    <div>
      {/* Prev / Next navigation */}
      <div className="sd-nav-bar">
        <button
          className="sd-nav-btn"
          disabled={sessionNum <= 1}
          onClick={() => router.push(`/x/courses/${courseId}/sessions/${sessionNum - 1}`)}
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="sd-nav-counter">
          Session {sessionNum} of {totalSessions}
        </span>
        <button
          className="sd-nav-btn"
          disabled={sessionNum >= totalSessions}
          onClick={() => router.push(`/x/courses/${courseId}/sessions/${sessionNum + 1}`)}
        >
          Next <ChevronRight size={14} />
        </button>
        {/* Save indicator */}
        {saving && (
          <span className="sd-save-indicator sd-save-indicator--saving">
            <div className="hf-spinner hf-spinner-xs" /> Saving...
          </span>
        )}
        {saveError && (
          <span className="sd-save-indicator sd-save-indicator--error">
            Save failed
            <button onClick={() => setSaveError(null)} className="sd-edit-btn">dismiss</button>
          </span>
        )}
      </div>

      {/* Header: Type badge + Title */}
      <div className="sd-header">
        <span className="sd-type-badge" style={{ '--session-color': typeColor } as React.CSSProperties}>
          {TypeIcon && <TypeIcon size={13} />}
          {typeLabel}
        </span>
        <EditableTitle
          value={entry.label}
          onSave={handleTitleSave}
          as="h1"
          disabled={!isOperator}
        />
      </div>

      {/* Overview card */}
      <div className="hf-card sd-section">
        <div className="sd-section-header">
          <LayersIcon size={15} className="hf-text-muted" />
          <span className="sd-section-title">Overview</span>
        </div>
        <div className="sd-overview-grid">
          {/* Type */}
          <div className="sd-field">
            <span className="sd-field-label">Type</span>
            {isOperator ? (
              <select
                className="sd-type-select"
                value={entry.type}
                onChange={(e) => updateEntry({ type: e.target.value })}
              >
                {(isFormStop(entry.type) || entry.type === 'onboarding' || entry.type === 'offboarding'
                  ? SESSION_TYPES.filter((t) => t.value === entry.type)
                  : TEACHING_SESSION_TYPE_ENTRIES
                ).map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            ) : (
              <span className="sd-field-value">{typeLabel}</span>
            )}
          </div>

          {/* Duration */}
          <div className="sd-field">
            <span className="sd-field-label">Duration</span>
            {isOperator ? (
              <div className="hf-flex hf-items-center">
                <input
                  type="number"
                  className="sd-duration-input"
                  value={entry.estimatedDurationMins ?? ''}
                  min={1}
                  max={180}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                    debouncedUpdateEntry({ estimatedDurationMins: val });
                  }}
                />
                <span className="sd-duration-unit">min</span>
              </div>
            ) : (
              <span className="sd-field-value">
                {entry.estimatedDurationMins ? `${entry.estimatedDurationMins} min` : '—'}
              </span>
            )}
          </div>

          {/* Module */}
          {(module || entry.moduleLabel) && (
            <div className="sd-field">
              <span className="sd-field-label">Module</span>
              <span className="sd-field-value">{module?.title || entry.moduleLabel}</span>
            </div>
          )}

          {/* LO Refs */}
          {loRefs.length > 0 && (
            <div className="sd-field">
              <span className="sd-field-label">Learning Outcomes</span>
              <div className="sd-lo-chips">
                {loRefs.map((lo) => (
                  <span key={lo} className="hf-chip hf-chip-sm">{lo}</span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="sd-field sd-field-full">
            <span className="sd-field-label">Notes</span>
            {isOperator ? (
              <textarea
                className="sd-notes-textarea"
                value={entry.notes || ''}
                placeholder="Add notes for this session..."
                onChange={(e) => debouncedUpdateEntry({ notes: e.target.value || null })}
              />
            ) : (
              <div className={entry.notes ? 'sd-notes-display' : 'sd-notes-display sd-notes-empty'}>
                {entry.notes || 'No notes'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Teaching Points */}
      {tpLoaded && (
        <div className="hf-card sd-section">
          <div className="sd-section-header">
            <BookOpen size={15} className="hf-text-muted" />
            <span className="sd-section-title">Teaching Points</span>
            <span className="sd-section-count">({tpsForSession.length})</span>
          </div>
          <SessionTPList
            sessionNumber={sessionNum}
            assertions={tpsForSession}
            sessions={sessionTPOptions}
            onMove={handleTPMove}
            readonly={!isOperator}
          />
        </div>
      )}

      {/* Images */}
      {currentMediaImages.length > 0 && (
        <div className="hf-card sd-section">
          <div className="sd-section-header">
            <Image size={15} className="hf-text-muted" />
            <span className="sd-section-title">Images</span>
            <span className="sd-section-count">({currentMediaImages.length})</span>
          </div>
          <div className="sd-media-strip">
            {currentMediaImages.map((img) => (
              <img
                key={img.mediaId}
                src={`/api/media/${img.mediaId}`}
                alt={img.captionText || img.fileName || 'Session image'}
                className="sd-media-thumb"
                title={img.captionText || img.fileName || undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Back link */}
      <Link href={`/x/courses/${courseId}`} className="sd-back-link">
        <ArrowLeft size={14} /> Back to Course
      </Link>
    </div>
  );
}
