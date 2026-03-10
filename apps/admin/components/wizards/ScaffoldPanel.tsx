"use client";

/**
 * ScaffoldPanel — "Course Blueprint" live preview.
 *
 * Reads from the wizard data bag and renders a course card that
 * progressively crystallises as the conversation fills in fields.
 * Sections appear when they have data. Click any section to amend.
 *
 * Design: artifact-first (show the course, not a checklist).
 */

import { Loader2, RotateCcw, ExternalLink, Pencil } from "lucide-react";
import "./scaffold-panel.css";

type ScaffoldStatus = "waiting" | "collecting" | "ready" | "resolved" | "building" | "done";

/* ── Label lookups ──────────────────────────────────── */

const AUDIENCE_LABELS: Record<string, string> = {
  primary: "Primary (5-11)",
  secondary: "Secondary (11-16)",
  "sixth-form": "Sixth Form (16-19)",
  "higher-ed": "Higher Ed",
  "adult-professional": "Professional",
  "adult-casual": "Adult Learner",
  mixed: "Mixed",
};

const ASSESSMENT_LABELS: Record<string, string> = {
  formal: "Formal assessment",
  light: "Light check-ins",
  none: "No assessment",
};

const LESSON_MODEL_LABELS: Record<string, string> = {
  direct: "Direct Instruction",
  "5e": "5E Model",
  spiral: "Spiral",
  mastery: "Mastery",
  project: "Project-Based",
};

const PATTERN_LABELS: Record<string, string> = {
  socratic: "Socratic",
  "direct-instruction": "Direct Instruction",
  "practice-coach": "Practice Coach",
  "conversational-guide": "Conversational Guide",
  "drill-sergeant": "Drill & Practice",
};

const EMPHASIS_LABELS: Record<string, string> = {
  breadth: "Breadth-first",
  balanced: "Balanced",
  depth: "Depth-first",
};

/* ── Readiness dots ─────────────────────────────────── */

interface ReadinessDot { filled: boolean; active: boolean; processing?: boolean; label: string }

function ReadinessBar({ dots }: { dots: ReadinessDot[] }) {
  const filledCount = dots.filter(d => d.filled).length;
  const missing = dots.filter(d => !d.filled && !d.processing).map(d => d.label);
  const processing = dots.filter(d => d.processing).map(d => d.label);
  const tooltipText = processing.length > 0
    ? `Processing: ${processing.join(", ")}` + (missing.length > 0 ? ` · Needs: ${missing.join(", ")}` : "")
    : missing.length > 0
      ? `Needs: ${missing.join(", ")}`
      : "All sections complete";
  return (
    <div className="gs-readiness" title={tooltipText}>
      <div className="gs-readiness-dots">
        {dots.map((d, i) => (
          <span
            key={i}
            className={
              "gs-readiness-dot" +
              (d.processing ? " gs-readiness-dot--processing" : d.filled ? " gs-readiness-dot--filled" : "") +
              (d.active ? " gs-readiness-dot--active" : "")
            }
            title={`${d.label}: ${d.processing ? "processing…" : d.filled ? "✓" : "needed"}`}
          />
        ))}
      </div>
      <span className="gs-readiness-count">{filledCount}/{dots.length}</span>
    </div>
  );
}

/* ── Blueprint section (clickable row) ──────────────── */

interface BlueprintSectionProps {
  visible: boolean;
  active: boolean;
  clickable: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  sectionKey?: string;
}

function BlueprintSection({ visible, active, clickable, onClick, children, sectionKey }: BlueprintSectionProps) {
  if (!visible) return null;
  return (
    <div
      className={
        "gs-bp-section" +
        (active ? " gs-bp-section--active" : "") +
        (clickable ? " gs-bp-section--clickable" : "")
      }
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      data-section={sectionKey}
    >
      {children}
      {clickable && <Pencil size={12} className="gs-bp-edit-icon" />}
    </div>
  );
}

/* ── Default indicator ──────────────────────────────── */

function DefaultTag() {
  return <span className="gs-bp-default" title="System default — click to customise">default</span>;
}

/* ── Status phase maps ──────────────────────────────── */

const ITEM_TO_PHASE: Record<string, string> = {
  institution: "institution",
  subject: "subject",
  course: "course",
  content: "content",
  welcome: "welcome",
  lessons: "welcome",
  personality: "tune",
};

const STEP_COLLECTING: Record<number, string[]> = {
  0: ["institution"],
  1: ["subject"],
  2: ["course"],
  3: ["content"],
  4: ["welcome", "lessons"],
  5: ["personality"],
  6: [],
};

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── Props ──────────────────────────────────────────── */

interface ScaffoldPanelProps {
  getData: <T = unknown>(key: string) => T | undefined;
  currentStepIndex?: number;
  currentPhaseId?: string;
  terms?: {
    institution: string;
    subject: string;
    course: string;
    content: string;
    welcome: string;
    lessons: string;
    personality: string;
  };
  onReset?: () => void;
  onItemClick?: (itemKey: string) => void;
}

const DEFAULT_TERMS = {
  institution: "Organisation",
  subject: "Subject",
  course: "Course",
  content: "Content",
  welcome: "Welcome Message",
  lessons: "Lesson Plan",
  personality: "AI Tutor",
};

/* ── Main component ─────────────────────────────────── */

export function ScaffoldPanel({ getData, currentStepIndex = -1, currentPhaseId, terms, onReset, onItemClick }: ScaffoldPanelProps) {
  const t = terms ?? DEFAULT_TERMS;
  const launched = !!getData<boolean>("launched");
  const isCommunity = getData<string>("defaultDomainKind") === "COMMUNITY";

  // Entity IDs
  const hasDomainId = !!(getData<string>("draftDomainId") || getData<string>("existingDomainId"));
  const hasPlaybookId = !!getData<string>("draftPlaybookId");
  const hasSubjectIds = !!(getData<string[]>("packSubjectIds")?.length);

  const resolvedKeys: ResolvedKeys = {
    institution: hasDomainId,
    subject: hasDomainId && !!getData<string>("subjectDiscipline"),
    course: hasPlaybookId,
    content: hasSubjectIds,
    welcome: hasPlaybookId && !!getData<string>("welcomeMessage"),
    lessons: hasPlaybookId && !!getData<number>("sessionCount"),
    personality: hasPlaybookId && !!getData<Record<string, number>>("behaviorTargets"),
  };

  // Data reads
  const institutionName = getData<string>("institutionName") || getData<string>("existingInstitutionName");
  const typeSlug = getData<string>("typeSlug");
  const courseName = getData<string>("courseName");
  const subjectDiscipline = getData<string>("subjectDiscipline");
  const interactionPattern = getData<string>("interactionPattern");
  const teachingMode = getData<string>("teachingMode");
  const audience = getData<string>("audience");
  const learningOutcomes = getData<string[]>("learningOutcomes");
  const hasContent = !!(hasSubjectIds || getData<string>("sourceId"));
  const welcomeMsg = getData<string>("welcomeMessage");
  const sessionCount = getData<number>("sessionCount");
  const durationMins = getData<string>("durationMins");
  const planEmphasis = getData<string>("planEmphasis");
  const assessments = getData<string>("assessments");
  const lessonPlanModel = getData<string>("lessonPlanModel");
  const hasTune = !!getData<Record<string, number>>("behaviorTargets");
  const draftCallerId = getData<string>("draftCallerId");
  const canTryCall = !!draftCallerId && (hasDomainId || launched);
  const userSetFields = getData<string[]>("userSetFields") || [];

  // Extraction progress
  const extractionProgress = getData<{ assertions: number; questions: number; vocabulary: number; images: number }>("extractionProgress");
  const extractionTotals = getData<{ assertions: number; questions: number; vocabulary: number; images: number }>("extractionTotals");
  const isExtracting = !!extractionProgress;
  const contentTotals = isExtracting ? extractionProgress : extractionTotals;
  const sourceCount = getData<number>("sourceCount");

  // Default detection helper
  const isDefault = (field: string) => !userSetFields.includes(field);

  // Phase active detection
  const isPhaseActive = (key: string) =>
    currentPhaseId ? ITEM_TO_PHASE[key] === currentPhaseId : false;

  const clickable = !!onItemClick;
  const click = (key: string) => onItemClick?.(key);

  // Readiness dots — one per section
  const sections = isCommunity
    ? ["institution", "course", "welcome", "personality"]
    : ["institution", "subject", "course", "content", "welcome", "lessons", "personality"];

  const sectionHasValue: Record<string, boolean> = {
    institution: !!institutionName,
    subject: !!subjectDiscipline,
    course: !!courseName,
    content: hasContent,
    welcome: !!welcomeMsg,
    lessons: !!sessionCount,
    personality: hasTune,
  };

  const SECTION_LABELS: Record<string, string> = {
    institution: t.institution,
    subject: t.subject,
    course: t.course,
    content: t.content,
    welcome: t.welcome,
    lessons: t.lessons,
    personality: t.personality,
  };

  const dots = sections.map(s => ({
    filled: getItemStatus(s, sectionHasValue[s], currentStepIndex, resolvedKeys, launched) !== "waiting",
    active: isPhaseActive(s),
    processing: s === "content" && isExtracting,
    label: SECTION_LABELS[s] || capitalize(s),
  }));

  const completedCount = dots.filter(d => d.filled).length;

  // Has anything at all been filled?
  const hasAnyData = !!institutionName || !!courseName;

  // Content section details
  const contentParts: string[] = [];
  if (contentTotals) {
    if (contentTotals.assertions > 0) contentParts.push(`${contentTotals.assertions} teaching pts`);
    if (contentTotals.questions > 0) contentParts.push(`${contentTotals.questions} questions`);
    if (contentTotals.vocabulary > 0) contentParts.push(`${contentTotals.vocabulary} vocab`);
    if (contentTotals.images > 0) contentParts.push(`${contentTotals.images} images`);
  }

  return (
    <div className="gs-panel">
      <div className="gs-scaffold">

        {/* ── Header ──────────────────────────────────── */}
        {launched ? (
          <div className="gs-bp-header gs-bp-header--done">
            <div className="gs-bp-title">{courseName || (isCommunity ? "Your Community" : "Your Course")}</div>
            <div className="gs-bp-subtitle gs-bp-subtitle--done">Ready to go</div>
            <a
              href={hasPlaybookId ? `/x/courses/${getData<string>("draftPlaybookId")}` : "/x/courses"}
              className="gs-bp-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              View course details <ExternalLink size={11} />
            </a>
          </div>
        ) : (
          <div className="gs-bp-header">
            <div className="gs-bp-title">
              {courseName || (hasAnyData ? "Your Course" : "Course Blueprint")}
            </div>
            {institutionName && !courseName && (
              <div className="gs-bp-subtitle">{institutionName}</div>
            )}
            {!hasAnyData && (
              <div className="gs-bp-subtitle">Start chatting to build your course</div>
            )}
          </div>
        )}

        {/* ── Blueprint body ─────────────────────────── */}
        <div className="gs-bp-body">

          {/* Institution + type */}
          <BlueprintSection
            visible={!!institutionName}
            active={isPhaseActive("institution")}
            clickable={clickable}
            onClick={() => click("institution")}
            sectionKey="institution"
          >
            <div className="gs-bp-org">
              <span className="gs-bp-org-name">{institutionName}</span>
              {typeSlug && <span className="gs-bp-tag">{capitalize(typeSlug)}</span>}
            </div>
          </BlueprintSection>

          {/* Course identity — name, subject, approach */}
          <BlueprintSection
            visible={!!courseName}
            active={isPhaseActive("course")}
            clickable={clickable}
            onClick={() => click("course")}
            sectionKey="course"
          >
            {courseName && <div className="gs-bp-course-name">{courseName}</div>}
            <div className="gs-bp-meta">
              {subjectDiscipline && <span className="gs-bp-meta-item">{subjectDiscipline}</span>}
              {interactionPattern && (
                <span className="gs-bp-meta-item">
                  {PATTERN_LABELS[interactionPattern] || capitalize(interactionPattern)}
                </span>
              )}
              {audience && audience !== "mixed" && (
                <span className="gs-bp-meta-item">
                  {AUDIENCE_LABELS[audience] || capitalize(audience)}
                  {isDefault("audience") && <DefaultTag />}
                </span>
              )}
              {teachingMode && (
                <span className="gs-bp-meta-item">
                  {capitalize(teachingMode)}
                </span>
              )}
            </div>
            {learningOutcomes && learningOutcomes.length > 0 && (
              <div className="gs-bp-outcomes">
                {learningOutcomes.length} learning outcome{learningOutcomes.length !== 1 ? "s" : ""}
              </div>
            )}
          </BlueprintSection>

          {/* Content upload */}
          {!isCommunity && (hasContent || isExtracting) && (
            <BlueprintSection
              visible
              active={isPhaseActive("content")}
              clickable={clickable}
              onClick={() => click("content")}
              sectionKey="content"
            >
              <div className="gs-bp-content">
                {isExtracting ? (
                  <span className="gs-bp-extracting">
                    <Loader2 size={13} className="hf-spinner" />
                    Extracting content...
                  </span>
                ) : (
                  <>
                    {sourceCount
                      ? <span className="gs-bp-content-label">{sourceCount} document{sourceCount !== 1 ? "s" : ""}</span>
                      : <span className="gs-bp-content-label">Content uploaded</span>
                    }
                    {contentParts.length > 0 && (
                      <span className="gs-bp-content-detail">{contentParts.join(" · ")}</span>
                    )}
                  </>
                )}
              </div>
            </BlueprintSection>
          )}

          {/* Session structure */}
          {!isCommunity && (sessionCount || durationMins || planEmphasis || assessments || lessonPlanModel) && (
            <BlueprintSection
              visible
              active={isPhaseActive("lessons")}
              clickable={clickable}
              onClick={() => click("lessons")}
              sectionKey="lessons"
            >
              <div className="gs-bp-sessions">
                {sessionCount && (
                  <span className="gs-bp-sessions-count">{sessionCount} sessions</span>
                )}
                {durationMins && (
                  <span className="gs-bp-meta-item">
                    {durationMins} min{isDefault("durationMins") && <DefaultTag />}
                  </span>
                )}
              </div>
              <div className="gs-bp-meta">
                {planEmphasis && (
                  <span className="gs-bp-meta-item">
                    {EMPHASIS_LABELS[planEmphasis] || capitalize(planEmphasis)}
                    {isDefault("planEmphasis") && <DefaultTag />}
                  </span>
                )}
                {assessments && (
                  <span className="gs-bp-meta-item">
                    {ASSESSMENT_LABELS[assessments] || capitalize(assessments)}
                    {isDefault("assessments") && <DefaultTag />}
                  </span>
                )}
                {lessonPlanModel && (
                  <span className="gs-bp-meta-item">
                    {LESSON_MODEL_LABELS[lessonPlanModel] || capitalize(lessonPlanModel)}
                    {isDefault("lessonPlanModel") && <DefaultTag />}
                  </span>
                )}
              </div>
            </BlueprintSection>
          )}

          {/* Welcome message */}
          {welcomeMsg && (
            <BlueprintSection
              visible
              active={isPhaseActive("welcome")}
              clickable={clickable}
              onClick={() => click("welcome")}
              sectionKey="welcome"
            >
              <div className="gs-bp-welcome">
                <span className="gs-bp-welcome-label">First call greeting</span>
                <span className="gs-bp-welcome-text">
                  &ldquo;{welcomeMsg.length > 60 ? welcomeMsg.slice(0, 60) + "..." : welcomeMsg}&rdquo;
                </span>
              </div>
            </BlueprintSection>
          )}

          {/* Personality */}
          {hasTune && (
            <BlueprintSection
              visible
              active={isPhaseActive("personality")}
              clickable={clickable}
              onClick={() => click("personality")}
              sectionKey="personality"
            >
              <div className="gs-bp-personality">
                <span className="gs-bp-personality-label">
                  {isCommunity ? "AI Companion" : "AI Tutor"} personality
                </span>
                <span className="gs-bp-personality-value">Configured</span>
              </div>
            </BlueprintSection>
          )}

          {/* Empty state — nothing captured yet */}
          {!hasAnyData && (
            <div className="gs-bp-empty">
              <div className="gs-bp-empty-lines">
                <div className="gs-bp-empty-line gs-bp-empty-line--wide" />
                <div className="gs-bp-empty-line gs-bp-empty-line--medium" />
                <div className="gs-bp-empty-line gs-bp-empty-line--narrow" />
                <div className="gs-bp-empty-line gs-bp-empty-line--wide" />
                <div className="gs-bp-empty-line gs-bp-empty-line--medium" />
              </div>
            </div>
          )}
        </div>

        {/* ── Readiness + actions ─────────────────────── */}
        <ReadinessBar dots={dots} />

        <div className="gs-try-call">
          {launched ? (
            <a
              href={hasPlaybookId ? `/x/courses/${getData<string>("draftPlaybookId")}` : "/x/courses"}
              className="gs-sim-btn gs-sim-btn-ready"
            >
              View your course <ExternalLink size={11} />
            </a>
          ) : (
            <span className="gs-sim-btn gs-sim-btn-disabled" title="Practice calls are available on the Course page after setup completes">
              Practice call available on Course page
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
