"use client";

import { useState } from "react";
import { useTerminology } from "@/contexts/TerminologyContext";
import { Sparkles, Target, MessageCircle, Rocket } from "lucide-react";
import "./student-onboarding.css";

interface GoalData {
  id: string;
  name: string;
  type: string;
  progress: number;
  description: string | null;
}

interface StudentOnboardingProps {
  goals: GoalData[];
  teacherName: string | null;
  institutionName: string | null;
  institutionLogo: string | null;
  welcomeMessage: string | null;
  domain: string | null;
  /** Optional caller ID for admin-in-sim context */
  callerId?: string | null;
  onComplete: () => void;
}

export default function StudentOnboarding({
  goals,
  teacherName,
  institutionName,
  institutionLogo,
  welcomeMessage,
  domain,
  callerId,
  onComplete,
}: StudentOnboardingProps) {
  const { lower } = useTerminology();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [confirmedGoals, setConfirmedGoals] = useState<Set<string>>(
    new Set(goals.map((g) => g.id))
  );
  const [customGoal, setCustomGoal] = useState("");
  const [addingGoal, setAddingGoal] = useState(false);

  const handleAddGoal = async () => {
    if (!customGoal.trim()) return;
    setAddingGoal(true);
    try {
      const goalsUrl = callerId ? `/api/student/goals?callerId=${callerId}` : "/api/student/goals";
      const res = await fetch(goalsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: customGoal.trim(), type: "LEARN" }),
      });
      const data = await res.json();
      if (data.ok) {
        goals.push(data.goal);
        setConfirmedGoals((prev) => new Set([...prev, data.goal.id]));
        setCustomGoal("");
      }
    } finally {
      setAddingGoal(false);
    }
  };

  const handleFinish = async () => {
    localStorage.setItem("onboarding-seen", "true");
    // Mark onboarding complete in DB so journey-position advances
    const onboardingUrl = callerId
      ? `/api/student/onboarding?callerId=${callerId}`
      : "/api/student/onboarding";
    await fetch(onboardingUrl, { method: "POST" }).catch(() => {});
    onComplete();
  };

  const totalSteps = 4;

  return (
    <div className="so-container">
      {/* Step indicators */}
      <div className="so-progress-bar">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`so-progress-segment ${s <= step ? "so-progress-segment-active" : "so-progress-segment-inactive"}`}
          />
        ))}
      </div>

      {/* Step 1: Welcome */}
      {step === 1 && (
        <div className="so-step-card so-step-card-centered">
          {institutionLogo && (
            <img
              src={institutionLogo}
              alt={institutionName ?? ""}
              className="so-logo"
            />
          )}
          <h1 className="so-welcome-title">
            Welcome{institutionName ? ` to ${institutionName}` : ""}!
          </h1>
          {teacherName && (
            <p className="so-instructor-text">
              Your {lower("instructor")}: {teacherName}
            </p>
          )}
          {domain && (
            <p className="so-domain-text">
              {domain}
            </p>
          )}
          <p className="so-welcome-body">
            {welcomeMessage ??
              "You're about to start a personalised learning journey. Let's get you set up in just a few steps."}
          </p>
          <button
            onClick={() => setStep(2)}
            className="so-btn-primary-full"
          >
            Get Started
          </button>
        </div>
      )}

      {/* Step 2: Your Goals */}
      {step === 2 && (
        <div className="so-step-card">
          <div className="so-section-header">
            <Target size={20} className="so-icon-accent" />
            <h2 className="so-section-heading">
              Your Goals
            </h2>
          </div>

          {goals.length > 0 ? (
            <>
              <p className="so-hint-text">
                These goals have been set for your learning journey. You can confirm or adjust them.
              </p>
              <div className="so-goals-list">
                {goals.map((goal) => {
                  const selected = confirmedGoals.has(goal.id);
                  return (
                    <button
                      key={goal.id}
                      onClick={() => {
                        setConfirmedGoals((prev) => {
                          const next = new Set(prev);
                          if (next.has(goal.id)) next.delete(goal.id);
                          else next.add(goal.id);
                          return next;
                        });
                      }}
                      className={`so-goal-item ${selected ? "so-goal-item-selected" : "so-goal-item-unselected"}`}
                    >
                      <div className={`so-checkbox ${selected ? "so-checkbox-checked" : "so-checkbox-unchecked"}`}>
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path
                              d="M2.5 6L5 8.5L9.5 4"
                              stroke="white"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>
                      <div>
                        <div className="so-goal-name">
                          {goal.name}
                        </div>
                        {goal.description && (
                          <div className="so-goal-desc">
                            {goal.description}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="so-hint-text">
              What would you like to learn or achieve? Add a goal below.
            </p>
          )}

          {/* Add custom goal */}
          <div className="so-add-goal-row">
            <input
              type="text"
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddGoal()}
              placeholder="Add a personal goal..."
              className="so-add-goal-input"
            />
            <button
              onClick={handleAddGoal}
              disabled={!customGoal.trim() || addingGoal}
              className="so-add-goal-btn"
            >
              {addingGoal ? "..." : "Add"}
            </button>
          </div>

          <div className="so-nav-row">
            <button
              onClick={() => setStep(1)}
              className="so-btn-back"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="so-btn-continue"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: How It Works */}
      {step === 3 && (
        <div className="so-step-card">
          <div className="so-section-header">
            <MessageCircle size={20} className="so-icon-accent" />
            <h2 className="so-section-heading">
              How It Works
            </h2>
          </div>

          <p className="so-how-intro">
            You'll have voice conversations with an AI tutor that adapts to you.
          </p>

          <div className="so-features-list">
            {[
              {
                icon: Sparkles,
                title: "Personalised to you",
                desc: "The AI learns how you think and adapts its teaching style to match.",
              },
              {
                icon: Target,
                title: "Goal-driven",
                desc: "Each conversation works toward your learning goals and tracks progress.",
              },
              {
                icon: MessageCircle,
                title: "Natural conversation",
                desc: "Just talk naturally. The AI will guide the learning through dialogue.",
              },
            ].map((item) => (
              <div key={item.title} className="so-feature-card">
                <div className="so-feature-icon-box">
                  <item.icon size={18} className="so-icon-accent" />
                </div>
                <div>
                  <div className="so-feature-title">
                    {item.title}
                  </div>
                  <div className="so-feature-desc">
                    {item.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="so-nav-row">
            <button
              onClick={() => setStep(2)}
              className="so-btn-back"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              className="so-btn-continue"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Ready */}
      {step === 4 && (
        <div className="so-step-card so-step-card-centered">
          <div className="so-ready-icon-box">
            <Rocket size={32} className="so-icon-accent" />
          </div>
          <h2 className="so-ready-title">
            You're All Set!
          </h2>
          <p className="so-ready-desc">
            Start your first conversation and your AI tutor will take it from there.
          </p>

          <button
            onClick={handleFinish}
            className="so-btn-start"
          >
            Start Your First Conversation
          </button>
          <button
            onClick={async () => {
              localStorage.setItem("onboarding-seen", "true");
              const onboardingUrl = callerId
                ? `/api/student/onboarding?callerId=${callerId}`
                : "/api/student/onboarding";
              await fetch(onboardingUrl, { method: "POST" }).catch(() => {});
              onComplete();
            }}
            className="so-btn-skip"
          >
            Skip for now
          </button>
        </div>
      )}

      {/* Step counter */}
      <div className="so-step-counter">
        Step {step} of {totalSteps}
      </div>
    </div>
  );
}
