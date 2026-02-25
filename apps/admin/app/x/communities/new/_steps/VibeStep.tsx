'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import {
  INTERACTION_PATTERN_ORDER,
  INTERACTION_PATTERN_LABELS,
  type InteractionPattern,
} from '@/lib/content-trust/resolve-config';
import type { StepRenderProps } from '@/components/wizards/types';

type CommunityKind = 'TOPIC_BASED' | 'OPEN_CONNECTION';

interface TopicRow {
  name: string;
  pattern: InteractionPattern | undefined;
  suggestedPattern: InteractionPattern | null;
  suggesting: boolean;
}

// Community-facing labels (subset of patterns — no directive, which is education-focused)
const COMMUNITY_PATTERNS: InteractionPattern[] = [
  'companion', 'advisory', 'coaching', 'socratic', 'facilitation', 'reflective', 'open',
];

const COMMUNITY_PATTERN_LABELS: Record<InteractionPattern, string> = {
  companion:    'Just be there',
  advisory:     'Give clear answers',
  coaching:     'Help them take action',
  socratic:     'Guide their thinking',
  facilitation: 'Help them organise',
  reflective:   'Explore and reflect',
  open:         'Follow their lead',
  directive:    'Direct and instruct',
};

function PatternChips({
  selected,
  suggested,
  onSelect,
}: {
  selected: InteractionPattern | undefined;
  suggested: InteractionPattern | null;
  onSelect: (p: InteractionPattern) => void;
}) {
  return (
    <div className="hf-chip-row">
      {COMMUNITY_PATTERNS.map((p) => {
        const isSelected = selected === p;
        const isSuggested = !selected && suggested === p;
        const info = INTERACTION_PATTERN_LABELS[p];
        return (
          <button
            key={p}
            type="button"
            onClick={() => onSelect(p)}
            className={isSelected || isSuggested ? 'hf-chip hf-chip-selected' : 'hf-chip'}
            title={info.description}
          >
            <span>{info.icon}</span>
            <span>{COMMUNITY_PATTERN_LABELS[p] ?? info.label}</span>
            {isSuggested && <span className="hf-chip-badge">Suggested</span>}
          </button>
        );
      })}
    </div>
  );
}

export function VibeStep({ getData, setData, onNext, onPrev }: StepRenderProps) {
  const communityKind = getData<CommunityKind>('communityKind') ?? 'OPEN_CONNECTION';
  const hubDescription = getData<string>('hubDescription') ?? '';

  // OPEN_CONNECTION state
  const [hubPattern, setHubPattern] = useState<InteractionPattern | undefined>();
  const [suggestedHubPattern, setSuggestedHubPattern] = useState<InteractionPattern | null>(null);

  // TOPIC_BASED state
  const [topics, setTopics] = useState<TopicRow[]>([{ name: '', pattern: undefined, suggestedPattern: null, suggesting: false }]);

  const suggestTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Restore saved data
  useEffect(() => {
    const savedPattern = getData<InteractionPattern>('hubPattern');
    const savedTopics = getData<Array<{ name: string; pattern: InteractionPattern }>>('topics');
    if (savedPattern) setHubPattern(savedPattern);
    if (savedTopics && savedTopics.length > 0) {
      setTopics(savedTopics.map((t) => ({ name: t.name, pattern: t.pattern, suggestedPattern: null, suggesting: false })));
    }
  }, [getData]);

  // For OPEN_CONNECTION: auto-suggest pattern from hub description on mount
  useEffect(() => {
    if (communityKind !== 'OPEN_CONNECTION' || hubPattern || !hubDescription) return;
    const suggest = async () => {
      try {
        const res = await fetch('/api/communities/suggest-pattern', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: hubDescription, context: 'hub' }),
        });
        const data = await res.json();
        if (data.ok && !hubPattern) {
          setSuggestedHubPattern(data.pattern);
        }
      } catch {
        // Silent
      }
    };
    suggest();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestTopicPattern = (index: number, name: string) => {
    if (!name.trim()) return;
    if (suggestTimers.current[index]) clearTimeout(suggestTimers.current[index]);
    suggestTimers.current[index] = setTimeout(async () => {
      setTopics((prev) => prev.map((t, i) => i === index ? { ...t, suggesting: true } : t));
      try {
        const res = await fetch('/api/communities/suggest-pattern', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: name, context: 'topic' }),
        });
        const data = await res.json();
        setTopics((prev) =>
          prev.map((t, i) =>
            i === index && !t.pattern ? { ...t, suggestedPattern: data.ok ? data.pattern : null, suggesting: false } : { ...t, suggesting: false }
          )
        );
      } catch {
        setTopics((prev) => prev.map((t, i) => i === index ? { ...t, suggesting: false } : t));
      }
    }, 500);
  };

  const handleTopicNameChange = (index: number, value: string) => {
    setTopics((prev) => prev.map((t, i) => i === index ? { ...t, name: value } : t));
    if (value.trim()) suggestTopicPattern(index, value);
  };

  const handleTopicPatternSelect = (index: number, pattern: InteractionPattern) => {
    setTopics((prev) => prev.map((t, i) => i === index ? { ...t, pattern, suggestedPattern: null } : t));
  };

  const addTopic = () => {
    if (topics.length >= 10) return;
    setTopics((prev) => [...prev, { name: '', pattern: undefined, suggestedPattern: null, suggesting: false }]);
  };

  const removeTopic = (index: number) => {
    setTopics((prev) => prev.filter((_, i) => i !== index));
  };

  const handleNext = () => {
    if (communityKind === 'OPEN_CONNECTION') {
      const selectedPattern = hubPattern ?? suggestedHubPattern ?? 'companion';
      setData('hubPattern', selectedPattern);
    } else {
      const validTopics = topics
        .filter((t) => t.name.trim())
        .map((t) => ({ name: t.name.trim(), pattern: t.pattern ?? t.suggestedPattern ?? 'companion' }));
      setData('topics', validTopics);
    }
    onNext();
  };

  const isValid = communityKind === 'OPEN_CONNECTION'
    ? !!(hubPattern ?? suggestedHubPattern)
    : topics.some((t) => t.name.trim());

  // ── OPEN CONNECTION mode ──
  if (communityKind === 'OPEN_CONNECTION') {
    const effectivePattern = hubPattern ?? suggestedHubPattern;
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step">
          <div className="hf-mb-lg">
            <h1 className="hf-page-title hf-mb-xs">How should the AI engage?</h1>
            <p className="hf-page-subtitle">Choose the AI's conversational approach for all members of this hub</p>
          </div>

          <div className="hf-mb-lg">
            <FieldHint
              label="AI interaction style"
              hint={WIZARD_HINTS['community.hubPattern']}
              labelClass="hf-label"
            />
            <PatternChips
              selected={hubPattern}
              suggested={suggestedHubPattern}
              onSelect={(p) => { setHubPattern(p); setSuggestedHubPattern(null); }}
            />
            {effectivePattern && (
              <p className="hf-hint hf-mt-xs">
                <strong>{INTERACTION_PATTERN_LABELS[effectivePattern].label}:</strong>{' '}
                {INTERACTION_PATTERN_LABELS[effectivePattern].description}
                {' · '}
                <em>{INTERACTION_PATTERN_LABELS[effectivePattern].examples}</em>
              </p>
            )}
          </div>

          <div className="hf-banner hf-banner-info hf-mb-lg">
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>Memory is how this AI builds a real relationship.</strong>{' '}
              Every call, it learns more about each member — their preferences, history, and what matters to them.
            </p>
          </div>
        </div>

        <div className="hf-step-footer">
          <button onClick={onPrev} className="hf-btn hf-btn-ghost">Back</button>
          <button onClick={handleNext} disabled={!isValid} className="hf-btn hf-btn-primary">Next</button>
        </div>
      </div>
    );
  }

  // ── TOPIC-BASED mode ──
  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <h1 className="hf-page-title hf-mb-xs">What topics will members discuss?</h1>
          <p className="hf-page-subtitle">Add topics — each gets its own AI interaction style</p>
        </div>

        <div className="hf-flex hf-flex-col hf-gap-md hf-mb-lg">
          {topics.map((topic, index) => (
            <div
              key={index}
              className="hf-card hf-card-compact"
              style={{ position: 'relative' }}
            >
              {topics.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTopic(index)}
                  className="hf-btn-ghost"
                  style={{ position: 'absolute', top: 12, right: 12, padding: 4 }}
                  title="Remove topic"
                >
                  <X size={16} />
                </button>
              )}

              <div className="hf-mb-sm">
                <FieldHint
                  label={`Topic ${index + 1}`}
                  hint={WIZARD_HINTS['community.topicName']}
                  labelClass="hf-label"
                />
                <input
                  type="text"
                  value={topic.name}
                  onChange={(e) => handleTopicNameChange(index, e.target.value)}
                  placeholder="e.g., Building Maintenance, Social Events"
                  className="hf-input"
                />
                {topic.suggesting && (
                  <p className="hf-hint hf-mt-xs">Suggesting interaction style…</p>
                )}
              </div>

              <div>
                <p className="hf-label hf-mb-xs">AI interaction style for this topic</p>
                <PatternChips
                  selected={topic.pattern}
                  suggested={topic.suggestedPattern}
                  onSelect={(p) => handleTopicPatternSelect(index, p)}
                />
                {(topic.pattern ?? topic.suggestedPattern) && (
                  <p className="hf-hint hf-mt-xs">
                    {(() => {
                      const p = topic.pattern ?? topic.suggestedPattern!;
                      const info = INTERACTION_PATTERN_LABELS[p];
                      return <>{info.icon} <strong>{COMMUNITY_PATTERN_LABELS[p] ?? info.label}:</strong> {info.description}</>;
                    })()}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {topics.length < 10 && (
          <button
            type="button"
            onClick={addTopic}
            className="hf-btn hf-btn-secondary hf-flex hf-items-center hf-gap-sm"
          >
            <Plus size={16} />
            Add topic
          </button>
        )}
      </div>

      <div className="hf-step-footer">
        <button onClick={onPrev} className="hf-btn hf-btn-ghost">Back</button>
        <button onClick={handleNext} disabled={!isValid} className="hf-btn hf-btn-primary">Next</button>
      </div>
    </div>
  );
}
