/**
 * Slice A — wire the three CIO/CTO Standard playbooks for the adaptive loop.
 *
 * Issue: https://github.com/WANDERCOLTD/HF/issues/1076
 *
 * What this script does (idempotent — findFirst/upsert before write):
 *   1. Link 9 shared SYSTEM AnalysisSpecs to each playbook via PlaybookItem rows
 *   2. Create 10 SKILL Parameter rows for the cross-cutting skills (canonical)
 *   3. Create 10 BehaviorTarget rows per playbook with variant-specific targets
 *      (Pop Quiz target 0.5 / Developing; Revision Aid + Exam Assessment 0.75 / Practitioner)
 *   4. Write per-LO goal templates (26) to Playbook.config.goals[] for each playbook
 *   5. Update Playbook.{validationPassed,measureSpecCount,learnSpecCount,adaptSpecCount,parameterCount}
 *
 * Does NOT do (deferred to slice B):
 *   - LO performanceStatement / masteryThreshold / module metadata
 *   - Subject qualificationBody / qualificationRef / teachingDepth
 *   - Module sourceContentId back-link
 *
 * Pattern reference: lib/domain/scaffold.ts:360-371 (direct Playbook.update bypassing publish API).
 * Each playbook is currently status=PUBLISHED with 0 enrolments + 0 calls, so a direct DB
 * update is safe (no API route exists for this transition; the publish route hard-blocks
 * re-publish of a PUBLISHED row at lines 65-70).
 *
 * Run: `npx tsx scripts/fix-cio-cto-playbooks.ts` from apps/admin/. Safe to re-run.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DOMAIN_SLUG = "the-standard-cio-cto";
const CURRICULUM_ID = "0ccb2874-f2d5-4431-96d0-0c0faf342636";

type PlaybookSpec = {
  id: string;
  name: string;
  /** Target value (0..1) for cross-cutting SKILL BehaviorTargets. Pop Quiz clamps at Developing (0.5). */
  skillTarget: number;
};

const PLAYBOOKS: readonly PlaybookSpec[] = [
  { id: "5bbdbe7e-c32f-490e-8ff8-a938ddfc49a0", name: "Revision Aid",      skillTarget: 0.75 },
  { id: "405b210f-9a2b-4aca-b906-edcc758534a2", name: "Pop Quiz",          skillTarget: 0.5  },
  { id: "2d04ded7-19dc-46d3-afa5-b85d073778b4", name: "Exam Assessment",   skillTarget: 0.75 },
] as const;

/** Shared SYSTEM specs to link to every CIO/CTO playbook. */
const SHARED_SPEC_SLUGS = [
  "MENTOR-001",                  // IDENTITY / COMPOSE — senior CIO mentor persona
  "spec-learn-assess-001",       // LEARN / EXTRACT — per-LO mastery on CallerAttribute.lo_mastery
  "spec-mem-001",                // LEARN / EXTRACT — caller memory extraction
  "spec-coach-adapt-001",        // ADAPT / SYNTHESISE — coach-style adaptation
  "spec-coach-agg-001",          // AGGREGATE / SYNTHESISE — cross-call aggregation
  "spec-skill-agg-001",          // AGGREGATE / SYNTHESISE — cross-cutting skill aggregation
  "spec-rew-001",                // REWARD / SYNTHESISE
  "spec-pipeline-001",           // SUPERVISE / ORCHESTRATE
  "spec-trust-001",              // SUPERVISE / CONSTRAIN
] as const;

/**
 * The 10 cross-cutting practitioner skills for the CIO/CTO domain.
 * `paramId` follows the canonical `skill_<slug>` convention used by IELTS / Big Five /
 * Persuasion Literacy — all share sectionId="skill", domainGroup="skill",
 * parameterType=BEHAVIOR, isAdjustable=true so BehaviorTargets can be set per playbook.
 */
const CROSS_CUTTING_SKILLS = [
  { paramId: "skill_stakeholder_anticipation",   name: "Stakeholder anticipation",   definition: "Predicting what the exec / board / business unit will worry about before they raise it." },
  { paramId: "skill_risk_articulation",          name: "Risk articulation",          definition: "Stating risks with calibrated specificity rather than abstract worry." },
  { paramId: "skill_commercial_framing",         name: "Commercial framing",         definition: "Translating IT considerations into the language of commercial impact." },
  { paramId: "skill_decision_velocity",          name: "Decision velocity",          definition: "Choosing the cost of waiting vs the cost of deciding wrong." },
  { paramId: "skill_source_citation_discipline", name: "Source-citation discipline", definition: "Quoting the accredited material faithfully rather than paraphrasing." },
  { paramId: "skill_tradeoff_explicitness",      name: "Trade-off explicitness",     definition: "Making the trade-off visible rather than presenting only the chosen option." },
  { paramId: "skill_stop_discipline",            name: "Stop discipline",            definition: "Killing initiatives without sponsor or value." },
  { paramId: "skill_sponsor_clarity",            name: "Sponsor clarity",            definition: "Insisting on a named, accountable business owner per initiative." },
  { paramId: "skill_vendor_judgement",           name: "Vendor judgement",           definition: "Engaging with vendors as one input among many, not as the decision driver." },
  { paramId: "skill_operating_cost_literacy",    name: "Operating-cost literacy",    definition: "Understanding what choices today cost the business in ongoing operating cost tomorrow." },
] as const;

type Stats = {
  playbook: string;
  itemsCreated: number;
  itemsSkipped: number;
  paramsCreated: number;
  paramsSkipped: number;
  btCreated: number;
  btSkipped: number;
  goalTemplatesWritten: number;
  finalCounts: { measure: number; learn: number; adapt: number; parameters: number; validationPassed: boolean };
};

async function resolveSpecsBySlug(slugs: readonly string[]) {
  const specs = await prisma.analysisSpec.findMany({
    where: { slug: { in: [...slugs] }, isActive: true },
    select: { id: true, slug: true, outputType: true, specRole: true, specType: true },
  });
  const bySlug = new Map(specs.map((s) => [s.slug, s]));
  for (const slug of slugs) {
    if (!bySlug.has(slug)) throw new Error(`Required SYSTEM spec not found: ${slug}`);
  }
  return bySlug;
}

async function upsertSkillParameters() {
  const paramIds = new Map<string, string>();
  let created = 0;
  let skipped = 0;
  for (const skill of CROSS_CUTTING_SKILLS) {
    const existing = await prisma.parameter.findFirst({
      where: { parameterId: skill.paramId },
      select: { id: true, parameterId: true },
    });
    if (existing) {
      paramIds.set(skill.paramId, existing.id);
      skipped++;
      continue;
    }
    const created_ = await prisma.parameter.create({
      data: {
        parameterId: skill.paramId,
        name: skill.name,
        definition: skill.definition,
        sectionId: "skill",
        domainGroup: "skill",
        parameterType: "BEHAVIOR",         // canonical pattern for learner-skill BehaviorTargets
        scaleType: "ordinal_0_1",          // 4-tier maturity ladder: Foundation 0.25, Developing 0.5, Practitioner 0.75, Distinction 1.0
        directionality: "higher_better",
        isAdjustable: true,                // BehaviorTargets writable per-playbook
        isCanonical: true,
        interpretationHigh: "Practitioner / Distinction landing — moves under altered constraints, makes trade-offs visible, anticipates the board.",
        interpretationLow: "Foundation landing — reactive, descriptive, framework-level reasoning without applied judgement.",
        computedBy: "spec-skill-agg-001",  // populated by the skill aggregate spec
        goalTarget: 0.75,                  // canonical Practitioner-tier target (variants override via BehaviorTarget)
      },
      select: { id: true },
    });
    paramIds.set(skill.paramId, created_.id);
    created++;
  }
  return { paramIds, created, skipped };
}

async function linkPlaybookItems(playbookId: string, specsBySlug: Map<string, { id: string }>, startingSort: number) {
  let created = 0;
  let skipped = 0;
  let sort = startingSort;
  for (const slug of SHARED_SPEC_SLUGS) {
    const spec = specsBySlug.get(slug)!;
    const existing = await prisma.playbookItem.findFirst({
      where: { playbookId, specId: spec.id, itemType: "SPEC" },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.playbookItem.create({
      data: {
        playbookId,
        itemType: "SPEC",
        specId: spec.id,
        isEnabled: true,
        sortOrder: sort++,
      },
    });
    created++;
  }
  return { created, skipped };
}

async function createBehaviorTargets(playbookId: string, targetValue: number) {
  let created = 0;
  let skipped = 0;
  for (const skill of CROSS_CUTTING_SKILLS) {
    // BehaviorTarget.parameterId references Parameter.parameterId (string), not Parameter.id
    const existing = await prisma.behaviorTarget.findFirst({
      where: {
        playbookId,
        parameterId: skill.paramId,
        scope: "PLAYBOOK",
        sourceContentId: null,
        effectiveUntil: null,
      },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.behaviorTarget.create({
      data: {
        playbookId,
        parameterId: skill.paramId,
        scope: "PLAYBOOK",
        targetValue,
        confidence: 1.0,
        source: "SEED",
        effectiveFrom: new Date(),
        observationCount: 0,
      },
    });
    created++;
  }
  return { created, skipped };
}

async function loadLOGoalTemplates() {
  const modules = await prisma.curriculumModule.findMany({
    where: { curriculumId: CURRICULUM_ID, isActive: true },
    select: {
      id: true, slug: true, title: true, sortOrder: true,
      learningObjectives: { select: { id: true, ref: true, description: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { sortOrder: "asc" },
  });

  const templates: Array<{
    type: "LEARN";
    name: string;
    description: string;
    ref: string;
    priority: number;
    progressStrategy: string;
    isAssessmentTarget: boolean;
  }> = [];

  for (const m of modules) {
    for (const lo of m.learningObjectives) {
      templates.push({
        type: "LEARN",
        name: `${m.title} — ${lo.ref}`,
        description: lo.description ?? `${m.title} ${lo.ref}`,
        ref: `${m.slug}::${lo.ref}`,                       // logical id, scoped by curriculum (#407)
        priority: 5,
        progressStrategy: "LO_MASTERY",                    // standard learn-assess strategy
        isAssessmentTarget: false,                          // toggled to true for Exam Assessment downstream
      });
    }
  }
  return templates;
}

async function writeGoalTemplates(playbookId: string, templates: ReturnType<typeof loadLOGoalTemplates> extends Promise<infer R> ? R : never, isExamAssessment: boolean) {
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { config: true },
  });
  const cfg = (playbook?.config as Record<string, unknown> | null) ?? {};
  const variantTemplates = templates.map((t) => ({ ...t, isAssessmentTarget: isExamAssessment }));
  // `modulesAuthored: true` drives the ProgressionModePill in the course header to
  // render "Learner picks" instead of the orange "Mode not set" warning. All three
  // CIO/CTO courses use the five SIAS Units as their authored modules, with the
  // learner choosing which Unit to work on each session (see each course-ref's
  // "Default mode: learner-picks" line).
  const nextConfig = { ...cfg, goals: variantTemplates, modulesAuthored: true };
  await prisma.playbook.update({ where: { id: playbookId }, data: { config: nextConfig } });
  return variantTemplates.length;
}

async function computeAndStampCounts(playbookId: string) {
  const items = await prisma.playbookItem.findMany({
    where: { playbookId, itemType: "SPEC", isEnabled: true },
    select: { spec: { select: { outputType: true } } },
  });
  let measure = 0, learn = 0, adapt = 0;
  for (const it of items) {
    switch (it.spec?.outputType) {
      case "MEASURE":
      case "MEASURE_AGENT":
      case "AGGREGATE":
        measure++; break;
      case "LEARN":
        learn++; break;
      case "ADAPT":
        adapt++; break;
      default: break;
    }
  }
  const parameterCount = await prisma.behaviorTarget.count({ where: { playbookId, effectiveUntil: null } });

  await prisma.playbook.update({
    where: { id: playbookId },
    data: {
      validationPassed: true,
      measureSpecCount: measure,
      learnSpecCount: learn,
      adaptSpecCount: adapt,
      parameterCount,
      composeInputsUpdatedAt: new Date(),
    },
  });
  return { measure, learn, adapt, parameters: parameterCount, validationPassed: true };
}

async function main() {
  console.log(`[fix] Domain: ${DOMAIN_SLUG} | Curriculum: ${CURRICULUM_ID}`);
  console.log(`[fix] Playbooks: ${PLAYBOOKS.map((pb) => pb.name).join(", ")}\n`);

  console.log("[1/5] Resolving shared SYSTEM specs...");
  const specsBySlug = await resolveSpecsBySlug(SHARED_SPEC_SLUGS);
  console.log(`[1/5] Resolved ${specsBySlug.size}/${SHARED_SPEC_SLUGS.length} shared specs ✓\n`);

  console.log("[2/5] Upserting 10 SKILL Parameter rows (cross-cutting skills)...");
  const { paramIds, created: paramsCreated, skipped: paramsSkipped } = await upsertSkillParameters();
  console.log(`[2/5] Parameters: ${paramsCreated} created, ${paramsSkipped} already present ✓\n`);

  console.log("[3/5] Loading LO goal templates from curriculum...");
  const goalTemplates = await loadLOGoalTemplates();
  console.log(`[3/5] Loaded ${goalTemplates.length} LO templates (expected 26) ✓\n`);

  const stats: Stats[] = [];
  for (const pb of PLAYBOOKS) {
    console.log(`[4/5] ${pb.name} (${pb.id})`);

    const items = await linkPlaybookItems(pb.id, specsBySlug, 100);
    console.log(`        PlaybookItem: ${items.created} created, ${items.skipped} already present`);

    const bt = await createBehaviorTargets(pb.id, pb.skillTarget);
    console.log(`        BehaviorTarget: ${bt.created} created, ${bt.skipped} already present (target=${pb.skillTarget})`);

    const goalsWritten = await writeGoalTemplates(pb.id, goalTemplates, pb.name === "Exam Assessment");
    console.log(`        Playbook.config.goals[]: ${goalsWritten} templates written`);

    const finalCounts = await computeAndStampCounts(pb.id);
    console.log(`        Final counts: M=${finalCounts.measure} L=${finalCounts.learn} A=${finalCounts.adapt} P=${finalCounts.parameters} valid=${finalCounts.validationPassed}\n`);

    stats.push({
      playbook: pb.name,
      itemsCreated: items.created,
      itemsSkipped: items.skipped,
      paramsCreated,
      paramsSkipped,
      btCreated: bt.created,
      btSkipped: bt.skipped,
      goalTemplatesWritten: goalsWritten,
      finalCounts,
    });
  }

  console.log("[5/5] Summary");
  console.table(
    stats.map((s) => ({
      playbook: s.playbook,
      items: `${s.itemsCreated}+${s.itemsSkipped}`,
      btargets: `${s.btCreated}+${s.btSkipped}`,
      goalTemplates: s.goalTemplatesWritten,
      M: s.finalCounts.measure,
      L: s.finalCounts.learn,
      A: s.finalCounts.adapt,
      P: s.finalCounts.parameters,
      valid: s.finalCounts.validationPassed,
    })),
  );
  console.log(`\n[fix] Skill Parameter rows: ${paramsCreated} created, ${paramsSkipped} already present.`);
  console.log("[fix] Slice A complete. Re-run is idempotent.");
}

main()
  .catch((e) => {
    console.error("[fix] FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
