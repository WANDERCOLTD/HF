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
import { detectMockShapeCovers } from "./detect-mock-shape-modules";
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
  /**
   * #444 — progress measurement strategy resolved at projection time from
   * the goal's shape. The applier writes this verbatim onto Goal rows so
   * trackGoalProgress dispatches without re-resolving per call.
   *   • LEARN + ref starting "OUT"/"LO"/"BAND"  → "lo_rollup"
   *   • ACHIEVE + ref="SKILL-NN"                → "skill_ema"
   *   • isAssessmentTarget + ASSESSOR_RUBRIC    → "assessment_readiness"
   *   • Anything else (caller-expressed / etc.) → "manual_only"
   */
  progressStrategy: string;
}

export interface ProjectedBehaviorTarget {
  parameterName: string;
  scope: "PLAYBOOK";
  /**
   * Target value normalised to [0,1]. Resolution order:
   *   1. Skill's `Target band: N.N` line in the fixture → `band / 10`
   *      (e.g. Band 6.5 = 0.65, Band 9 = 0.9). The /10 convention leaves
   *      headroom for "scored above target" feedback in the UI.
   *   2. No target band declared → 1.0 (Secure tier ceiling, legacy default).
   */
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
  /**
   * Sub-module slugs this module's evidence ALSO counts toward. Populated
   * by the wizard for mock-shape modules (IELTS Full Mock Exam covers
   * part1/part2/part3 in one call). Gates the pipeline's per-segment
   * MEASURE pass at `runPerSegmentScoring` — empty/undefined → that path
   * short-circuits and the call falls back to single-module scoring. #557.
   */
  coversModules?: string[];
}

export interface ProjectedParameter {
  /** Will be slugified to parameterId by the applier. */
  name: string;
  type: "BEHAVIOR";
  description?: string;
  /**
   * Optional per-band descriptor text (#500 PR-2). Written to
   * Parameter.config.bandThresholds by the applier. Present for skill
   * parameters that wrap a graded rubric (IELTS bands 0–9, CEFR, NHS AfC);
   * absent for skills with only tier descriptors (Emerging/Developing/Secure).
   */
  bandThresholds?: Record<number, string>;
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
  /**
   * #UI-followup Gap 1 — opt-in scoring mode declared in course-ref
   * front-matter via `hf-scoring-mode: evidence-first`. The applier
   * writes it onto Playbook.config.scoringMode; event-gate auto-detects
   * the playbook from there instead of requiring a hardcoded JSON entry.
   */
  scoringMode?: "evidence-first";
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
  /**
   * Tier descriptors keyed by lowercase tier name. The default scheme is
   * 3-tier `emerging` / `developing` / `secure`; the parser also accepts
   * table-form Skills Framework with any tier scheme (`foundation` /
   * `developing` / `practitioner` / `distinction` for CTO/CIO, CEFR's
   * `a1`–`c2`, NHS AfC bands, etc.). Backward compatible — code reading
   * `skill.tiers.emerging` still works for 3-tier courses.
   *
   * The ordered list of tier names for this skill lives in `tierScheme`.
   */
  tiers: Record<string, string>;
  /**
   * Ordered tier names (lowercase) — first = lowest tier, last = top tier
   * (the "target" tier whose descriptor populates downstream goal copy and
   * BehaviorTarget secureDescription). For 3-tier skills this is always
   * `["emerging", "developing", "secure"]`; CTO/CIO 4-tier is
   * `["foundation", "developing", "practitioner", "distinction"]`. Custom
   * schemes are accepted with a `SKILL_UNRECOGNISED_TIER_SCHEME` warning.
   */
  tierScheme: string[];
  /**
   * Optional per-skill target band parsed from a `**Target band:** N.N`
   * line inside the skill section. Converted to `targetValue = band / 10`
   * by `mapSkillsToAchieveAndTargets`. Absent = aim for top tier (1.0).
   */
  targetBand?: number;
  /**
   * Per-band descriptor map (#500 PR-2). Two accepted forms inside a
   * `### SKILL-NN` section: `**Band N:** descriptor` bullets, or markdown
   * table rows `| N | descriptor |`. Keys are integer band numbers.
   * Empty/absent when the skill has no graded rubric.
   */
  bandThresholds?: Record<number, string>;
}

/**
 * Known tier schemes — projection accepts any scheme but only warns when
 * the parsed scheme doesn't match a recognised one (i.e. the educator
 * might have mistyped a column header).
 */
export const KNOWN_TIER_SCHEMES: Record<string, readonly string[]> = {
  three: ["emerging", "developing", "secure"],
  cto: ["foundation", "developing", "practitioner", "distinction"],
  cefr: ["a1", "a2", "b1", "b2", "c1", "c2"],
};

/** Default scheme for heading-form skills (existing v2.2/v3.0 behaviour). */
const DEFAULT_TIER_SCHEME = KNOWN_TIER_SCHEMES.three;

/** Normalize a tier label for storage key + scheme matching. */
function normaliseTierName(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]+/g, "");
}

/** Check whether the given ordered tier list matches a known scheme. */
function schemeMatchesKnown(scheme: readonly string[]): string | null {
  for (const [name, known] of Object.entries(KNOWN_TIER_SCHEMES)) {
    if (known.length !== scheme.length) continue;
    if (known.every((t, i) => t === scheme[i])) return name;
  }
  return null;
}

/** Capitalise the first letter; used for display labels (`emerging` → `Emerging`). */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface SkillsFrameworkResult {
  skills: ParsedSkill[];
  validationWarnings: ValidationWarning[];
}

const SKILL_HEADING = /^###\s+(SKILL-\d+)\s*:\s*(.+?)\s*$/;
/** Markdown table data row carrying a skill in TABLE form (#cto). */
const SKILL_TABLE_DATA_ROW = /^\s*\|\s*(SKILL-\d+)\s*\|/i;
/** Markdown table separator row: `|---|---|...|` (any number of cells). */
const TABLE_SEPARATOR = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;
/** First-cell looks like a header: contains "Skill ref" or "Ref" — used to find header row. */
const SKILL_TABLE_HEADER_FIRST_CELL = /^(skill\s+ref|ref|skill\s+id)$/i;
// Tier format accepts both v3.0 (`**Emerging:**`) and v2.2 (`**Emerging.**`)
// punctuation styles. The captured text follows the closing `**`.
const TIER_LINE = /^\s*[-*]\s*\*\*\s*(Emerging|Developing|Secure)\s*[:.]\s*\*\*\s*(.+?)\s*$/i;
// Per-band descriptor bullet (#500 PR-2). Form: `- **Band 9:** descriptor`
const BAND_LINE = /^\s*[-*]?\s*\*{0,2}\s*Band\s+(\d+(?:\.\d+)?)\s*\*{0,2}\s*[:.]\s*\*{0,2}\s*(.+?)\s*$/i;
// Markdown table row carrying a band descriptor (#500 PR-2). Form: `| 9 | descriptor |`
// First cell must be a plain integer — skips header + alignment rows.
const BAND_TABLE_ROW = /^\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/;
// Per-skill target band declaration. Accepts punctuation/bold variants:
//   `**Target band:** 6.5`     (colon inside bold)
//   `**Target band**: 6.5`     (colon outside bold)
//   `- **Target band:** 6.5`   (list-bullet form)
//   `Target band: 6.5`         (unbolded)
// Captured as a decimal number; consumed as `band / 10` downstream.
const TARGET_BAND_LINE = /^\s*[-*]?\s*\*{0,2}\s*Target band\s*\*{0,2}\s*[:.]\s*\*{0,2}\s*(\d+(?:\.\d+)?)\s*$/i;
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

  const warnings: ValidationWarning[] = [];

  // TABLE form takes precedence — if the section contains a recognisable
  // skill table (`| Skill ref | Skill | Tier1 | Tier2 | ... |`), parse it
  // and return. The heading-form path stays as-is for IELTS/Big5/Seducing
  // courses that already use it.
  const tableResult = parseSkillsFrameworkTable(sectionLines, warnings);
  if (tableResult) {
    return { skills: tableResult, validationWarnings: validateSkills(tableResult, warnings) };
  }

  // Walk the section, accumulating one ParsedSkill per `### SKILL-NN` heading.
  const skills: ParsedSkill[] = [];
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
        tierScheme: [...DEFAULT_TIER_SCHEME],
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

    const bandMatch = line.match(TARGET_BAND_LINE);
    if (bandMatch) {
      captureDescription = false;
      const parsed = Number(bandMatch[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        current.targetBand = parsed;
      }
      continue;
    }

    // Per-band threshold capture (#500 PR-2). `**Band N:** desc` OR `| N | desc |`.
    const bandLineMatch = line.match(BAND_LINE);
    if (bandLineMatch && Number.isInteger(Number(bandLineMatch[1]))) {
      captureDescription = false;
      const bandNum = Number(bandLineMatch[1]);
      if (Number.isFinite(bandNum) && bandNum >= 0 && bandNum <= 9) {
        current.bandThresholds ??= {};
        current.bandThresholds[bandNum] = bandLineMatch[2].trim();
      }
      continue;
    }
    const bandTableMatch = line.match(BAND_TABLE_ROW);
    if (bandTableMatch) {
      captureDescription = false;
      const bandNum = Number(bandTableMatch[1]);
      if (Number.isFinite(bandNum) && bandNum >= 0 && bandNum <= 9) {
        current.bandThresholds ??= {};
        current.bandThresholds[bandNum] = bandTableMatch[2].trim();
      }
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

  validateSkills(skills, warnings);
  return { skills, validationWarnings: warnings };
}

/**
 * Validate skill rows against their `tierScheme`. Missing tiers are
 * warnings (publish gate decides whether to block) — they let an
 * educator save partial work. Returns the warnings array for chaining.
 */
function validateSkills(
  skills: ParsedSkill[],
  warnings: ValidationWarning[],
): ValidationWarning[] {
  for (const skill of skills) {
    const topTier = skill.tierScheme[skill.tierScheme.length - 1];
    if (!skill.tiers[topTier]) {
      warnings.push({
        severity: "warning",
        code: "SKILL_MISSING_SECURE_TIER",
        message: `${skill.ref} (${skill.name}) has no ${topTier} tier — projection cannot derive a BehaviorTarget target value.`,
      });
    }
    const missingMidTiers = skill.tierScheme
      .slice(0, -1)
      .filter((t) => !skill.tiers[t]);
    if (missingMidTiers.length > 0) {
      warnings.push({
        severity: "warning",
        code: "SKILL_INCOMPLETE_TIERS",
        message: `${skill.ref} (${skill.name}) is missing tier descriptors for: ${missingMidTiers.join(", ")}.`,
      });
    }
  }
  return warnings;
}

/**
 * Parse table-form Skills Framework:
 *
 * ```
 * | Skill ref | Skill | Foundation | Developing | Practitioner | Distinction |
 * |---|---|---|---|---|---|
 * | SKILL-01 | **Stakeholder anticipation** — predicting … | Reacts to … | Proactively … | Anticipates … | Has reframed … |
 * ```
 *
 * Returns null when no recognisable table is present (caller falls
 * through to the heading-form parser). Returns `[]` when a header is
 * detected but no data rows match — surfaces as
 * PROJECTION_NO_SKILLS_FRAMEWORK upstream.
 *
 * Recognised tier schemes match `KNOWN_TIER_SCHEMES`; unrecognised ones
 * are accepted with a `SKILL_UNRECOGNISED_TIER_SCHEME` warning so the
 * educator notices a possible header typo.
 */
function parseSkillsFrameworkTable(
  sectionLines: string[],
  warnings: ValidationWarning[],
): ParsedSkill[] | null {
  // 1. Find the header row + separator + tier columns.
  let headerIndex = -1;
  let tierColumns: string[] = [];
  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    if (!line.trim().startsWith("|")) continue;
    const cells = parseTableRow(line);
    if (cells.length < 3) continue;
    if (!SKILL_TABLE_HEADER_FIRST_CELL.test(cells[0])) continue;
    // Next non-blank line must be a separator row to confirm this is the header.
    const nextLine = sectionLines.slice(i + 1).find((l) => l.trim().length > 0);
    if (!nextLine || !TABLE_SEPARATOR.test(nextLine)) continue;
    headerIndex = i;
    tierColumns = cells.slice(2).map(normaliseTierName);
    break;
  }
  if (headerIndex < 0) return null;
  if (tierColumns.length === 0) return null;

  // 2. Validate the scheme.
  const knownName = schemeMatchesKnown(tierColumns);
  if (!knownName) {
    warnings.push({
      severity: "warning",
      code: "SKILL_UNRECOGNISED_TIER_SCHEME",
      message:
        `Skills Framework table uses tier scheme [${tierColumns.join(", ")}] which doesn't ` +
        `match any known scheme (${Object.keys(KNOWN_TIER_SCHEMES).join(", ")}). ` +
        `Accepted as-is; check the header row for typos.`,
    });
  }

  // 3. Walk data rows.
  const skills: ParsedSkill[] = [];
  for (let i = headerIndex + 1; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    if (TABLE_SEPARATOR.test(line)) continue;
    if (!SKILL_TABLE_DATA_ROW.test(line)) continue;
    const cells = parseTableRow(line);
    if (cells.length < 2 + tierColumns.length) {
      // Row has fewer tier cells than the header promises — skip with warning.
      warnings.push({
        severity: "warning",
        code: "SKILL_TABLE_ROW_TRUNCATED",
        message: `Skill table row ${cells[0]} has ${cells.length - 2} tier cells; header declared ${tierColumns.length}.`,
      });
      continue;
    }
    const ref = cells[0];
    const skillCell = cells[1];
    // Skill cell may be `**Name** — description` or just `Name`. Pull the
    // bolded name out and treat the rest as description; fall back to the
    // whole cell as the name if no bold.
    const skillCellMatch = skillCell.match(/^\*\*(.+?)\*\*\s*(?:[—-]\s*(.+))?$/);
    const name = skillCellMatch ? skillCellMatch[1].trim() : skillCell;
    const description = skillCellMatch && skillCellMatch[2] ? skillCellMatch[2].trim() : undefined;

    const tiers: Record<string, string> = {};
    for (let j = 0; j < tierColumns.length; j++) {
      const cell = cells[2 + j]?.trim();
      if (cell) tiers[tierColumns[j]] = cell;
    }

    skills.push({
      ref,
      name,
      description,
      tiers,
      tierScheme: [...tierColumns],
    });
  }
  return skills;
}

/**
 * Split a markdown table row into cell strings. Trims outer pipes + each
 * cell's surrounding whitespace. Does not handle escaped pipes inside
 * cells — Skills Framework tables don't contain those today.
 */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "");
  return trimmed.split("|").map((c) => c.trim());
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
    // #444 — authored LEARN goals are measured by LO mastery roll-up.
    progressStrategy: "lo_rollup",
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
    const hasTargetBand =
      typeof skill.targetBand === "number" && skill.targetBand > 0;
    const topTierLower = skill.tierScheme[skill.tierScheme.length - 1] ?? "secure";
    const topTierLabel = capitalize(topTierLower);
    const topTierTargetLabel = hasTargetBand
      ? `${topTierLabel} (ceiling = 1.0; this course targets Band ${skill.targetBand} = ${(skill.targetBand! / 10).toFixed(2)})`
      : `${topTierLabel} (target)`;
    // Build the rubric in tierScheme order so per-band ordering is stable
    // for any scheme (3-tier, 4-tier CTO, CEFR 6-tier, etc.).
    const tierLines: string[] = [];
    for (const tierKey of skill.tierScheme) {
      const value = skill.tiers[tierKey];
      if (!value) continue;
      const isTop = tierKey === topTierLower;
      const label = isTop ? topTierTargetLabel : capitalize(tierKey);
      tierLines.push(`${label}: ${value}`);
    }
    const rubric =
      tierLines.length > 0
        ? `\n\nTier descriptors:\n${tierLines.join("\n")}`
        : "";

    const tierFlow = skill.tierScheme.map(capitalize).join(" → ");

    return {
      skillRef: skill.ref,
      name: `${skill.name} band assessment`,
      given: "The caller spoke on this call",
      when: "End-of-call analysis",
      then: `Score the caller's ${skill.name} per the rubric tiers (${tierFlow}, normalised 0-1 where the top tier (${topTierLabel}) corresponds to 1.0; bands map proportionally — e.g. Band 6.5 = 0.65, Band 9 = 0.9). Score this criterion INDEPENDENTLY of the other criteria — composite scores hide what needs work.`,
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
    const topTier = skill.tierScheme[skill.tierScheme.length - 1] ?? "secure";
    const topTierLabel = capitalize(topTier);
    const secureDescription = skill.tiers[topTier] ?? skill.description;
    const hasTargetBand =
      typeof skill.targetBand === "number" && skill.targetBand > 0;
    const targetValue = hasTargetBand ? skill.targetBand! / 10 : 1.0;
    const goalName = hasTargetBand
      ? `Reach Band ${skill.targetBand} on ${skill.name}`
      : `Reach ${topTierLabel} on ${skill.name}`;

    parameters.push({
      name: paramName,
      type: "BEHAVIOR",
      description: skill.description,
      // #500 PR-2 — pass band thresholds through; applier writes them into
      // Parameter.config.bandThresholds. Only present for graded-rubric skills.
      bandThresholds: skill.bandThresholds,
    });

    achieveGoals.push({
      type: "ACHIEVE",
      name: goalName,
      description: secureDescription,
      isAssessmentTarget: true,
      ref: skill.ref,
      priority: 8,
      // #444 — SKILL-NN ACHIEVE goals are measured by per-skill EMA (#417).
      progressStrategy: "skill_ema",
    });

    behaviorTargets.push({
      parameterName: paramName,
      scope: "PLAYBOOK",
      targetValue,
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
  // #557: pre-compute `coversModules` for mock-shape modules so the
  // wizard projection persists it on the CurriculumModule row. Without
  // this the per-segment MEASURE pipeline (#550) can never fire on
  // wizard-created courses.
  const coversBySlug = detectMockShapeCovers(modules.map((m) => ({ slug: m.id })));
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
    coversModules: coversBySlug.get(m.id),
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

  // (c) Course-ref template enforcement (2026-06-13). Every course-ref MUST
  // declare at least one parseable skill via the `## Skills Framework` →
  // `### SKILL-NN: Name (CODE)` structure. Without it the educator dashboard
  // shows flat-zero on every learner forever (no skill_* Parameter rows, no
  // BehaviorTargets, no MEASURE spec, no CallerTarget rows). The CTO/CIO
  // course-refs hit this gap on 2026-06-13: section present but in table
  // form (4-tier rubric) which the parser doesn't yet support → silently
  // produces 0 skills.
  //
  // Severity: warning (not error) so a partial draft can still be saved
  // and re-projected; the publish-time gate in run-projection-for-playbook
  // can upgrade this to a launch blocker. Table-form + N-tier support is
  // tracked as a follow-on.
  const projectionNoSkillsWarning: ValidationWarning[] =
    skills.length === 0
      ? [
          {
            severity: "warning",
            code: "PROJECTION_NO_SKILLS_FRAMEWORK",
            message:
              "No parseable `## Skills Framework` → `### SKILL-NN: Name` " +
              "section found. Educator dashboard band/tier UI will be flat-zero " +
              "until at least one skill is declared. Skills Framework is " +
              "REQUIRED per a-sample-docs/course-reference-template.md.",
          },
        ]
      : [];

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
    // #UI-followup Gap 1 — opt-in evidence-first scoring declared in the
    // course-ref front-matter (`hf-scoring-mode: evidence-first`). When
    // set, the applier writes Playbook.config.scoringMode, and event-gate
    // routes calls through the Boaz guard automatically — no JSON edit.
    scoringMode: declaration.scoringMode,
    goalTemplates: [...learnGoals, ...achieveGoals],
  };

  return {
    configPatch,
    behaviorTargets,
    curriculumModules: mapAuthoredModulesToCurriculumModules(detected.modules, outcomes),
    parameters,
    measureSpec,
    validationWarnings: [
      ...detected.validationWarnings,
      ...skillWarnings,
      ...projectionNoSkillsWarning,
    ],
    contentDeclaration: declaration,
    pedagogy,
    skills,
  };
}
