/**
 * project-course-reference.ts
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §4 Phase 2.5
 * @canonical-doc docs/ENTITIES.md §6 I7
 *
 * Pure function that reads a COURSE_REFERENCE doc and returns a CourseProjection
 * describing the desired DB state for a course. No side effects, no DB calls,
 * no AI. Composes the existing parsers (detect-authored-modules,
 * detect-pedagogy, parse-content-declaration) and adds two new ones for
 * Skills Framework + outcomes-to-goals derivation.
 *
 * The Phase 4 applier (apply-projection.ts) consumes the CourseProjection and
 * performs idempotent diff writes keyed by (playbookId, sourceContentId,
 * slug/name). This file MUST stay pure.
 *
 * Issue #338.
 */

import { parseContentDeclaration, type ContentDeclaration } from "@/lib/content-trust/parse-content-declaration";
import {
  detectAuthoredModules,
  extractOutcomeStatements,
  type DetectedAuthoredModules,
} from "./detect-authored-modules";
import { detectPedagogy, type DetectedPedagogy } from "./detect-pedagogy";
import type {
  AuthoredModule,
  ModuleDefaults,
  ModuleSource,
  ValidationWarning,
} from "@/lib/types/json-fields";

// ── Public types ────────────────────────────────────────────────────────────

export interface ProjectedGoalTemplate {
  type: "LEARN" | "ACHIEVE";
  name: string;
  description?: string;
  isAssessmentTarget: boolean;
  /** Stable reference back to the doc that produced it. */
  ref: string;
  /** Priority hint 1–10 (higher = more important). ACHIEVE defaults higher. */
  priority: number;
}

export interface ProjectedBehaviorTarget {
  parameterName: string;
  scope: "PLAYBOOK";
  /** Target value normalised to [0,1]. Skills Framework Secure = 1.0. */
  targetValue: number;
  /** Stable reference back to the doc that produced it. */
  skillRef: string;
  description?: string;
}

/** #417 Phase B — a single trigger inside the projected MEASURE spec, one per skill. */
export interface ProjectedMeasureSpecTrigger {
  /** Stable skill ref ("SKILL-01") — applier copies through to the trigger record. */
  skillRef: string;
  name: string;
  given: string;
  when: string;
  then: string;
  actions: Array<{
    description: string;
    /** Resolved to parameterId by the applier (matches ProjectedParameter.name). */
    parameterName: string;
    weight: number;
  }>;
}

/**
 * #417 Phase B — MEASURE spec the applier creates per playbook so the
 * per-call pipeline actually scores `skill_*` parameters. One spec per
 * playbook with N triggers (one per skill). The slug is built by the
 * applier from the playbook id (`skill-measure-<playbookId-prefix>`).
 */
export interface ProjectedMeasureSpec {
  name: string;
  description: string;
  triggers: ProjectedMeasureSpecTrigger[];
}

/**
 * A LearningObjective the applier must write under a CurriculumModule. The
 * `ref` matches the OUT-NN id from the Course Reference doc and is the
 * stable key for diff (paired with moduleId). `description` is the OUT-NN
 * statement text; falls back to the bare ref if no statement is present
 * in the doc's outcomes dictionary.
 *
 * Issue #365.
 */
export interface ProjectedLearningObjective {
  ref: string;
  description: string;
  sortOrder: number;
}

export interface ProjectedCurriculumModule {
  slug: string;
  title: string;
  description?: string;
  sortOrder: number;
  estimatedDurationMinutes?: number;
  /**
   * LearningObjective rows the applier must upsert under this module,
   * derived from the module's `outcomesPrimary` cross-referenced against
   * the doc-level `outcomes` dictionary. Empty when the module has no
   * primary outcomes declared. Issue #365.
   */
  learningObjectives: ProjectedLearningObjective[];
}

export interface ProjectedParameter {
  /** Will be slugified to parameterId by the applier. */
  name: string;
  type: "BEHAVIOR";
  description?: string;
}

/**
 * Subset of Playbook.config the projection owns. Disjoint from the wizard
 * subset ({welcome, nps, surveys, schedulerPresetName}).
 */
export interface ProjectedConfigPatch {
  modulesAuthored: boolean | null;
  moduleSource?: ModuleSource;
  modules?: AuthoredModule[];
  moduleDefaults?: Partial<ModuleDefaults>;
  outcomes?: Record<string, string>;
  progressionMode?: "ai-led" | "learner-picks";
  moduleSourceRef?: { docId: string; version: string };
  /** Goal templates the applier writes to Playbook.config.goals. */
  goalTemplates: ProjectedGoalTemplate[];
}

export interface CourseProjection {
  /** Patch the applier merges into Playbook.config. */
  configPatch: ProjectedConfigPatch;
  /** Behavior targets to upsert at PLAYBOOK scope. */
  behaviorTargets: ProjectedBehaviorTarget[];
  /** CurriculumModule rows to upsert. */
  curriculumModules: ProjectedCurriculumModule[];
  /** Parameters the applier must ensure exist before writing behaviorTargets. */
  parameters: ProjectedParameter[];
  /**
   * #417 — MEASURE spec the applier upserts per playbook so the pipeline
   * actually scores `skill_*` parameters. Undefined when the projection
   * has no skills (course has no Skills Framework section).
   */
  measureSpec?: ProjectedMeasureSpec;
  /** Validation warnings from all parse stages, deduplicated. */
  validationWarnings: ValidationWarning[];
  /** Pass-through: front-matter declarations, possibly used by the applier. */
  contentDeclaration: ContentDeclaration;
  /** Pass-through: detected pedagogy hints. */
  pedagogy: DetectedPedagogy;
  /** Detected skills (raw — useful for debug + tests). */
  skills: ParsedSkill[];
}

export interface ProjectionOptions {
  /** ContentSource.id of the COURSE_REFERENCE doc being projected. */
  sourceContentId: string;
  /** Optional version string for moduleSourceRef. */
  docVersion?: string;
}

// ── Skills Framework parser ────────────────────────────────────────────────

export interface ParsedSkill {
  ref: string;
  name: string;
  description?: string;
  tiers: {
    emerging?: string;
    developing?: string;
    secure?: string;
  };
}

export interface SkillsFrameworkResult {
  skills: ParsedSkill[];
  validationWarnings: ValidationWarning[];
}

const SKILL_HEADING = /^###\s+(SKILL-\d+)\s*:\s*(.+?)\s*$/;
// Tier format accepts both v3.0 (`**Emerging:**`) and v2.2 (`**Emerging.**`)
// punctuation styles. The captured text follows the closing `**`.
const TIER_LINE = /^\s*[-*]\s*\*\*\s*(Emerging|Developing|Secure)\s*[:.]\s*\*\*\s*(.+?)\s*$/i;
const SECTION_BOUNDARY = /^##\s+/;

export function parseSkillsFramework(bodyText: string): SkillsFrameworkResult {
  const lines = bodyText.split(/\r?\n/);

  // Find the Skills Framework section first. Skip everything else.
  let inSection = false;
  const sectionLines: string[] = [];
  for (const line of lines) {
    if (/^##\s+Skills Framework\b/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && SECTION_BOUNDARY.test(line)) {
      // Hit the next ## section — stop accumulating.
      break;
    }
    if (inSection) sectionLines.push(line);
  }

  if (sectionLines.length === 0) {
    return { skills: [], validationWarnings: [] };
  }

  // Walk the section, accumulating one ParsedSkill per `### SKILL-NN` heading.
  const skills: ParsedSkill[] = [];
  const warnings: ValidationWarning[] = [];
  let current: ParsedSkill | null = null;
  // Description = first non-empty paragraph after the heading, before tier
  // bullets. Treat blank line as paragraph break.
  let descriptionBuffer: string[] = [];
  let captureDescription = false;

  const finalize = () => {
    if (!current) return;
    const desc = descriptionBuffer.join(" ").trim();
    if (desc) current.description = desc;
    skills.push(current);
    current = null;
    descriptionBuffer = [];
    captureDescription = false;
  };

  for (const line of sectionLines) {
    const headingMatch = line.match(SKILL_HEADING);
    if (headingMatch) {
      finalize();
      current = {
        ref: headingMatch[1],
        name: headingMatch[2].trim(),
        tiers: {},
      };
      captureDescription = true;
      continue;
    }
    if (!current) continue;

    const tierMatch = line.match(TIER_LINE);
    if (tierMatch) {
      captureDescription = false;
      const tier = tierMatch[1].toLowerCase() as "emerging" | "developing" | "secure";
      current.tiers[tier] = tierMatch[2].trim();
      continue;
    }

    if (captureDescription) {
      // Stop capturing once we hit a list line (signals tiers coming) or
      // blank line after content.
      if (/^\s*[-*]\s/.test(line)) {
        captureDescription = false;
        continue;
      }
      const trimmed = line.trim();
      if (trimmed === "" && descriptionBuffer.length > 0) {
        captureDescription = false;
        continue;
      }
      if (trimmed) descriptionBuffer.push(trimmed);
    }
  }
  finalize();

  // Validate: every skill should have all three tiers. Missing tiers are
  // warnings (publish gate decides whether to block) — they let an
  // educator save partial work.
  for (const skill of skills) {
    if (!skill.tiers.secure) {
      warnings.push({
        severity: "warning",
        code: "SKILL_MISSING_SECURE_TIER",
        message: `${skill.ref} (${skill.name}) has no Secure tier — projection cannot derive a BehaviorTarget target value.`,
      });
    }
    if (!skill.tiers.emerging || !skill.tiers.developing) {
      warnings.push({
        severity: "warning",
        code: "SKILL_INCOMPLETE_TIERS",
        message: `${skill.ref} (${skill.name}) is missing Emerging or Developing tier descriptions.`,
      });
    }
  }

  return { skills, validationWarnings: warnings };
}

// ── Mappers ────────────────────────────────────────────────────────────────

/**
 * Slugify a skill name to a stable parameter name.
 * "Fluency & Coherence" → "skill_fluency_and_coherence"
 * "Grammatical Range & Accuracy" → "skill_grammatical_range_and_accuracy"
 */
export function skillNameToParameterName(skillName: string): string {
  const cleaned = skillName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `skill_${cleaned}`;
}

function mapOutcomesToLearnGoals(outcomes: Record<string, string>): ProjectedGoalTemplate[] {
  return Object.entries(outcomes).map(([ref, statement]) => ({
    type: "LEARN" as const,
    name: statement,
    isAssessmentTarget: false,
    ref,
    priority: 5,
  }));
}

/**
 * #417 Phase B — build a ProjectedMeasureSpec from the parsed Skills
 * Framework. One trigger per skill; the action description carries the
 * three tier descriptors so the AI MEASURE prompt is grounded in rubric
 * language. The IELTS Speaking rubric explicitly mandates scoring each
 * criterion separately (see `docs/external/ielts/.../assessor-rubric.md`)
 * — one trigger per skill keeps that guarantee.
 *
 * Returns undefined when the doc has no skills section so the applier
 * skips the spec upsert path.
 */
function mapSkillsToMeasureSpec(
  skills: ParsedSkill[],
): ProjectedMeasureSpec | undefined {
  if (skills.length === 0) return undefined;

  const triggers: ProjectedMeasureSpecTrigger[] = skills.map((skill) => {
    const tierLines: string[] = [];
    if (skill.tiers.emerging) tierLines.push(`Emerging: ${skill.tiers.emerging}`);
    if (skill.tiers.developing)
      tierLines.push(`Developing: ${skill.tiers.developing}`);
    if (skill.tiers.secure) tierLines.push(`Secure (target): ${skill.tiers.secure}`);
    const rubric =
      tierLines.length > 0
        ? `\n\nTier descriptors:\n${tierLines.join("\n")}`
        : "";

    return {
      skillRef: skill.ref,
      name: `${skill.name} band assessment`,
      given: "The caller spoke on this call",
      when: "End-of-call analysis",
      then: `Score the caller's ${skill.name} per the rubric tiers (Emerging → Developing → Secure, normalised 0-1, Secure = 1.0). Score this criterion INDEPENDENTLY of the other criteria — composite scores hide what needs work.`,
      actions: [
        {
          description: `Measure ${skill.name}: produce a 0-1 score against the tier descriptors below.${rubric}`,
          parameterName: skillNameToParameterName(skill.name),
          weight: 1.0,
        },
      ],
    };
  });

  return {
    name: `Per-Skill Scoring (${skills.map((s) => s.ref).join(", ")})`,
    description:
      "Auto-generated by COURSE_REFERENCE projection (#417). Scores each skill parameter " +
      "from the Skills Framework on every call. The downstream EMA aggregator " +
      "rolls per-call scores into CallerTarget.currentScore, which feeds ACHIEVE " +
      "goal progress via calculateSkillAchieveProgress.",
    triggers,
  };
}

function mapSkillsToAchieveAndTargets(skills: ParsedSkill[]): {
  achieveGoals: ProjectedGoalTemplate[];
  behaviorTargets: ProjectedBehaviorTarget[];
  parameters: ProjectedParameter[];
} {
  const achieveGoals: ProjectedGoalTemplate[] = [];
  const behaviorTargets: ProjectedBehaviorTarget[] = [];
  const parameters: ProjectedParameter[] = [];

  for (const skill of skills) {
    const paramName = skillNameToParameterName(skill.name);
    const secureDescription = skill.tiers.secure ?? skill.description;

    parameters.push({
      name: paramName,
      type: "BEHAVIOR",
      description: skill.description,
    });

    achieveGoals.push({
      type: "ACHIEVE",
      name: `Reach Secure on ${skill.name}`,
      description: secureDescription,
      isAssessmentTarget: true,
      ref: skill.ref,
      priority: 8,
    });

    behaviorTargets.push({
      parameterName: paramName,
      scope: "PLAYBOOK",
      targetValue: 1.0,
      skillRef: skill.ref,
      description: secureDescription,
    });
  }

  return { achieveGoals, behaviorTargets, parameters };
}

// Parse a free-form duration string into estimated minutes. Tolerates ranges
// ("8–10 min", "12-15 minutes"), single values ("15 min", "15"), and the
// "Student-led" / "Open" / "Variable" cases which return undefined.
const DURATION_RANGE = /(\d+)\s*[-–]\s*(\d+)/;
const DURATION_SINGLE = /(\d+)/;
function parseDurationToMinutes(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  const lower = duration.toLowerCase();
  if (/student-led|open|variable|self-paced/.test(lower)) return undefined;
  const range = duration.match(DURATION_RANGE);
  if (range) return Number(range[2]); // upper bound
  const single = duration.match(DURATION_SINGLE);
  if (single) return Number(single[1]);
  return undefined;
}

function mapAuthoredModulesToCurriculumModules(
  modules: AuthoredModule[],
  outcomes: Record<string, string>,
): ProjectedCurriculumModule[] {
  return modules.map((m, idx) => ({
    slug: m.id,
    title: m.label,
    sortOrder: m.position ?? idx,
    estimatedDurationMinutes: parseDurationToMinutes(m.duration),
    learningObjectives: m.outcomesPrimary.map((ref, loIdx) => ({
      ref,
      // Prefer the statement from the doc-level `**OUT-NN: ...**` heading.
      // Fall back to the bare ref so the row is still well-formed when the
      // statement is missing (a validation warning will already exist).
      description: outcomes[ref]?.trim() || ref,
      sortOrder: loIdx,
    })),
  }));
}

function computeProgressionMode(modules: AuthoredModule[]): "ai-led" | "learner-picks" | undefined {
  if (modules.length === 0) return undefined;
  return modules.some((m) => m.learnerSelectable !== false) ? "learner-picks" : "ai-led";
}

// ── Public entry point ─────────────────────────────────────────────────────

export function projectCourseReference(
  bodyText: string,
  options: ProjectionOptions,
): CourseProjection {
  const declaration = parseContentDeclaration(bodyText);
  const pedagogy = detectPedagogy(bodyText);
  const detected: DetectedAuthoredModules = detectAuthoredModules(bodyText);
  const outcomes = detected.outcomes && Object.keys(detected.outcomes).length > 0
    ? detected.outcomes
    : extractOutcomeStatements(bodyText);
  const { skills, validationWarnings: skillWarnings } = parseSkillsFramework(bodyText);

  const learnGoals = mapOutcomesToLearnGoals(outcomes);
  const { achieveGoals, behaviorTargets, parameters } = mapSkillsToAchieveAndTargets(skills);
  const measureSpec = mapSkillsToMeasureSpec(skills);

  const moduleSource: ModuleSource | undefined =
    detected.modulesAuthored === true ? "authored" : detected.modulesAuthored === false ? "derived" : undefined;
  const progressionMode = computeProgressionMode(detected.modules);

  const configPatch: ProjectedConfigPatch = {
    modulesAuthored: detected.modulesAuthored,
    moduleSource,
    modules: detected.modules.length > 0 ? detected.modules : undefined,
    moduleDefaults: Object.keys(detected.moduleDefaults).length > 0 ? detected.moduleDefaults : undefined,
    outcomes: Object.keys(outcomes).length > 0 ? outcomes : undefined,
    progressionMode,
    moduleSourceRef: options.docVersion
      ? { docId: options.sourceContentId, version: options.docVersion }
      : undefined,
    goalTemplates: [...learnGoals, ...achieveGoals],
  };

  return {
    configPatch,
    behaviorTargets,
    curriculumModules: mapAuthoredModulesToCurriculumModules(detected.modules, outcomes),
    parameters,
    measureSpec,
    validationWarnings: [...detected.validationWarnings, ...skillWarnings],
    contentDeclaration: declaration,
    pedagogy,
    skills,
  };
}
