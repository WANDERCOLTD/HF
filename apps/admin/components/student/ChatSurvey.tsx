'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Star, Send } from 'lucide-react';
import './chat-survey.css';

// ── Types ──────────────────────────────────────────────

type StepType = 'message' | 'stars' | 'options' | 'nps' | 'text' | 'mcq' | 'true_false';

export type SurveyStep = {
  id: string;
  type: StepType;
  prompt: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  maxLength?: number;
  optional?: boolean;
  correctAnswer?: string;
  explanation?: string;
  chapter?: string;
  contentQuestionId?: string;
};

type ChatMessage = {
  role: 'assistant' | 'user';
  content: string;
  variant?: 'correct' | 'incorrect' | 'explanation' | 'encouragement' | 'summary';
};

type SurveyAnswers = Record<string, string | number | boolean>;

type Props = {
  steps: SurveyStep[];
  tutorName?: string;
  onComplete: (answers: SurveyAnswers) => void;
  submitting?: boolean;
  submitLabel?: string;
  /** Show question progress dots for assessment steps */
  showProgress?: boolean;
  /** Show score summary card after last assessment question */
  showSummary?: boolean;
  /** Persona tone for encouragement messages (from interactionPattern) */
  tone?: string;
};

// ── Encouragement bank (persona-matched) ──

interface EncouragementSet {
  streak3: string;
  streak6: string;
  hardWrong: string;
  bounceBack: string;
  summaryGood: string;
  summaryWeak: string;
}

const ENCOURAGEMENT: Record<string, EncouragementSet> = {
  socratic: {
    streak3: "Three in a row — you clearly know your stuff.",
    streak6: "Six straight. Impressive recall.",
    hardWrong: "That one requires deeper analysis — we'll explore it together.",
    bounceBack: "There you go — learning from mistakes is what matters.",
    summaryGood: "Strong foundation. Let's build on this.",
    summaryWeak: "Good baseline. We have clear areas to focus on.",
  },
  directive: {
    streak3: "3 correct. Good retention.",
    streak6: "6 in a row. Well prepared.",
    hardWrong: "We'll address that gap in our sessions.",
    bounceBack: "Correct. Moving on.",
    summaryGood: "Solid knowledge base. Ready to advance.",
    summaryWeak: "Clear areas to strengthen. Let's begin.",
  },
  default: {
    streak3: "3 in a row! Nice work!",
    streak6: "You're on fire — 6 correct!",
    hardWrong: "That was a tough one — we'll cover this in our sessions.",
    bounceBack: "You got it!",
    summaryGood: "Great start! You're going to do brilliantly.",
    summaryWeak: "Now I know exactly where to focus. Let's go!",
  },
};

function getEncouragement(tone: string): EncouragementSet {
  return ENCOURAGEMENT[tone] ?? ENCOURAGEMENT.default;
}

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

export function ChatSurvey({
  steps,
  tutorName = 'AI Tutor',
  onComplete,
  submitting,
  submitLabel = 'Continue',
  showProgress = false,
  showSummary = false,
  tone = 'default',
}: Props): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [typing, triggerTyping] = useTypingDelay(600 + Math.random() * 400);
  const [streak, setStreak] = useState(0);
  const [lastWasWrong, setLastWasWrong] = useState(false);
  const [showingSummary, setShowingSummary] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const enc = useMemo(() => getEncouragement(tone), [tone]);
  const step = steps[currentStep] as SurveyStep | undefined;
  const isComplete = currentStep >= steps.length;

  // Assessment-only steps (for progress counting)
  const assessmentSteps = useMemo(
    () => steps.filter((s) => s.type === 'mcq' || s.type === 'true_false'),
    [steps],
  );
  const currentAssessmentIndex = useMemo(() => {
    if (!step || (step.type !== 'mcq' && step.type !== 'true_false')) return -1;
    return assessmentSteps.findIndex((s) => s.id === step.id);
  }, [step, assessmentSteps]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, currentStep, showingSummary]);

  // Show first AI message on mount / step advance
  useEffect(() => {
    if (!step) return;
    if (step.type === 'message') {
      triggerTyping().then(() => {
        setMessages((prev) => [...prev, { role: 'assistant', content: step.prompt }]);
        setCurrentStep((s) => s + 1);
      });
    } else {
      triggerTyping().then(() => {
        setMessages((prev) => [...prev, { role: 'assistant', content: step.prompt }]);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // Show summary card when all steps complete
  useEffect(() => {
    if (!isComplete || !showSummary || showingSummary) return;
    if (assessmentSteps.length === 0) return;

    const timer = setTimeout(async () => {
      await triggerTyping();

      const totalQ = assessmentSteps.length;
      const correctCount = assessmentSteps.filter(
        (s) => answers[`${s.id}_correct`] === true,
      ).length;
      const pct = Math.round((correctCount / totalQ) * 100);

      // Group by chapter
      const chapterResults = new Map<string, { correct: number; total: number }>();
      for (const s of assessmentSteps) {
        const ch = s.chapter || 'General';
        const entry = chapterResults.get(ch) ?? { correct: 0, total: 0 };
        entry.total++;
        if (answers[`${s.id}_correct`] === true) entry.correct++;
        chapterResults.set(ch, entry);
      }
      const strong = [...chapterResults.entries()]
        .filter(([, v]) => v.correct === v.total)
        .map(([k]) => k);
      const focus = [...chapterResults.entries()]
        .filter(([, v]) => v.correct < v.total)
        .map(([k]) => k);

      const lines: string[] = [`You scored ${correctCount}/${totalQ} (${pct}%)`];
      if (strong.length > 0) lines.push(`✓ Strong: ${strong.join(', ')}`);
      if (focus.length > 0) lines.push(`→ Focus: ${focus.join(', ')}`);
      lines.push('');
      lines.push(pct >= 60 ? enc.summaryGood : enc.summaryWeak);

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: lines.join('\n'), variant: 'summary' },
      ]);
      setShowingSummary(true);
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete]);

  // ── Answer handlers ──

  const advance = useCallback((stepId: string, value: string | number, displayText: string) => {
    setAnswers((prev) => ({ ...prev, [stepId]: value }));
    setMessages((prev) => [...prev, { role: 'user', content: displayText }]);
    setTextDraft('');
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

  const handleMcqClick = useCallback(async (value: string, label: string) => {
    if (!step) return;
    const isCorrect = value === step.correctAnswer;

    // Store answer
    setAnswers((prev) => ({
      ...prev,
      [step.id]: value,
      [`${step.id}_correct`]: isCorrect,
    }));

    // Push user bubble with ✓/✗ prefix — permanently coloured
    const prefix = isCorrect ? '✓ ' : '✗ ';
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: prefix + label,
        variant: isCorrect ? 'correct' : 'incorrect',
      },
    ]);
    setTextDraft('');

    // Update streak
    let newStreak = streak;
    const wasWrong = lastWasWrong;
    if (isCorrect) {
      newStreak = streak + 1;
      setStreak(newStreak);
      setLastWasWrong(false);
    } else {
      newStreak = 0;
      setStreak(0);
      setLastWasWrong(true);
    }

    // Market test: log wrong answers silently, no correction shown
    // Show explanation only for correct answers
    if (isCorrect && step.explanation) {
      await triggerTyping();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '✓ ' + step.explanation, variant: 'explanation' },
      ]);
    }

    // Encouragement on streak milestones or bounce-back (correct answers only)
    if (isCorrect && newStreak >= 3 && newStreak % 3 === 0) {
      await new Promise((r) => setTimeout(r, 300));
      const msg = newStreak >= 6 ? enc.streak6 : enc.streak3;
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: msg, variant: 'encouragement' },
      ]);
    } else if (isCorrect && wasWrong) {
      await new Promise((r) => setTimeout(r, 300));
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: enc.bounceBack, variant: 'encouragement' },
      ]);
    }

    // Advance to next step
    setTimeout(() => setCurrentStep((s) => s + 1), 400);
  }, [step, streak, lastWasWrong, triggerTyping, enc]);

  const handleNpsClick = useCallback((n: number) => {
    if (!step) return;
    advance(step.id, n, `${n}/10`);
  }, [step, advance]);

  const handleTextSubmit = useCallback(() => {
    if (!step) return;
    const text = textDraft.trim();
    if (!text && !step.optional) return;
    if (!text && step.optional) {
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
          <div
            key={i}
            className={`cs-bubble cs-bubble--${msg.role}${
              msg.variant ? ` cs-bubble--${msg.variant}` : ''
            }`}
          >
            {msg.variant === 'summary' ? (
              <div className="cs-summary-card">
                {msg.content.split('\n').map((line, li) => (
                  <div key={li} className={
                    line.startsWith('You scored') ? 'cs-summary-score' :
                    line.startsWith('✓') ? 'cs-summary-strong' :
                    line.startsWith('→') ? 'cs-summary-focus' :
                    line === '' ? 'cs-summary-spacer' :
                    'cs-summary-message'
                  }>
                    {line}
                  </div>
                ))}
              </div>
            ) : (
              <div className="cs-bubble-content">{msg.content}</div>
            )}
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

            {step.type === 'mcq' && step.options && (
              <div className="cs-options">
                {step.options.map((opt) => (
                  <button
                    key={opt.value}
                    className="cs-option-btn"
                    onClick={() => handleMcqClick(opt.value, opt.label)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {step.type === 'true_false' && (
              <div className="cs-tf-buttons">
                <button
                  className="cs-tf-btn cs-tf-btn--true"
                  onClick={() => handleMcqClick('True', 'True')}
                >
                  True
                </button>
                <button
                  className="cs-tf-btn cs-tf-btn--false"
                  onClick={() => handleMcqClick('False', 'False')}
                >
                  False
                </button>
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

      </div>

      {/* Complete — submit button or summary CTA (outside scroll area so always visible) */}
      {isComplete && !typing && (
        <div className="cs-complete">
          {showSummary && showingSummary ? (
            <button
              className="cs-submit-btn cs-submit-btn--cta"
              onClick={() => onComplete(answers)}
              disabled={submitting}
            >
              {submitting ? 'Saving...' : 'Start Learning →'}
            </button>
          ) : !showSummary ? (
            <button
              className="cs-submit-btn"
              onClick={() => onComplete(answers)}
              disabled={submitting}
            >
              {submitting ? 'Saving...' : submitLabel}
            </button>
          ) : null}
        </div>
      )}

      {/* Progress dots — assessment questions only */}
      {showProgress && assessmentSteps.length > 0 && currentAssessmentIndex >= 0 && !isComplete && (
        <div className="cs-progress">
          <span className="cs-progress-text">
            Question {currentAssessmentIndex + 1} of {assessmentSteps.length}
          </span>
          <div className="cs-progress-dots">
            {assessmentSteps.map((s, i) => (
              <span
                key={s.id}
                className={`cs-progress-dot${
                  i < currentAssessmentIndex ? ' cs-progress-dot--done' :
                  i === currentAssessmentIndex ? ' cs-progress-dot--active' : ''
                }${
                  answers[`${s.id}_correct`] === true ? ' cs-progress-dot--correct' :
                  answers[`${s.id}_correct`] === false ? ' cs-progress-dot--incorrect' : ''
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
