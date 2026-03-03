"use client";

/**
 * ScaffoldPanel — right-column live preview of what's being built.
 *
 * Reads from the wizard data bag (getData) and renders a checklist
 * with status indicators. Labels adapt via terminology when available.
 */

import { Check, Loader2, Circle, Disc } from "lucide-react";

type ScaffoldStatus = "waiting" | "collecting" | "ready" | "building" | "draft" | "done";

interface ScaffoldItem {
  key: string;
  label: string;
  value?: string;
  chips?: string[];
  status: ScaffoldStatus;
}

interface ScaffoldPanelProps {
  getData: <T = unknown>(key: string) => T | undefined;
  currentStepIndex: number;
  /** Current wizard phase ID for highlighting (e.g. "institution", "course") */
  currentPhaseId?: string;
  /** Terminology-resolved labels (or generic defaults) */
  terms?: {
    institution: string;
    course: string;
    content: string;
    welcome: string;
    lessons: string;
    personality: string;
  };
}

/** Map scaffold item keys to wizard phase IDs */
const ITEM_TO_PHASE: Record<string, string> = {
  institution: "institution",
  course: "course",
  content: "content",
  welcome: "welcome",
  lessons: "welcome",      // lessons belong to "welcome" phase
  personality: "tune",
};

const DEFAULT_TERMS = {
  institution: "Organisation",
  course: "Course",
  content: "Content",
  welcome: "Welcome Message",
  lessons: "Lesson Plan",
  personality: "AI Tutor",
};

/** Map step index to which scaffold items are being "collected" */
const STEP_COLLECTING: Record<number, string[]> = {
  0: ["institution"],
  1: ["course"],
  2: ["content"],
  3: [], // checkpoint
  4: ["welcome", "lessons"],
  5: ["personality"],
  6: [], // launch
};

function getItemStatus(
  key: string,
  hasValue: boolean,
  currentStepIndex: number,
  draftCreated: boolean,
  launched: boolean,
): ScaffoldStatus {
  if (launched) return "done";
  if (draftCreated && ["institution", "course", "content"].includes(key)) return "draft";
  if (hasValue && !STEP_COLLECTING[currentStepIndex]?.includes(key)) return "ready";
  if (STEP_COLLECTING[currentStepIndex]?.includes(key)) return "collecting";
  return hasValue ? "ready" : "waiting";
}

/** Capitalize first letter */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const LESSON_MODEL_LABELS: Record<string, string> = {
  direct: "Direct Instruction",
  "5e": "5E Model",
  spiral: "Spiral",
  mastery: "Mastery",
  project: "Project-Based",
};

function StatusIcon({ status }: { status: ScaffoldStatus }) {
  switch (status) {
    case "done":
      return <div className="gs-scaffold-icon" data-status="done"><Check size={12} /></div>;
    case "draft":
      return <div className="gs-scaffold-icon" data-status="draft"><Check size={12} /></div>;
    case "building":
      return <div className="gs-scaffold-icon" data-status="building"><Loader2 size={12} className="hf-spinner" /></div>;
    case "ready":
      return <div className="gs-scaffold-icon" data-status="ready"><Check size={12} /></div>;
    case "collecting":
      return <div className="gs-scaffold-icon" data-status="collecting"><Disc size={10} /></div>;
    default:
      return <div className="gs-scaffold-icon" data-status="waiting"><Circle size={10} /></div>;
  }
}

export function ScaffoldPanel({ getData, currentStepIndex, currentPhaseId, terms }: ScaffoldPanelProps) {
  const t = terms ?? DEFAULT_TERMS;
  const draftCreated = !!getData<string>("draftDomainId");
  const launched = !!getData<boolean>("launched");
  const isCommunity = getData<string>("defaultDomainKind") === "COMMUNITY";

  const institutionName = getData<string>("institutionName") || getData<string>("existingInstitutionName");
  const courseName = getData<string>("courseName");
  const hasContent = !!(getData<string[]>("packSubjectIds")?.length || getData<string>("sourceId"));
  const welcomeMsg = getData<string>("welcomeMessage");
  const sessionCount = getData<number>("sessionCount");
  const hasTune = !!getData<Record<string, number>>("behaviorTargets");
  const canTryCall = draftCreated || launched;

  // Detail chips for each section
  const typeSlug = getData<string>("typeSlug");
  const subjectDiscipline = getData<string>("subjectDiscipline");
  const interactionPattern = getData<string>("interactionPattern");
  const teachingMode = getData<string>("teachingMode");
  const durationMins = getData<string>("durationMins");
  const planEmphasis = getData<string>("planEmphasis");
  const lessonPlanModel = getData<string>("lessonPlanModel");

  const institutionChips: string[] = [];
  if (typeSlug) institutionChips.push(capitalize(typeSlug));

  const courseChips: string[] = [];
  if (subjectDiscipline) courseChips.push(subjectDiscipline);
  if (interactionPattern) courseChips.push(capitalize(interactionPattern));
  if (teachingMode) courseChips.push(capitalize(teachingMode));

  const lessonChips: string[] = [];
  if (durationMins) lessonChips.push(`${durationMins} min`);
  if (planEmphasis) lessonChips.push(capitalize(planEmphasis));

  const tuneChips: string[] = [];
  if (lessonPlanModel) tuneChips.push(LESSON_MODEL_LABELS[lessonPlanModel] || capitalize(lessonPlanModel));

  const items: ScaffoldItem[] = [
    {
      key: "institution",
      label: t.institution,
      value: institutionName || undefined,
      chips: institutionChips.length ? institutionChips : undefined,
      status: getItemStatus("institution", !!institutionName, currentStepIndex, draftCreated, launched),
    },
    {
      key: "course",
      label: isCommunity ? "Community" : t.course,
      value: courseName || undefined,
      chips: courseChips.length ? courseChips : undefined,
      status: getItemStatus("course", !!courseName, currentStepIndex, draftCreated, launched),
    },
    // Content row hidden for communities — they don't upload teaching materials
    ...(!isCommunity ? [{
      key: "content",
      label: t.content,
      value: hasContent ? "Uploaded" : undefined,
      status: getItemStatus("content", hasContent, currentStepIndex, draftCreated, launched),
    }] : []),
  ];

  const extraItems: ScaffoldItem[] = [
    {
      key: "welcome",
      label: t.welcome,
      value: welcomeMsg ? welcomeMsg.slice(0, 30) + (welcomeMsg.length > 30 ? "…" : "") : undefined,
      status: getItemStatus("welcome", !!welcomeMsg, currentStepIndex, draftCreated, launched),
    },
    // Lessons row hidden for communities — no structured session plan
    ...(!isCommunity ? [{
      key: "lessons",
      label: t.lessons,
      value: sessionCount ? `${sessionCount} sessions` : undefined,
      chips: lessonChips.length ? lessonChips : undefined,
      status: getItemStatus("lessons", !!sessionCount, currentStepIndex, draftCreated, launched),
    }] : []),
    {
      key: "personality",
      label: isCommunity ? "AI Companion" : t.personality,
      value: hasTune ? "Configured" : undefined,
      chips: tuneChips.length ? tuneChips : undefined,
      status: getItemStatus("personality", hasTune, currentStepIndex, draftCreated, launched),
    },
  ];

  // Readiness: count ready/draft/done items out of total
  const allItems = [...items, ...extraItems];
  const completedCount = allItems.filter((i) => i.status !== "waiting" && i.status !== "collecting").length;
  const readinessPct = Math.round((completedCount / allItems.length) * 100);

  const readinessHint = (() => {
    if (launched) return "Ready to go!";
    if (canTryCall) return "Enough to try a call";
    if (completedCount >= 3) return "Enough to try a call — hit Create below";
    if (completedCount >= 1) return `Need ${t.content.toLowerCase()} to try a call`;
    return "Getting started...";
  })();

  return (
    <div className="gs-panel">
      <div className="gs-scaffold">
        <div className="gs-scaffold-title">Building Your {isCommunity ? "Community" : t.course}</div>

        <ul className="gs-scaffold-list">
          {items.map((item) => (
            <li key={item.key} className={`gs-scaffold-item${currentPhaseId && ITEM_TO_PHASE[item.key] === currentPhaseId ? " gs-scaffold-item--active" : ""}`}>
              <StatusIcon status={item.status} />
              <div className="gs-scaffold-item-content">
                <div className="gs-scaffold-item-row">
                  <span className="gs-scaffold-label">{item.label}</span>
                  {item.value && <span className="gs-scaffold-value">{item.value}</span>}
                </div>
                {item.chips && item.chips.length > 0 && (
                  <div className="gs-scaffold-chips">
                    {item.chips.map((chip) => (
                      <span key={chip} className="gs-scaffold-chip">{chip}</span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <ul className="gs-scaffold-list">
          {extraItems.map((item) => (
            <li key={item.key} className={`gs-scaffold-item${currentPhaseId && ITEM_TO_PHASE[item.key] === currentPhaseId ? " gs-scaffold-item--active" : ""}`}>
              <StatusIcon status={item.status} />
              <div className="gs-scaffold-item-content">
                <div className="gs-scaffold-item-row">
                  <span className="gs-scaffold-label">{item.label}</span>
                  {item.value && <span className="gs-scaffold-value">{item.value}</span>}
                </div>
                {item.chips && item.chips.length > 0 && (
                  <div className="gs-scaffold-chips">
                    {item.chips.map((chip) => (
                      <span key={chip} className="gs-scaffold-chip">{chip}</span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="gs-readiness">
          <div className="gs-readiness-header">
            <span className="gs-readiness-label">Readiness</span>
            <span className="gs-readiness-pct">{readinessPct}%</span>
          </div>
          <div className="gs-readiness-bar">
            <div className="gs-readiness-fill" style={{ width: `${readinessPct}%` }} />
          </div>
          <div className="gs-readiness-hint">{readinessHint}</div>
        </div>

        <div className="gs-try-call">
          {canTryCall ? (
            <a
              href={`/x/sim/${getData<string>("draftCallerId") || ""}`}
              className="gs-sim-btn gs-sim-btn-ready"
            >
              Try a Sim Call
            </a>
          ) : completedCount >= 3 ? (
            <span className="gs-sim-btn gs-sim-btn-disabled" title={isCommunity ? "Create your community first" : "Create your course first using the button below"}>
              {isCommunity ? "Create community to try" : "Create course to try"}
            </span>
          ) : (
            <span className="gs-sim-btn gs-sim-btn-disabled">
              Try a Sim Call
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
