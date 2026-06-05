/**
 * Display-name resolvers for qualification-led learner surfaces — #1098 Slice A.
 *
 * Translates HF internal identifiers (module slugs, LO refs, skill refs,
 * Playbook config JSON) into the labels a learner expects to see. Used by
 * `/api/student/qualification-progress`, the SIM pre/post-call panels, and
 * the caller-detail qualification lens.
 *
 * **Pattern:** load a `QualificationCatalog` once per request (single Prisma
 * round-trip for all siblings sharing the anchor), then sync-resolve labels
 * everywhere. Avoids N+1 lookups and matches the Slice 2B.3 parity guarantee
 * (sibling Curricula declare the same slug + LO ref sets, so any sibling's
 * row is canonical).
 *
 * Source-of-truth decisions (from #1098 Tech Lead review):
 *   - Unit title  ← `CurriculumModule.title` (regulated heading text)
 *   - LO label    ← `LearningObjective.description` (verbatim qualification
 *                   wording). `performanceStatement` is the learner-friendly
 *                   rewrite shown on expansion, not the primary label.
 *   - Skill label ← `Curriculum.crossCuttingSkillsConfig.skills[].name`
 *                   (Option (b) from the cross-cutting skill source debate —
 *                   per-Curriculum JSON cache populated by ingest).
 *   - Course type ← inferred from `Playbook.config.useFreshMastery` +
 *                   `Playbook.config.maxMasteryTier` (or explicit
 *                   `Playbook.config.courseTypeLabel` override when set).
 *
 * Slug-scope discipline (#407): module catalog lookups are scoped to the
 * qualification family (sibling Curricula via `findSiblingCurricula`), not
 * a bare global slug find. Cross-family slug collisions are blocked by the
 * Slice 2B.3 CI guard.
 */

import { prisma } from "@/lib/prisma";
import { findSiblingCurricula } from "@/lib/curriculum/find-sibling-curricula";

export interface UnitCatalogEntry {
  slug: string;
  title: string;
  description: string | null;
  sortOrder: number;
  learningObjectives: LoCatalogEntry[];
}

export interface LoCatalogEntry {
  ref: string;
  description: string;
  performanceStatement: string | null;
  sortOrder: number;
}

export interface SkillCatalogEntry {
  ref: string;
  name: string;
  tierRubric?: Record<string, string> | null;
}

export interface QualificationCatalog {
  anchor: string;
  units: Map<string, UnitCatalogEntry>;
  /** loRef → moduleSlug, for callers that have a loRef but no module context. */
  loToModule: Map<string, string>;
  skills: Map<string, SkillCatalogEntry>;
}

/**
 * Load the full display catalog for a qualification anchor in one shot.
 *
 * Returns `null` when no Curricula carry the anchor (graceful — callers
 * fall back to slug-strip labels).
 */
export async function loadQualificationCatalog(
  anchor: string | null | undefined,
): Promise<QualificationCatalog | null> {
  if (!anchor) return null;

  const siblings = await findSiblingCurricula(anchor);
  if (siblings.length === 0) return null;
  const siblingIds = siblings.map((s) => s.id);

  const [moduleRows, curriculumRows] = await Promise.all([
    prisma.curriculumModule.findMany({
      where: { curriculumId: { in: siblingIds } },
      select: {
        slug: true,
        title: true,
        description: true,
        sortOrder: true,
        learningObjectives: {
          select: {
            ref: true,
            description: true,
            performanceStatement: true,
            sortOrder: true,
          },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
    }),
    prisma.curriculum.findMany({
      where: { id: { in: siblingIds } },
      select: { crossCuttingSkillsConfig: true },
    }),
  ]);

  const units = new Map<string, UnitCatalogEntry>();
  const loToModule = new Map<string, string>();
  for (const row of moduleRows) {
    if (!row.slug) continue;
    if (!units.has(row.slug)) {
      units.set(row.slug, {
        slug: row.slug,
        title: row.title,
        description: row.description,
        sortOrder: row.sortOrder,
        learningObjectives: [],
      });
    }
    const unit = units.get(row.slug)!;
    const existingRefs = new Set(unit.learningObjectives.map((lo) => lo.ref));
    for (const lo of row.learningObjectives) {
      if (!lo.ref || existingRefs.has(lo.ref)) continue;
      unit.learningObjectives.push({
        ref: lo.ref,
        description: lo.description,
        performanceStatement: lo.performanceStatement,
        sortOrder: lo.sortOrder,
      });
      loToModule.set(lo.ref, row.slug);
    }
  }
  for (const unit of units.values()) {
    unit.learningObjectives.sort((a, b) => a.sortOrder - b.sortOrder || a.ref.localeCompare(b.ref));
  }

  const skills = new Map<string, SkillCatalogEntry>();
  for (const curr of curriculumRows) {
    const skillEntries = readSkillsFromConfig(curr.crossCuttingSkillsConfig);
    for (const skill of skillEntries) {
      if (!skills.has(skill.ref)) skills.set(skill.ref, skill);
    }
  }

  return { anchor, units, loToModule, skills };
}

/**
 * Resolve a module slug to its display title. Returns the slug-stripped
 * fallback when the catalog has no entry (graceful when a learner has
 * mastery rows for a slug that's been removed from the catalog).
 */
export function getUnitDisplayName(
  moduleSlug: string,
  catalog: QualificationCatalog | null | undefined,
): string {
  const entry = catalog?.units.get(moduleSlug);
  if (entry?.title) return entry.title;
  return stripSlugToTitle(moduleSlug);
}

/**
 * Resolve an LO ref to its display label (verbatim regulated wording from
 * `LearningObjective.description`).
 *
 * `moduleSlug` is optional — the catalog has a global `loToModule` map so
 * cross-module ref lookups still resolve. Falls back to the ref itself when
 * unresolved.
 */
export function getLoDisplayName(
  loRef: string,
  catalog: QualificationCatalog | null | undefined,
  moduleSlug?: string,
): string {
  if (!catalog) return loRef;
  const resolvedModuleSlug = moduleSlug ?? catalog.loToModule.get(loRef);
  if (!resolvedModuleSlug) return loRef;
  const unit = catalog.units.get(resolvedModuleSlug);
  const lo = unit?.learningObjectives.find((entry) => entry.ref === loRef);
  return lo?.description?.trim() || loRef;
}

/**
 * Resolve an LO ref to the learner-friendly rewrite (performanceStatement)
 * when present, else fall back to the verbatim description. Used by the
 * dashboard's expanded LO view.
 */
export function getLoLearnerStatement(
  loRef: string,
  catalog: QualificationCatalog | null | undefined,
  moduleSlug?: string,
): string {
  if (!catalog) return loRef;
  const resolvedModuleSlug = moduleSlug ?? catalog.loToModule.get(loRef);
  if (!resolvedModuleSlug) return loRef;
  const unit = catalog.units.get(resolvedModuleSlug);
  const lo = unit?.learningObjectives.find((entry) => entry.ref === loRef);
  return lo?.performanceStatement?.trim() || lo?.description?.trim() || loRef;
}

/**
 * Resolve a cross-cutting skill ref to its display name. Falls back to the
 * ref itself when no per-Curriculum skill config has been populated yet.
 */
export function getSkillDisplayName(
  skillRef: string,
  catalog: QualificationCatalog | null | undefined,
): string {
  const entry = catalog?.skills.get(skillRef);
  return entry?.name?.trim() || skillRef;
}

/**
 * Infer the course-type display label from a Playbook config blob. The
 * production pilot's three CIO/CTO courses map as follows:
 *
 *   useFreshMastery: true                       → "Exam Assessment"
 *   maxMasteryTier: "DEVELOPING" | "FOUNDATION" → "Pop Quiz"
 *   neither set                                 → "Revision Aid"
 *
 * Explicit `courseTypeLabel` in config overrides the inference. Future
 * non-CIO/CTO product lines can register their own label via that field
 * without changing this helper.
 */
export function getCourseTypeDisplayName(
  playbookConfig: unknown,
): string {
  if (playbookConfig && typeof playbookConfig === "object") {
    const cfg = playbookConfig as Record<string, unknown>;
    if (typeof cfg.courseTypeLabel === "string" && cfg.courseTypeLabel.trim()) {
      return cfg.courseTypeLabel.trim();
    }
    if (cfg.useFreshMastery === true) return "Exam Assessment";
    if (typeof cfg.maxMasteryTier === "string") {
      const cap = cfg.maxMasteryTier.toUpperCase();
      if (cap === "DEVELOPING" || cap === "FOUNDATION") return "Pop Quiz";
    }
  }
  return "Revision Aid";
}

/**
 * Slug-to-title fallback. Used when the catalog has no entry — preserves
 * legibility ("standard-unit-04-it-operations-infrastructure" →
 * "Standard Unit 04 IT Operations Infrastructure"). Intentionally simple;
 * the real title in `CurriculumModule.title` should be preferred.
 */
export function stripSlugToTitle(slug: string): string {
  if (!slug) return "";
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0]?.toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * Parse the `Curriculum.crossCuttingSkillsConfig` JSON column into a flat
 * list of skill entries. Tolerant of legacy/partial shapes — anything that
 * doesn't conform to `{ skills: [...] }` returns an empty list.
 */
function readSkillsFromConfig(config: unknown): SkillCatalogEntry[] {
  if (!config || typeof config !== "object") return [];
  const cfg = config as Record<string, unknown>;
  const list = cfg.skills;
  if (!Array.isArray(list)) return [];
  const out: SkillCatalogEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const ref = typeof row.ref === "string" ? row.ref : null;
    const name = typeof row.name === "string" ? row.name : null;
    if (!ref || !name) continue;
    const rubric = row.tierRubric;
    out.push({
      ref,
      name,
      tierRubric:
        rubric && typeof rubric === "object" && !Array.isArray(rubric)
          ? (rubric as Record<string, string>)
          : null,
    });
  }
  return out;
}
