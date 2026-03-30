'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Star, Send } from 'lucide-react';
import './chat-survey.css';

// ── Types ──────────────────────────────────────────────

type StepType = 'message' | 'stars' | 'options' | 'nps' | 'text';

export type SurveyStep = {
  id: string;
  type: StepType;
  /** AI message shown before the input (or standalone for type 'message') */
  prompt: string;
  /** For 'options' type */
  options?: { value: string; label: string }[];
  /** For 'text' type */
  placeholder?: string;
  maxLength?: number;
  optional?: boolean;
};

type SurveyAnswers = Record<string, string | number>;

type Props = {
  steps: SurveyStep[];
  tutorName?: string;
  onComplete: (answers: SurveyAnswers) => void;
  submitting?: boolean;
  submitLabel?: string;
};

// ── Typing delay for natural feel ──

function useTypingDelay(ms: number = 800): [boolean, () => Promise<void>] {
  const [typing, setTyping] = useState(false);
  const trigger = useCallback(async () => {
    setTyping(true);
    await new Promise((r) => setTimeout(r, ms));
    setTyping(false);
  }, [ms]);
  return [typing, trigger];
}

// ── Component ──────────────────────────────────────────

export function ChatSurvey({ steps, tutorName = 'AI Tutor', onComplete, submitting, submitLabel = 'Continue' }: Props): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [messages, setMessages] = useState<Array<{ role: 'assistant' | 'user'; content: string }>>([]);
  const [textDraft, setTextDraft] = useState('');
  const [typing, triggerTyping] = useTypingDelay(600 + Math.random() * 400);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const step = steps[currentStep] as SurveyStep | undefined;
  const isComplete = currentStep >= steps.length;

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, currentStep]);

  // Show first AI message on mount / step advance
  useEffect(() => {
    if (!step) return;
    if (step.type === 'message') {
      // Pure message — show it and auto-advance
      triggerTyping().then(() => {
        setMessages((prev) => [...prev, { role: 'assistant', content: step.prompt }]);
        setCurrentStep((s) => s + 1);
      });
    } else {
      // Input step — show the prompt as AI message
      triggerTyping().then(() => {
        setMessages((prev) => [...prev, { role: 'assistant', content: step.prompt }]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // ── Answer handlers ──

  const advance = useCallback((stepId: string, value: string | number, displayText: string) => {
    setAnswers((prev) => ({ ...prev, [stepId]: value }));
    setMessages((prev) => [...prev, { role: 'user', content: displayText }]);
    setTextDraft('');
    // Small delay before next step
    setTimeout(() => setCurrentStep((s) => s + 1), 300);
  }, []);

  const handleStarClick = useCallback((n: number) => {
    if (!step) return;
    advance(step.id, n, '⭐'.repeat(n));
  }, [step, advance]);

  const handleOptionClick = useCallback((value: string, label: string) => {
    if (!step) return;
    advance(step.id, value, label);
  }, [step, advance]);

  const handleNpsClick = useCallback((n: number) => {
    if (!step) return;
    advance(step.id, n, `${n}/10`);
  }, [step, advance]);

  const handleTextSubmit = useCallback(() => {
    if (!step) return;
    const text = textDraft.trim();
    if (!text && !step.optional) return;
    if (!text && step.optional) {
      // Skip optional
      setCurrentStep((s) => s + 1);
      return;
    }
    advance(step.id, text, text);
  }, [step, textDraft, advance]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  }, [handleTextSubmit]);

  // ── Render ──

  return (
    <div className="cs-container">
      {/* Header */}
      <div className="cs-header">
        <div className="cs-avatar">{tutorName[0]}</div>
        <div className="cs-header-text">
          <div className="cs-header-name">{tutorName}</div>
          <div className="cs-header-status">{typing ? 'typing...' : 'online'}</div>
        </div>
      </div>

      {/* Messages */}
      <div className="cs-messages" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`cs-bubble cs-bubble--${msg.role}`}>
            <div className="cs-bubble-content">{msg.content}</div>
          </div>
        ))}

        {/* Typing indicator */}
        {typing && (
          <div className="cs-bubble cs-bubble--assistant">
            <div className="cs-typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        {/* Input area (inline in chat) */}
        {!typing && step && !isComplete && step.type !== 'message' && messages.length > 0 && (
          <div className="cs-input-area">
            {step.type === 'stars' && (
              <div className="cs-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className="cs-star-btn" onClick={() => handleStarClick(n)} aria-label={`${n} stars`}>
                    <Star size={32} />
                  </button>
                ))}
              </div>
            )}

            {step.type === 'options' && step.options && (
              <div className="cs-options">
                {step.options.map((opt) => (
                  <button
                    key={opt.value}
                    className="cs-option-btn"
                    onClick={() => handleOptionClick(opt.value, opt.label)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {step.type === 'nps' && (
              <div className="cs-nps">
                {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                  <button key={n} className="cs-nps-btn" onClick={() => handleNpsClick(n)}>
                    {n}
                  </button>
                ))}
                <div className="cs-nps-labels">
                  <span>Not likely</span>
                  <span>Very likely</span>
                </div>
              </div>
            )}

            {step.type === 'text' && (
              <div className="cs-text-input">
                <textarea
                  ref={inputRef}
                  className="cs-textarea"
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={step.placeholder || 'Type your answer...'}
                  maxLength={step.maxLength || 200}
                  rows={2}
                  autoFocus
                />
                <button
                  className="cs-send-btn"
                  onClick={handleTextSubmit}
                  disabled={!textDraft.trim() && !step.optional}
                >
                  <Send size={18} />
                </button>
                {step.optional && (
                  <button
                    className="cs-skip-btn"
                    onClick={() => { setCurrentStep((s) => s + 1); }}
                  >
                    Skip
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Complete — submit button */}
        {isComplete && !typing && (
          <div className="cs-complete">
            <button
              className="cs-submit-btn"
              onClick={() => onComplete(answers)}
              disabled={submitting}
            >
              {submitting ? 'Saving...' : submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
