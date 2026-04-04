'use client';

/**
 * ChatSurveyInput — renders a single survey step's input controls
 * (stars, options, MCQ, true/false, NPS, text) without its own container
 * or scroll. Designed to be embedded in SimChat's input area.
 *
 * Extracted from ChatSurvey.tsx input rendering (lines 372-473).
 */

import { useState, useRef } from 'react';
import { Star, Send } from 'lucide-react';
import type { SurveyStep } from '@/components/student/ChatSurvey';
import '@/components/student/chat-survey.css';

interface ChatSurveyInputProps {
  step: SurveyStep;
  /** Called when the user answers. displayText is what shows in the user bubble. */
  onAnswer: (stepId: string, value: string | number, displayText: string) => void;
  disabled?: boolean;
}

export function ChatSurveyInput({ step, onAnswer, disabled }: ChatSurveyInputProps): React.ReactElement | null {
  const [textDraft, setTextDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  if (step.type === 'message') return null;

  if (step.type === 'stars') {
    return (
      <div className="cs-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className="cs-star-btn"
            onClick={() => onAnswer(step.id, n, '⭐'.repeat(n))}
            disabled={disabled}
            aria-label={`${n} stars`}
          >
            <Star size={32} />
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'options' && step.options) {
    return (
      <div className="cs-options">
        {step.options.map((opt) => (
          <button
            key={opt.value}
            className="cs-option-btn"
            onClick={() => onAnswer(step.id, opt.value, opt.label)}
            disabled={disabled}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'mcq' && step.options) {
    return (
      <div className="cs-options">
        {step.options.map((opt) => (
          <button
            key={opt.value}
            className="cs-option-btn"
            onClick={() => {
              const isCorrect = step.correctAnswer ? opt.value === step.correctAnswer : false;
              // For MCQ, store value and a hidden _correct marker
              onAnswer(step.id, opt.value, opt.label);
            }}
            disabled={disabled}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'true_false') {
    return (
      <div className="cs-tf-buttons">
        <button
          className="cs-tf-btn cs-tf-btn--true"
          onClick={() => onAnswer(step.id, 'True', 'True')}
          disabled={disabled}
        >
          True
        </button>
        <button
          className="cs-tf-btn cs-tf-btn--false"
          onClick={() => onAnswer(step.id, 'False', 'False')}
          disabled={disabled}
        >
          False
        </button>
      </div>
    );
  }

  if (step.type === 'nps') {
    return (
      <div className="cs-nps">
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            className="cs-nps-btn"
            onClick={() => onAnswer(step.id, n, String(n))}
            disabled={disabled}
          >
            {n}
          </button>
        ))}
        <div className="cs-nps-labels">
          <span>Not likely</span>
          <span>Very likely</span>
        </div>
      </div>
    );
  }

  if (step.type === 'text') {
    const handleSubmit = () => {
      if (!textDraft.trim() && !step.optional) return;
      onAnswer(step.id, textDraft.trim(), textDraft.trim());
      setTextDraft('');
    };

    return (
      <div className="cs-text-input">
        <textarea
          ref={inputRef}
          className="cs-textarea"
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={step.placeholder || 'Type your answer...'}
          maxLength={step.maxLength || 200}
          rows={2}
          autoFocus
          disabled={disabled}
        />
        <button
          className="cs-send-btn"
          onClick={handleSubmit}
          disabled={disabled || (!textDraft.trim() && !step.optional)}
        >
          <Send size={18} />
        </button>
        {step.optional && (
          <button
            className="cs-skip-btn"
            onClick={() => onAnswer(step.id, '', '(skipped)')}
            disabled={disabled}
          >
            Skip
          </button>
        )}
      </div>
    );
  }

  return null;
}
