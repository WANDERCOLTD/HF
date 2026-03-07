"use client";

/**
 * ScaffoldPanel — right-column live preview of what's being built.
 *
 * Reads from the wizard data bag (getData) and renders a checklist
 * with status indicators. Labels adapt via terminology when available.
 */

import { Loader2, RotateCcw, ChevronRight, ExternalLink } from "lucide-react";

type ScaffoldStatus = "waiting" | "collecting" | "ready" | "resolved" | "building" | "done";

/* ── Per-item segment colours (light → dark blue) ─────── */
const ITEM_COLORS: Record<string, string> = {
  institution: "var(--gs-seg-1)",
  subject:     "var(--gs-seg-2)",
  course:      "var(--gs-seg-3)",
  content:     "var(--gs-seg-4)",
  welcome:     "var(--gs-seg-5)",
  lessons:     "var(--gs-seg-6)",
  personality: "var(--gs-seg-7)",
};

const WAITING_COLOR = "var(--border-default)";

/* ── Segmented Donut ──────────────────────────────────── */

interface DonutItem { status: ScaffoldStatus; label: string; color: string }

function ProgressDonut({ items }: { items: DonutItem[] }) {
  const size = 120;
  const strokeWidth = 10;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const GAP = 4; // px gap between segments
  const gapDeg = (GAP / circumference) * 360;
  const segDeg = (360 - items.length * gapDeg) / items.length;
  const segArc = (segDeg / 360) * circumference;

  const completedCount = items.filter(i => i.status === "ready" || i.status === "resolved" || i.status === "done").length;
  const pct = Math.round((completedCount / items.length) * 100);
  const allDone = completedCount === items.length;

  return (
    <div className="gs-donut-wrap">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="gs-donut-svg"
      >
        {items.map((item, i) => {
          const startAngle = -90 + i * (segDeg + gapDeg);
          const isAnimated = item.status === "collecting" || item.status === "building";

          return (
            <circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={item.status === "waiting" ? WAITING_COLOR : item.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segArc} ${circumference - segArc}`}
              className={`gs-donut-segment${isAnimated ? " gs-donut-segment--pulse" : ""}`}
              style={{ transform: `rotate(${startAngle}deg)`, transformOrigin: `${center}px ${center}px` }}
            />
          );
        })}
      </svg>
      <div className="gs-donut-center">
        {allDone
          ? <span className="gs-donut-check">&#10003;</span>
          : <span className="gs-donut-pct">{pct}%</span>
        }
      </div>
    </div>
  );
}

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
    subject: string;
    course: string;
    content: string;
    welcome: string;
    lessons: string;
    personality: string;
  };
  /** Called when user clicks "Start Afresh" — clears all wizard state */
  onReset?: () => void;
  /** Called when user clicks a scaffold item to review/amend it */
  onItemClick?: (itemKey: string) => void;
}

/** Map scaffold item keys to wizard phase IDs */
const ITEM_TO_PHASE: Record<string, string> = {
  institution: "institution",
  subject: "subject",
  course: "course",
  content: "content",
  welcome: "welcome",
  lessons: "welcome",      // lessons belong to "welcome" phase
  personality: "tune",
};

const DEFAULT_TERMS = {
  institution: "Organisation",
  subject: "Subject",
  course: "Course",
  content: "Content",
  welcome: "Welcome Message",
  lessons: "Lesson Plan",
  personality: "AI Tutor",
};

/** Map phase index to which scaffold items are being "collected".
 *  Must match WIZARD_PHASES order: institution(0), subject(1), course(2),
 *  content(3), welcome(4), tune(5), launch(6). */
const STEP_COLLECTING: Record<number, string[]> = {
  0: ["institution"],
  1: ["subject"],
  2: ["course"],
  3: ["content"],
  4: ["welcome", "lessons"],
  5: ["personality"],
  6: [], // launch
};

/**
 * Per-item entity key resolution map.
 * "resolved" (green) = the system has the internal ID/slug needed to wire downstream steps.
 * "ready" (blue) = user data accepted but entity not yet created.
 */
type ResolvedKeys = Record<string, boolean>;

function getItemStatus(
  key: string,
  hasValue: boolean,
  currentStepIndex: number,
  resolvedKeys: ResolvedKeys,
  launched: boolean,
): ScaffoldStatus {
  if (launched) return "done";
  if (resolvedKeys[key]) return "resolved";
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

function StatusDot({ status, color }: { status: ScaffoldStatus; color?: string }) {
  const isAnimated = status === "collecting" || status === "building";
  const showColor = color && status !== "waiting" && status !== "building";
  return (
    <span
      className={`gs-dot${isAnimated ? " gs-dot--pulse" : ""}`}
      data-status={status}
      style={showColor ? { background: color } : undefined}
    >
      {status === "building" && <Loader2 size={10} className="hf-spinner" />}
    </span>
  );
}

export function ScaffoldPanel({ getData, currentStepIndex, currentPhaseId, terms, onReset, onItemClick }: ScaffoldPanelProps) {
  const t = terms ?? DEFAULT_TERMS;
  const launched = !!getData<boolean>("launched");
  const isCommunity = getData<string>("defaultDomainKind") === "COMMUNITY";

  // Entity IDs — the internal keys that unlock downstream steps
  const hasDomainId = !!(getData<string>("draftDomainId") || getData<string>("existingDomainId"));
  const hasPlaybookId = !!getData<string>("draftPlaybookId");
  const hasSubjectIds = !!(getData<string[]>("packSubjectIds")?.length);

  // Per-item resolution: green when the system has the entity key it needs
  const resolvedKeys: ResolvedKeys = {
    institution: hasDomainId,
    subject: hasDomainId && !!getData<string>("subjectDiscipline"),
    course: hasPlaybookId,
    content: hasSubjectIds,
    welcome: hasPlaybookId && !!getData<string>("welcomeMessage"),
    lessons: hasPlaybookId && !!getData<number>("sessionCount"),
    personality: hasPlaybookId && !!getData<Record<string, number>>("behaviorTargets"),
  };

  const institutionName = getData<string>("institutionName") || getData<string>("existingInstitutionName");
  const courseName = getData<string>("courseName");
  const hasContent = !!(hasSubjectIds || getData<string>("sourceId"));
  const welcomeMsg = getData<string>("welcomeMessage");
  const sessionCount = getData<number>("sessionCount");
  const hasTune = !!getData<Record<string, number>>("behaviorTargets");
  const draftCallerId = getData<string>("draftCallerId");
  const canTryCall = !!draftCallerId && (hasDomainId || launched);

  // Detail chips for each section
  const typeSlug = getData<string>("typeSlug");
  const subjectDiscipline = getData<string>("subjectDiscipline");
  const interactionPattern = getData<string>("interactionPattern");
  const teachingMode = getData<string>("teachingMode");
  const teachingProfile = getData<string>("teachingProfile");
  const durationMins = getData<string>("durationMins");
  const planEmphasis = getData<string>("planEmphasis");
  const lessonPlanModel = getData<string>("lessonPlanModel");

  const institutionChips: string[] = [];
  if (typeSlug) institutionChips.push(capitalize(typeSlug));

  const courseChips: string[] = [];
  if (teachingProfile) courseChips.push(teachingProfile);
  if (interactionPattern) courseChips.push(capitalize(interactionPattern));
  if (teachingMode) courseChips.push(capitalize(teachingMode));

  const lessonChips: string[] = [];
  if (durationMins) lessonChips.push(`${durationMins} min`);
  if (planEmphasis) lessonChips.push(capitalize(planEmphasis));

  const tuneChips: string[] = [];
  if (lessonPlanModel) tuneChips.push(LESSON_MODEL_LABELS[lessonPlanModel] || capitalize(lessonPlanModel));

  // Extraction progress — live (during extraction) or final (after completion)
  const extractionProgress = getData<{ assertions: number; questions: number; vocabulary: number; images: number }>("extractionProgress");
  const extractionTotals = getData<{ assertions: number; questions: number; vocabulary: number; images: number }>("extractionTotals");
  const isExtracting = !!extractionProgress;
  const contentTotals = isExtracting ? extractionProgress : extractionTotals;

  const contentChips: string[] = [];
  if (contentTotals) {
    if (contentTotals.assertions > 0) contentChips.push(`${contentTotals.assertions} teaching points`);
    if (contentTotals.questions > 0) contentChips.push(`${contentTotals.questions} questions`);
    if (contentTotals.vocabulary > 0) contentChips.push(`${contentTotals.vocabulary} vocabulary`);
    if (contentTotals.images > 0) contentChips.push(`${contentTotals.images} images`);
  }

  const sourceCount = getData<number>("sourceCount");

  const contentStatus = isExtracting
    ? "building" as ScaffoldStatus
    : getItemStatus("content", hasContent, currentStepIndex, resolvedKeys, launched);
  const contentValue = isExtracting
    ? "Extracting..."
    : hasContent
      ? sourceCount ? `${sourceCount} doc${sourceCount !== 1 ? "s" : ""} uploaded` : "Uploaded"
      : undefined;

  const items: ScaffoldItem[] = [
    {
      key: "institution",
      label: t.institution,
      value: institutionName || undefined,
      chips: institutionChips.length ? institutionChips : undefined,
      status: getItemStatus("institution", !!institutionName, currentStepIndex, resolvedKeys, launched),
    },
    // Subject row hidden for communities — they don't have structured subjects
    ...(!isCommunity ? [{
      key: "subject",
      label: t.subject,
      value: subjectDiscipline || undefined,
      status: getItemStatus("subject", !!subjectDiscipline, currentStepIndex, resolvedKeys, launched),
    }] : []),
    {
      key: "course",
      label: isCommunity ? "Community" : t.course,
      value: courseName || undefined,
      chips: courseChips.length ? courseChips : undefined,
      status: getItemStatus("course", !!courseName, currentStepIndex, resolvedKeys, launched),
    },
    // Content row hidden for communities — they don't upload teaching materials
    ...(!isCommunity ? [{
      key: "content",
      label: t.content,
      value: contentValue,
      chips: contentChips.length ? contentChips : undefined,
      status: contentStatus,
    }] : []),
  ];

  const extraItems: ScaffoldItem[] = [
    {
      key: "welcome",
      label: t.welcome,
      value: welcomeMsg ? welcomeMsg.slice(0, 30) + (welcomeMsg.length > 30 ? "…" : "") : undefined,
      status: getItemStatus("welcome", !!welcomeMsg, currentStepIndex, resolvedKeys, launched),
    },
    // Lessons row hidden for communities — no structured session plan
    ...(!isCommunity ? [{
      key: "lessons",
      label: t.lessons,
      value: sessionCount ? `${sessionCount} sessions` : undefined,
      chips: lessonChips.length ? lessonChips : undefined,
      status: getItemStatus("lessons", !!sessionCount, currentStepIndex, resolvedKeys, launched),
    }] : []),
    {
      key: "personality",
      label: isCommunity ? "AI Companion" : t.personality,
      value: hasTune ? "Configured" : undefined,
      chips: tuneChips.length ? tuneChips : undefined,
      status: getItemStatus("personality", hasTune, currentStepIndex, resolvedKeys, launched),
    },
  ];

  // Readiness: count ready/draft/done items out of total
  const allItems = [...items, ...extraItems];
  const completedCount = allItems.filter((i) => i.status === "ready" || i.status === "resolved" || i.status === "done").length;

  const readinessHint = (() => {
    if (launched) return "Ready to go!";
    if (canTryCall) return "Enough to try a call";
    if (completedCount >= 3) return "Almost there — finish setup to try a call";
    if (completedCount >= 1) return `Need ${t.content.toLowerCase()} to try a call`;
    return "Getting started...";
  })();

  return (
    <div className="gs-panel">
      <div className="gs-scaffold">
        {launched ? (
          <>
            <div className="gs-scaffold-title gs-scaffold-title--done">
              {courseName || (isCommunity ? "Your Community" : `Your ${t.course}`)} is ready
            </div>
            <a
              href={hasPlaybookId ? `/x/courses/${getData<string>("draftPlaybookId")}` : "/x/courses"}
              className="gs-scaffold-course-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              {hasPlaybookId ? "View full course details" : "View your courses"}
              <ExternalLink size={12} />
            </a>
          </>
        ) : (
          <>
            <div className="gs-scaffold-title">Building Your {isCommunity ? "Community" : t.course}</div>
            {onItemClick && (
              <div className="gs-scaffold-hint">Click any section to review or change it</div>
            )}
          </>
        )}

        <ul className="gs-scaffold-list">
          {items.map((item) => (
            <li
              key={item.key}
              className={
                "gs-scaffold-item" +
                (currentPhaseId && ITEM_TO_PHASE[item.key] === currentPhaseId ? " gs-scaffold-item--active" : "") +
                (onItemClick ? " gs-scaffold-item--clickable" : "")
              }
              onClick={onItemClick ? () => onItemClick(item.key) : undefined}
              role={onItemClick ? "button" : undefined}
              tabIndex={onItemClick ? 0 : undefined}
              onKeyDown={onItemClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onItemClick(item.key); } } : undefined}
            >
              <StatusDot status={item.status} color={ITEM_COLORS[item.key]} />
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
              {onItemClick && <ChevronRight size={14} className="gs-scaffold-item-chevron" />}
            </li>
          ))}
        </ul>

        <ul className="gs-scaffold-list">
          {extraItems.map((item) => (
            <li
              key={item.key}
              className={
                "gs-scaffold-item" +
                (currentPhaseId && ITEM_TO_PHASE[item.key] === currentPhaseId ? " gs-scaffold-item--active" : "") +
                (onItemClick ? " gs-scaffold-item--clickable" : "")
              }
              onClick={onItemClick ? () => onItemClick(item.key) : undefined}
              role={onItemClick ? "button" : undefined}
              tabIndex={onItemClick ? 0 : undefined}
              onKeyDown={onItemClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onItemClick(item.key); } } : undefined}
            >
              <StatusDot status={item.status} color={ITEM_COLORS[item.key]} />
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
              {onItemClick && <ChevronRight size={14} className="gs-scaffold-item-chevron" />}
            </li>
          ))}
        </ul>

        <div className="gs-readiness">
          <ProgressDonut items={allItems.map(i => ({ status: i.status, label: i.label, color: ITEM_COLORS[i.key] ?? "var(--accent-primary)" }))} />
          <div className="gs-readiness-hint">{readinessHint}</div>
        </div>

        <div className="gs-try-call">
          {canTryCall ? (
            <a
              href={`/x/sim/${draftCallerId}?${new URLSearchParams({ ...(getData<string>("draftPlaybookId") ? { playbookId: getData<string>("draftPlaybookId")! } : {}), ...(getData<string>("draftDomainId") || getData<string>("existingDomainId") ? { domainId: (getData<string>("draftDomainId") || getData<string>("existingDomainId"))! } : {}) }).toString()}`}
              className="gs-sim-btn gs-sim-btn-ready"
              target="_blank"
              rel="noopener noreferrer"
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

        {onReset && (
          <button type="button" className="gs-reset-btn" onClick={onReset}>
            <RotateCcw size={12} />
            Start Afresh
          </button>
        )}
      </div>
    </div>
  );
}
