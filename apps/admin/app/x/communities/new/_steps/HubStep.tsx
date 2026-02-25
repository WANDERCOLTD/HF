'use client';

import { useState, useEffect, useRef } from 'react';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import type { StepRenderProps } from '@/components/wizards/types';

type CommunityKind = 'TOPIC_BASED' | 'OPEN_CONNECTION';

const KIND_OPTIONS: Array<{ value: CommunityKind; label: string; description: string }> = [
  {
    value: 'TOPIC_BASED',
    label: 'Topic-based',
    description: 'Members discuss specific subjects',
  },
  {
    value: 'OPEN_CONNECTION',
    label: 'Open connection',
    description: 'Members call to talk and be heard',
  },
];

export function HubStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<CommunityKind | undefined>();
  const [suggestedKind, setSuggestedKind] = useState<CommunityKind | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore saved data
  useEffect(() => {
    const savedName = getData<string>('hubName');
    const savedDesc = getData<string>('hubDescription');
    const savedKind = getData<CommunityKind>('communityKind');
    if (savedName) setName(savedName);
    if (savedDesc) setDescription(savedDesc);
    if (savedKind) setKind(savedKind);
  }, [getData]);

  const handleDescriptionBlur = () => {
    if (!description.trim() || kind) return;
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(async () => {
      setSuggesting(true);
      try {
        const res = await fetch('/api/communities/suggest-kind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        });
        const data = await res.json();
        if (data.ok && !kind) {
          setSuggestedKind(data.kind);
        }
      } catch {
        // Silent — suggestion is optional
      } finally {
        setSuggesting(false);
      }
    }, 300);
  };

  const handleKindSelect = (k: CommunityKind) => {
    setKind(k);
    setSuggestedKind(null);
  };

  const handleNext = () => {
    const selectedKind = kind ?? suggestedKind ?? 'OPEN_CONNECTION';
    setData('hubName', name.trim());
    setData('hubDescription', description.trim());
    setData('communityKind', selectedKind);
    onNext();
  };

  const effectiveKind = kind ?? suggestedKind;
  const isValid = name.trim().length > 0 && !!effectiveKind;

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">Create Your Community Hub</h1>
          <p className="hf-page-subtitle">Tell us about this community and how members will connect</p>
        </div>

        {/* Hub Name */}
        <div className="hf-mb-lg">
          <FieldHint
            label="What's your community called?"
            hint={WIZARD_HINTS['community.hubName']}
            labelClass="hf-label"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Riverside Residents, Over-60s Wellbeing Club"
            className="hf-input"
          />
        </div>

        {/* Description */}
        <div className="hf-mb-lg">
          <FieldHint
            label="What is this community for?"
            hint={WIZARD_HINTS['community.hubDescription']}
            labelClass="hf-label"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="e.g., A community for elderly residents who want someone to talk to"
            className="hf-input"
            rows={3}
          />
          {suggesting && (
            <p className="hf-hint hf-mt-xs">Thinking about the best setup…</p>
          )}
        </div>

        {/* Community Kind */}
        <div className="hf-mb-lg">
          <FieldHint
            label="What kind of community is this?"
            hint={WIZARD_HINTS['community.communityKind']}
            labelClass="hf-label"
          />
          <div className="hf-chip-row">
            {KIND_OPTIONS.map((opt) => {
              const isSelected = kind === opt.value;
              const isSuggested = !kind && suggestedKind === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleKindSelect(opt.value)}
                  className={isSelected || isSuggested ? 'hf-chip hf-chip-selected' : 'hf-chip'}
                  title={opt.description}
                >
                  <span>{opt.label}</span>
                  {isSuggested && <span className="hf-chip-badge">Suggested</span>}
                </button>
              );
            })}
          </div>
          {effectiveKind && (
            <p className="hf-hint hf-mt-xs">
              {effectiveKind === 'TOPIC_BASED'
                ? 'Next step: add topics with individual AI interaction styles.'
                : 'Next step: choose how the AI engages with all members.'}
            </p>
          )}
        </div>
      </div>

      <div className="hf-step-footer">
        <button onClick={onPrev} disabled className="hf-btn hf-btn-ghost">Back</button>
        <button onClick={handleNext} disabled={!isValid} className="hf-btn hf-btn-primary">Next</button>
      </div>
    </div>
  );
}
