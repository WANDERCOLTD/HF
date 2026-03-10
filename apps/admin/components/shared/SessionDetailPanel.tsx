'use client';

/**
 * SessionDetailPanel — read-only inline detail for a single session.
 * Used inside JourneyRail's expanded view for non-onboarding sessions.
 *
 * Shows: notes, module, phases (zebra-striped with guidance/methods), materials, TPs.
 */

import { Paperclip, ExternalLink, BookOpen, Clock, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getSessionTypeLabel } from '@/lib/lesson-plan/session-ui';
import type { SessionEntry } from '@/lib/lesson-plan/types';
import type { TPItem } from '@/components/shared/SessionTPList';

export interface SessionDetailPanelProps {
  entry: SessionEntry;
  courseId: string;
  tps?: TPItem[];
  showEditLink?: boolean;
}

export function SessionDetailPanel({ entry, courseId, tps, showEditLink }: SessionDetailPanelProps) {
  const router = useRouter();
  const phases = entry.phases ?? [];
  const media = entry.media ?? [];
  const phaseMedia = phases.flatMap((p) => p.media ?? []);
  const allMedia = [...media, ...phaseMedia];
  const totalTPs = tps?.length ?? entry.assertionCount ?? 0;

  return (
    <div className="sdp-root">
      {/* Notes */}
      {entry.notes && (
        <p className="hf-text-xs hf-text-secondary hf-mb-md">{entry.notes}</p>
      )}

      {/* Meta row */}
      <div className="sdp-meta">
        {entry.moduleLabel && (
          <span className="sdp-meta-item">
            <BookOpen size={12} className="hf-text-muted" />
            {entry.moduleLabel}
          </span>
        )}
        {entry.estimatedDurationMins && (
          <span className="sdp-meta-item">
            <Clock size={12} className="hf-text-muted" />
            {entry.estimatedDurationMins}m
          </span>
        )}
        {totalTPs > 0 && (
          <span className="sdp-meta-item">
            <Zap size={12} className="hf-text-muted" />
            {totalTPs} teaching point{totalTPs !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Phases — zebra striped */}
      {phases.length > 0 && (
        <div className="sdp-phases">
          {phases.map((phase, i) => (
            <div key={phase.id + i} className={`sdp-phase ${i % 2 === 0 ? 'sdp-phase--even' : ''}`}>
              <div className="sdp-phase-header">
                <span className="sdp-phase-label">{phase.label}</span>
                {phase.durationMins && (
                  <span className="sdp-phase-dur">{phase.durationMins}m</span>
                )}
              </div>
              {phase.teachMethods && phase.teachMethods.length > 0 && (
                <div className="sdp-phase-methods">
                  {phase.teachMethods.map((m) => (
                    <span key={m} className="hf-chip hf-chip-sm">{m.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              )}
              {phase.guidance && (
                <p className="sdp-phase-guidance">{phase.guidance}</p>
              )}
              {phase.media && phase.media.length > 0 && (
                <div className="sdp-phase-media">
                  {phase.media.map((m) => (
                    <span key={m.mediaId} className="sdp-material-chip">
                      <Paperclip size={10} />
                      {m.fileName || m.figureRef || 'File'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Session-level materials */}
      {media.length > 0 && (
        <div className="sdp-materials">
          {media.map((m) => (
            <span key={m.mediaId} className="sdp-material-chip">
              {m.mimeType?.startsWith('image/') ? (
                <img
                  src={`/api/media/${m.mediaId}`}
                  alt={m.captionText || m.fileName || ''}
                  className="sdp-material-thumb"
                />
              ) : (
                <Paperclip size={10} />
              )}
              {m.fileName || m.figureRef || 'File'}
            </span>
          ))}
        </div>
      )}

      {/* Teaching points (summary) */}
      {tps && tps.length > 0 && (
        <div className="sdp-tps">
          <div className="hf-text-xs hf-text-muted hf-mb-xs">Teaching Points</div>
          <div className="sdp-tp-list">
            {tps.slice(0, 8).map((tp) => (
              <span key={tp.id} className="sdp-tp-chip" title={tp.assertion}>
                {tp.assertion.length > 60 ? tp.assertion.slice(0, 57) + '...' : tp.assertion}
              </span>
            ))}
            {tps.length > 8 && (
              <span className="hf-text-xs hf-text-muted">+{tps.length - 8} more</span>
            )}
          </div>
        </div>
      )}

      {/* Edit link */}
      {showEditLink && (
        <button
          className="jrl-detail-link hf-mt-md"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/x/courses/${courseId}/sessions/${entry.session}`);
          }}
          type="button"
        >
          <ExternalLink size={11} /> Edit session details
        </button>
      )}
    </div>
  );
}
