"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Phone, Paperclip, X, Plus } from "lucide-react";
import "@/components/shared/onboarding-preview.css";

// ── Types ──────────────────────────────────────────────

export interface FirstCallPhaseContent {
  mediaId: string;
  fileName: string;
  title?: string | null;
  instruction?: string;
}

export interface FirstCallPhase {
  phase: string;
  duration: string;
  goals: string[];
  content: FirstCallPhaseContent[];
}

export interface FirstCallPreviewData {
  domainId: string;
  playbookId: string;
  welcomeMessage: string | null;
  phases: FirstCallPhase[];
}

interface FirstCallPreviewCardProps {
  preview: FirstCallPreviewData;
  onUpdated?: (updated: FirstCallPreviewData) => void;
}

// ── Caller response placeholders ───────────────────────

const CALLER_RESPONSES: Record<string, string> = {
  welcome: "Thanks! I'm looking forward to this.",
  discover: "I'd really like to improve my understanding of...",
  discovery: "I'd really like to improve my understanding of...",
  close: "This was really helpful, thank you!",
  "wrap-up": "This was really helpful, thank you!",
};

// ── Available media for "add" dropdown ─────────────────

interface AvailableMedia {
  id: string;
  fileName: string;
  title: string | null;
}

// ── Component ──────────────────────────────────────────

export function FirstCallPreviewCard({ preview, onUpdated }: FirstCallPreviewCardProps) {
  const [open, setOpen] = useState(false);
  const [phases, setPhases] = useState<FirstCallPhase[]>(preview.phases);
  const [availableMedia, setAvailableMedia] = useState<AvailableMedia[]>([]);
  const [dropdownPhase, setDropdownPhase] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available media from course (playbook) subjects
  useEffect(() => {
    if (!preview.playbookId) return;
    fetch(`/api/courses/${preview.playbookId}/media?limit=50`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data.media) {
          setAvailableMedia(data.media.map((m: any) => ({
            id: m.id,
            fileName: m.fileName,
            title: m.title,
          })));
        }
      })
      .catch(() => {});
  }, [preview.playbookId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (dropdownPhase === null) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownPhase(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownPhase]);

  // Persist changes
  const persistPhases = useCallback(
    async (updatedPhases: FirstCallPhase[]) => {
      setPhases(updatedPhases);
      const updated: FirstCallPreviewData = { ...preview, phases: updatedPhases };
      onUpdated?.(updated);

      // Persist to DB via onboarding API
      try {
        await fetch(`/api/domains/${preview.domainId}/onboarding`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            onboardingFlowPhases: {
              phases: updatedPhases.map((p) => ({
                phase: p.phase,
                duration: p.duration,
                goals: p.goals,
                content: p.content.map((c) => ({
                  mediaId: c.mediaId,
                  instruction: c.instruction,
                })),
              })),
            },
          }),
        });
      } catch {
        // Silent fail — optimistic UI, data still in local state
      }
    },
    [preview, onUpdated],
  );

  const removeAttachment = (phaseIdx: number, mediaId: string) => {
    const updated = phases.map((p, i) => {
      if (i !== phaseIdx) return p;
      return { ...p, content: p.content.filter((c) => c.mediaId !== mediaId) };
    });
    persistPhases(updated);
  };

  const addAttachment = (phaseIdx: number, media: AvailableMedia) => {
    const updated = phases.map((p, i) => {
      if (i !== phaseIdx) return p;
      return {
        ...p,
        content: [
          ...p.content,
          {
            mediaId: media.id,
            fileName: media.fileName,
            title: media.title,
            instruction: "Share this with the learner during this phase",
          },
        ],
      };
    });
    persistPhases(updated);
    setDropdownPhase(null);
  };

  // Media already assigned to any phase
  const assignedIds = new Set(phases.flatMap((p) => p.content.map((c) => c.mediaId)));
  const unassignedMedia = availableMedia.filter((m) => !assignedIds.has(m.id));

  const totalAttachments = phases.reduce((sum, p) => sum + p.content.length, 0);

  return (
    <div className="cv4-accordion">
      <button
        type="button"
        className="cv4-accordion-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="cv4-accordion-title">
          <Phone size={14} />
          <span>First Call Preview</span>
          <span className="cv4-accordion-count">
            {phases.length} phases{totalAttachments > 0 ? ` · ${totalAttachments} materials` : ""}
          </span>
        </div>
        <ChevronDown
          size={14}
          className="cv4-accordion-chevron"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="cv4-firstcall-body">
          <div className="ob-preview-chat" style={{ maxHeight: 500 }}>
            {/* Welcome phase */}
            {phases[0] && (
              <>
                <div className="ob-chat-sep">
                  <span className="ob-chat-sep-line" />
                  <span className="ob-chat-sep-label">
                    {phases[0].phase}
                    {phases[0].duration && (
                      <span className="ob-chat-sep-dur"> · {phases[0].duration}</span>
                    )}
                  </span>
                  <span className="ob-chat-sep-line" />
                </div>

                {preview.welcomeMessage ? (
                  <div className="ob-chat-ai">
                    <div className="ob-chat-text">{preview.welcomeMessage}</div>
                    <PhaseAttachments
                      phaseIdx={0}
                      content={phases[0].content}
                      unassignedMedia={unassignedMedia}
                      dropdownPhase={dropdownPhase}
                      dropdownRef={dropdownRef}
                      onRemove={removeAttachment}
                      onAdd={addAttachment}
                      onToggleDropdown={setDropdownPhase}
                    />
                  </div>
                ) : (
                  <div className="ob-chat-ai">
                    <div className="ob-chat-goals">
                      {phases[0].goals.slice(0, 3).join(". ")}
                    </div>
                    <PhaseAttachments
                      phaseIdx={0}
                      content={phases[0].content}
                      unassignedMedia={unassignedMedia}
                      dropdownPhase={dropdownPhase}
                      dropdownRef={dropdownRef}
                      onRemove={removeAttachment}
                      onAdd={addAttachment}
                      onToggleDropdown={setDropdownPhase}
                    />
                  </div>
                )}

                {CALLER_RESPONSES[phases[0].phase.toLowerCase()] && (
                  <div className="ob-chat-caller">
                    <div className="ob-chat-text">
                      {CALLER_RESPONSES[phases[0].phase.toLowerCase()]}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Subsequent phases */}
            {phases.slice(1).map((phase, i) => {
              const phaseIdx = i + 1;
              const phaseKey = phase.phase.toLowerCase();
              const callerText = CALLER_RESPONSES[phaseKey];

              return (
                <div key={`${phase.phase}-${phaseIdx}`}>
                  <div className="ob-chat-sep">
                    <span className="ob-chat-sep-line" />
                    <span className="ob-chat-sep-label">
                      {phase.phase}
                      {phase.duration && (
                        <span className="ob-chat-sep-dur"> · {phase.duration}</span>
                      )}
                    </span>
                    <span className="ob-chat-sep-line" />
                  </div>

                  <div className="ob-chat-ai">
                    <div className="ob-chat-goals">
                      {phase.goals.slice(0, 3).join(". ")}
                    </div>
                    <PhaseAttachments
                      phaseIdx={phaseIdx}
                      content={phase.content}
                      unassignedMedia={unassignedMedia}
                      dropdownPhase={dropdownPhase}
                      dropdownRef={dropdownRef}
                      onRemove={removeAttachment}
                      onAdd={addAttachment}
                      onToggleDropdown={setDropdownPhase}
                    />
                  </div>

                  {callerText && (
                    <div className="ob-chat-caller">
                      <div className="ob-chat-text">{callerText}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Phase attachments sub-component ────────────────────

interface PhaseAttachmentsProps {
  phaseIdx: number;
  content: FirstCallPhaseContent[];
  unassignedMedia: AvailableMedia[];
  dropdownPhase: number | null;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onRemove: (phaseIdx: number, mediaId: string) => void;
  onAdd: (phaseIdx: number, media: AvailableMedia) => void;
  onToggleDropdown: (phaseIdx: number | null) => void;
}

function PhaseAttachments({
  phaseIdx,
  content,
  unassignedMedia,
  dropdownPhase,
  dropdownRef,
  onRemove,
  onAdd,
  onToggleDropdown,
}: PhaseAttachmentsProps) {
  const isDropdownOpen = dropdownPhase === phaseIdx;

  return (
    <div className="ob-edit-chips">
      {content.map((c) => (
        <span key={c.mediaId} className="ob-edit-chip">
          <Paperclip size={10} className="ob-edit-chip-icon" />
          <span className="ob-edit-chip-name" title={c.title || c.fileName}>
            {c.title || c.fileName}
          </span>
          <button
            type="button"
            className="ob-edit-chip-remove"
            onClick={() => onRemove(phaseIdx, c.mediaId)}
            title="Remove from this phase"
          >
            <X size={10} />
          </button>
        </span>
      ))}

      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          className="ob-edit-add-btn"
          onClick={() => onToggleDropdown(isDropdownOpen ? null : phaseIdx)}
          title="Add material to this phase"
        >
          <Plus size={10} />
          <span>Add material</span>
        </button>

        {isDropdownOpen && (
          <div className="ob-edit-dropdown" ref={dropdownRef}>
            {unassignedMedia.length === 0 ? (
              <div className="ob-edit-dropdown-empty">
                No unassigned materials
              </div>
            ) : (
              unassignedMedia.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="ob-edit-dropdown-item"
                  onClick={() => onAdd(phaseIdx, m)}
                >
                  <Paperclip size={10} />
                  <span>{m.title || m.fileName}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
