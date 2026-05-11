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

export interface ProjectedCurriculumModule {
  slug: string;
  title: string;
  description?: string;
  sortOrder: number;
  estimatedDurationMinutes?: number;
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

function mapAuthoredModulesToCurriculumModules(modules: AuthoredModule[]): ProjectedCurriculumModule[] {
  return modules.map((m, idx) => ({
    slug: m.id,
    title: m.label,
    sortOrder: m.position ?? idx,
    estimatedDurationMinutes: parseDurationToMinutes(m.duration),
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
    curriculumModules: mapAuthoredModulesToCurriculumModules(detected.modules),
    parameters,
    validationWarnings: [...detected.validationWarnings, ...skillWarnings],
    contentDeclaration: declaration,
    pedagogy,
    skills,
  };
}
