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

import { useState } from "react";
import { Loader2, RotateCcw, ExternalLink, Pencil, ChevronRight } from "lucide-react";
import { estimateTeachingSessions } from "@/lib/lesson-plan/session-ui";
import { useTerminology } from "@/contexts/TerminologyContext";
import { CONTENT_CATEGORIES, CATEGORY_ORDER } from "@/lib/content-categories";
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

/* ── Readiness dots (three-phase grouped) ──────────── */

interface ReadinessDot { filled: boolean; active: boolean; processing?: boolean; label: string }
interface ReadinessPhase { label: string; dots: ReadinessDot[]; sequential?: boolean }

function ReadinessBar({ phases }: { phases: ReadinessPhase[] }) {
  const allDots = phases.flatMap(p => p.dots);
  const filledCount = allDots.filter(d => d.filled).length;
  const missing = allDots.filter(d => !d.filled && !d.processing).map(d => d.label);
  const processing = allDots.filter(d => d.processing).map(d => d.label);
  const tooltipText = processing.length > 0
    ? `Processing: ${processing.join(", ")}` + (missing.length > 0 ? ` · Needs: ${missing.join(", ")}` : "")
    : missing.length > 0
      ? `Needs: ${missing.join(", ")}`
      : "All sections complete";
  return (
    <div className="gs-readiness" title={tooltipText}>
      <span className="gs-readiness-label">Progress</span>
      <div className="gs-readiness-dots">
        {phases.map((phase, pi) => (
          <span key={phase.label} className={`gs-phase-group${phase.sequential === false ? " gs-phase-group--parallel" : ""}`}>
            {phase.dots.map((d, di) => (
              <span key={di}>
                <span
                  className={
                    "gs-readiness-dot" +
                    (d.processing ? " gs-readiness-dot--processing" : d.filled ? " gs-readiness-dot--filled" : "") +
                    (d.active ? " gs-readiness-dot--active" : "")
                  }
                  title={`${d.label}: ${d.processing ? "processing…" : d.filled ? "✓" : "needed"}`}
                />
                {phase.sequential !== false && di < phase.dots.length - 1 && (
                  <span className={`gs-phase-connector${d.filled ? " gs-phase-connector--filled" : ""}`} />
                )}
              </span>
            ))}
            {pi < phases.length - 1 && <span className="gs-phase-sep" />}
          </span>
        ))}
      </div>
      <span className="gs-readiness-count">{filledCount}/{allDots.length}</span>
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

/* ── Guide Group (collapsible sub-section) ─────────── */

function GuideGroup({ label, count, items, maxShow = 5, expanded, onToggle }: {
  label: string;
  count: number;
  items: string[];
  maxShow?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visible = items.slice(0, expanded ? maxShow : 0);
  const remaining = count - maxShow;
  return (
    <div className="gs-bp-guide-group">
      <button type="button" className="gs-bp-guide-header" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        <span className="gs-bp-guide-label">{label}</span>
        <span className="gs-bp-guide-count">{count}</span>
        <ChevronRight size={12} className={`gs-bp-guide-chevron${expanded ? " gs-bp-guide-chevron--open" : ""}`} />
      </button>
      {expanded && (
        <div className="gs-bp-guide-items">
          {visible.map((item, i) => (
            <div key={i} className="gs-bp-guide-item" title={item}>{item}</div>
          ))}
          {remaining > 0 && (
            <div className="gs-bp-guide-more">+{remaining} more</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Status phase maps ──────────────────────────────── */

const ITEM_TO_PHASE: Record<string, string> = {
  institution: "institution",
  department: "institution",
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
  onReset?: () => void;
  onItemClick?: (itemKey: string) => void;
}

/* ── Main component ─────────────────────────────────── */

export function ScaffoldPanel({ getData, currentStepIndex = -1, currentPhaseId, onReset, onItemClick }: ScaffoldPanelProps) {
  const { terms: terminology } = useTerminology();
  const t = {
    institution: terminology.domain,
    department: terminology.group,
    subject: terminology.knowledge_area,
    course: terminology.playbook,
    content: "Content",
    welcome: "Welcome Message",
    lessons: terminology.session,
    personality: "AI Tutor",
  };
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

  // Collapsible guide section accordion
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const toggleGuide = (key: string) => setExpandedGuide(prev => prev === key ? null : key);

  // Data reads
  const institutionName = getData<string>("institutionName") || getData<string>("existingInstitutionName");
  const typeSlug = getData<string>("typeSlug");
  const groupName = getData<string>("groupName");
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
  const categoryCounts = getData<Record<string, number>>("categoryCounts");

  // Teaching guide data
  const skillsFramework = getData<Array<{ id?: string; name: string; description?: string }>>("skillsFramework");
  const teachingPrinciples = getData<{ corePrinciples?: string[] }>("teachingPrinciples");
  const edgeCases = getData<Array<{ scenario: string; response?: string }>>("edgeCases");
  const coursePhases = getData<Array<{ name: string; goal?: string }>>("coursePhases");

  // Course identity extras
  const courseContext = getData<string>("courseContext");

  // Session extras
  const assessmentTargets = getData<string[]>("assessmentTargets");
  const constraints = getData<string[]>("constraints");

  // Default detection helper
  const isDefault = (field: string) => !userSetFields.includes(field);

  // Phase active detection
  const isPhaseActive = (key: string) =>
    currentPhaseId ? ITEM_TO_PHASE[key] === currentPhaseId : false;

  const clickable = !!onItemClick;
  const click = (key: string) => onItemClick?.(key);

  // Readiness — three-phase grouped dots (matches CourseSetupTracker)
  const sectionHasValue: Record<string, boolean> = {
    institution: !!institutionName,
    department: !!groupName,
    subject: !!subjectDiscipline,
    course: !!courseName,
    content: hasContent,
    welcome: !!welcomeMsg,
    lessons: !!sessionCount,
    personality: hasTune,
  };

  const SECTION_LABELS: Record<string, string> = {
    institution: t.institution,
    department: t.department,
    subject: t.subject,
    course: t.course,
    content: t.content,
    welcome: t.welcome,
    lessons: t.lessons,
    personality: t.personality,
  };

  const makeDot = (s: string): ReadinessDot => ({
    filled: getItemStatus(s, sectionHasValue[s], currentStepIndex, resolvedKeys, launched) !== "waiting",
    active: isPhaseActive(s),
    processing: s === "content" && isExtracting,
    label: SECTION_LABELS[s] || capitalize(s),
  });

  // Phase grouping: Foundation (sequential) → Configure (parallel) → Launch
  // Department dot only appears when a department name has been collected
  const foundationDots: string[] = ["institution"];
  if (groupName && !isCommunity) foundationDots.push("department");
  if (!isCommunity) foundationDots.push("subject");
  foundationDots.push("course");

  const phases: ReadinessPhase[] = isCommunity
    ? [
        { label: "Foundation", dots: ["institution", "course"].map(makeDot), sequential: true },
        { label: "Configure", dots: ["welcome"].map(makeDot), sequential: false },
        { label: "Launch", dots: ["personality"].map(makeDot) },
      ]
    : [
        { label: "Foundation", dots: foundationDots.map(makeDot), sequential: true },
        { label: "Configure", dots: ["content", "lessons"].map(makeDot), sequential: false },
        { label: "Launch", dots: ["welcome", "personality"].map(makeDot) },
      ];

  const allDots = phases.flatMap(p => p.dots);
  const completedCount = allDots.filter(d => d.filled).length;

  // Has anything at all been filled?
  const hasAnyData = !!institutionName || !!courseName;

  // Content section details
  const contentParts: string[] = [];
  if (contentTotals) {
    if (contentTotals.assertions > 0) contentParts.push(`${contentTotals.assertions} teaching pts`);
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
            {institutionName ? (
              <div className="gs-bp-subtitle">{institutionName}</div>
            ) : !hasAnyData ? (
              <div className="gs-bp-subtitle">Start chatting to build your course</div>
            ) : null}
            {isExtracting && (
              <div className="gs-bp-status-pill">
                <Loader2 size={11} className="hf-spinner" />
                Processing materials...
              </div>
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

          {/* Department (optional tier — only when set) */}
          <BlueprintSection
            visible={!!groupName && !isCommunity}
            active={isPhaseActive("department")}
            clickable={clickable}
            onClick={() => click("department")}
            sectionKey="department"
          >
            <div className="gs-bp-dept">
              <span className="gs-bp-dept-name">{groupName}</span>
            </div>
          </BlueprintSection>

          {/* Knowledge Area (promoted from meta pill) */}
          <BlueprintSection
            visible={!!subjectDiscipline && !isCommunity}
            active={isPhaseActive("subject")}
            clickable={clickable}
            onClick={() => click("subject")}
            sectionKey="subject"
          >
            <div className="gs-bp-knowledge-area">
              <span className="gs-bp-knowledge-area-label">{t.subject}</span>
              <span className="gs-bp-knowledge-area-name">{subjectDiscipline}</span>
            </div>
          </BlueprintSection>

          {/* Course identity — name, approach */}
          <BlueprintSection
            visible={!!courseName}
            active={isPhaseActive("course")}
            clickable={clickable}
            onClick={() => click("course")}
            sectionKey="course"
          >
            <div className="gs-bp-meta">
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
            {courseContext && (
              <div className="gs-bp-philosophy">
                &ldquo;{courseContext}&rdquo;
              </div>
            )}
            {learningOutcomes && learningOutcomes.length > 0 && (
              <GuideGroup
                label="Learning Outcomes"
                count={learningOutcomes.length}
                items={learningOutcomes}
                expanded={expandedGuide === "outcomes"}
                onToggle={() => toggleGuide("outcomes")}
              />
            )}
          </BlueprintSection>

          {/* Teaching Guide — pedagogy nodes (only when courseRefEnabled) */}
          {!!(getData<boolean>("courseRefEnabled") || getData("courseRefDigest")) && (
            <BlueprintSection
              visible
              active={false}
              clickable={clickable}
              onClick={() => click("skillsFramework")}
              sectionKey="pedagogy"
            >
              <div className="gs-bp-content">
                <span className="gs-bp-content-label">Teaching Guide</span>
                {!skillsFramework && !teachingPrinciples && !edgeCases && !coursePhases ? (
                  <span className="gs-bp-content-detail">Not started</span>
                ) : (
                  <div>
                    {skillsFramework && skillsFramework.length > 0 && (
                      <GuideGroup
                        label="Skills Framework"
                        count={skillsFramework.length}
                        items={skillsFramework.map(s => s.name)}
                        expanded={expandedGuide === "skills"}
                        onToggle={() => toggleGuide("skills")}
                      />
                    )}
                    {teachingPrinciples?.corePrinciples && teachingPrinciples.corePrinciples.length > 0 && (
                      <GuideGroup
                        label="Core Principles"
                        count={teachingPrinciples.corePrinciples.length}
                        items={teachingPrinciples.corePrinciples}
                        expanded={expandedGuide === "principles"}
                        onToggle={() => toggleGuide("principles")}
                      />
                    )}
                    {edgeCases && edgeCases.length > 0 && (
                      <GuideGroup
                        label="Tricky Scenarios"
                        count={edgeCases.length}
                        items={edgeCases.map(e => e.scenario)}
                        expanded={expandedGuide === "edges"}
                        onToggle={() => toggleGuide("edges")}
                      />
                    )}
                    {coursePhases && coursePhases.length > 0 && (
                      <GuideGroup
                        label="Course Phases"
                        count={coursePhases.length}
                        items={coursePhases.map(p => p.name + (p.goal ? ` — ${p.goal}` : ""))}
                        expanded={expandedGuide === "phases"}
                        onToggle={() => toggleGuide("phases")}
                      />
                    )}
                  </div>
                )}
              </div>
            </BlueprintSection>
          )}

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
                    {categoryCounts && contentTotals && contentTotals.assertions > 0 && (
                      <span className="gs-bp-category-pills">
                        {CATEGORY_ORDER
                          .filter(cat => (categoryCounts[cat] ?? 0) > 0)
                          .map(cat => {
                            const meta = CONTENT_CATEGORIES[cat];
                            return (
                              <span
                                key={cat}
                                className="gs-bp-category-pill--labeled"
                                title={meta.label}
                                style={{ color: meta.color, background: meta.bg }}
                              >
                                {meta.icon && <span>{meta.icon}</span>}
                                {categoryCounts[cat]} {meta.label}
                              </span>
                            );
                          })}
                      </span>
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
              {sessionCount && sourceCount && (() => {
                const teachingSessions = estimateTeachingSessions(sessionCount);
                if (teachingSessions <= 0) return null;
                if (sourceCount > teachingSessions) {
                  return (
                    <span className="gs-bp-content-hint">
                      {sourceCount} material{sourceCount !== 1 ? "s" : ""} for {teachingSessions} teaching session{teachingSessions !== 1 ? "s" : ""} — some sessions will cover multiple documents
                    </span>
                  );
                }
                if (sourceCount < teachingSessions) {
                  return (
                    <span className="gs-bp-content-hint">
                      {sourceCount} material{sourceCount !== 1 ? "s" : ""} for {teachingSessions} teaching session{teachingSessions !== 1 ? "s" : ""} — consider uploading more
                    </span>
                  );
                }
                return null;
              })()}
              {assessmentTargets && assessmentTargets.length > 0 && (
                <div className="gs-bp-targets">
                  <span className="gs-bp-targets-label">Working toward:</span>
                  {assessmentTargets.join(", ")}
                </div>
              )}
              {constraints && constraints.length > 0 && (
                <div className="gs-bp-constraints">
                  <span className="gs-bp-constraints-label">Avoids:</span>
                  {constraints.join(", ")}
                </div>
              )}
            </BlueprintSection>
          )}

          {/* Assessment questions */}
          {!isCommunity && assessments !== "none" && contentTotals && contentTotals.questions > 0 && (
            <BlueprintSection
              visible
              active={false}
              clickable={clickable}
              onClick={() => click("lessons")}
              sectionKey="assessment"
            >
              <div className="gs-bp-assessment">
                <span className="gs-bp-assessment-label">Assessment Qs</span>
                <span className="gs-bp-assessment-count">{contentTotals.questions}</span>
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
        <ReadinessBar phases={phases} />

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
