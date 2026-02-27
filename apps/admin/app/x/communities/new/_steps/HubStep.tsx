'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
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
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Description suggestion from hub name
  const [suggDesc, setSuggDesc] = useState('');
  const [loadingSuggDesc, setLoadingSuggDesc] = useState(false);

  // Restore saved data
  useEffect(() => {
    const savedName = getData<string>('hubName');
    const savedDesc = getData<string>('hubDescription');
    const savedKind = getData<CommunityKind>('communityKind');
    if (savedName) setName(savedName);
    if (savedDesc) setDescription(savedDesc);
    if (savedKind) setKind(savedKind);
  }, [getData]);

  const handleNameBlur = async () => {
    if (name.trim().length < 3 || description.trim()) return;
    setLoadingSuggDesc(true);
    try {
      const res = await fetch('/api/communities/suggest-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubName: name, communityKind: kind ?? suggestedKind ?? undefined }),
      });
      const data = await res.json();
      if (data.ok && data.description && !description.trim()) {
        setSuggDesc(data.description);
      }
    } catch {
      // Silent — suggestion is optional
    } finally {
      setLoadingSuggDesc(false);
    }
  };

  const handleDescriptionBlur = () => {
    if (!description.trim() || kind) return;
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(async () => {

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
            onBlur={handleNameBlur}
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
          <div className="hf-suggest-slot">
            {loadingSuggDesc ? (
              <div className="hf-ai-loading-row">
                <Loader2 size={12} className="hf-spinner" />
                <span className="hf-text-xs hf-text-muted">Suggesting…</span>
              </div>
            ) : suggDesc && !description.trim() ? (
              <>
                <div className="hf-ai-inline-hint">
                  <Sparkles size={11} />
                  Suggestions
                </div>
                <div className="hf-suggestion-chips">
                  <button
                    type="button"
                    className="hf-suggestion-chip"
                    onClick={() => { setDescription(suggDesc); setSuggDesc(''); }}
                  >
                    {suggDesc}
                  </button>
                </div>
              </>
            ) : (
              <span className="hf-suggest-slot__hint">
                <Sparkles size={11} />
                A description will be suggested from the name
              </span>
            )}
          </div>
        </div>

        {/* Community Kind */}
        <div className="hf-mb-lg">
          <FieldHint
            label="What kind of community is this?"
            hint={WIZARD_HINTS['community.communityKind']}
            labelClass="hf-label"
          />
          <div className="hf-chip-row" role="radiogroup" aria-label="Community kind">
            {KIND_OPTIONS.map((opt) => {
              const isSelected = kind === opt.value;
              const isSuggested = !kind && suggestedKind === opt.value;
              const isFocusable = isSelected || isSuggested;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleKindSelect(opt.value)}
                  className={isSelected || isSuggested ? 'hf-chip hf-chip-selected' : 'hf-chip'}
                  title={opt.description}
                  tabIndex={isFocusable ? 0 : -1}
                  role="radio"
                  aria-checked={isSelected || isSuggested}
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
