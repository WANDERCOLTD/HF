/**
 * Slice B — CIO/CTO Standard content-quality wiring.
 *
 * Issue: https://github.com/WANDERCOLTD/HF/issues/1076 (slice B follows slice A)
 *
 * What this script writes (idempotent; safe to re-run):
 *   1. Subject `the-standard-cio-cto-subject`:
 *      qualificationBody="SIAS", qualificationRef="The CIO/CTO Standard V6.0",
 *      qualificationLevel="L4", teachingDepth=4 (matches the 4-tier rubric:
 *      Foundation/Developing/Practitioner/Distinction).
 *   2. Per-module metadata (5 modules — Units 04/09/10/16/21):
 *      description, estimatedDurationMinutes (25 = Revision Aid cap),
 *      masteryThreshold (0.75 = Practitioner), keyTerms, assessmentCriteria,
 *      sourceContentId (back-link to per-Unit Qualification Spec ContentSource).
 *   3. Per-LO updates (26 LOs):
 *      performanceStatement (the "learner can…" Practitioner-tier translation
 *      lifted from the Revision Aid course-ref's OUT-NN lines),
 *      masteryThreshold (0.7 = slightly looser than module),
 *      originalText (populated with current `description` since that IS the
 *      verbatim SIAS V6.0 wording — captures the regulated source per #317).
 *
 * Pattern: direct prisma.update() per row. No spec wiring touched — that lives
 * in slice A (fix-cio-cto-playbooks.ts).
 *
 * Run: `npx tsx scripts/fix-cio-cto-slice-b.ts` from apps/admin/.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SUBJECT_ID = "a52307dd-d49c-4c8e-b080-22288aadab43";
const CURRICULUM_ID = "0ccb2874-f2d5-4431-96d0-0c0faf342636";

type ModuleSpec = {
  id: string;
  unitNumber: number;
  title: string;
  description: string;
  qualificationSpecSourceId: string;
  keyTerms: readonly string[];
  assessmentCriteria: readonly string[];
  /** Per-LO updates keyed by `ref` (e.g. "LO1"). */
  los: Record<string, { performanceStatement: string }>;
};

const MODULES: readonly ModuleSpec[] = [
  {
    id: "0e5b761d-813f-4b45-b933-ee31767063c2",
    unitNumber: 4,
    title: "IT Operations and Infrastructure",
    description:
      "Unit 04 of The CIO/CTO Standard. Covers hardware/software/network cost-effectiveness, SLAs aligned to business need, Disaster Recovery and Business Continuity, cybersecurity posture, compliance regimes, system availability and reliability, and proactive monitoring discipline. Seven LOs.",
    qualificationSpecSourceId: "238be484-ee68-49fa-b4ba-ba5d0430f410",
    keyTerms: [
      "service level agreement",
      "disaster recovery",
      "business continuity",
      "RPO",
      "RTO",
      "cybersecurity posture",
      "compliance regime",
      "availability target",
      "reliability target",
      "monitoring discipline",
    ],
    assessmentCriteria: [
      "Defends a cost/performance trade-off in business language a non-IT board member can follow",
      "Reads draft SLAs against business need and surfaces clauses that would silently degrade service",
      "Talks through DR/BC plans from RPO/RTO targets to named accountable owners",
      "Describes cybersecurity posture in terms of specific threats addressed and residual risk owned by named business roles",
      "Maps IT operations to compliance regimes and identifies the highest-residual-risk gap",
      "Articulates availability/reliability targets in business terms (e.g. lost revenue per hour of outage)",
      "Describes a monitoring posture that catches degradation before customer incident, naming the specific signals being watched",
    ],
    los: {
      LO1: { performanceStatement: "The learner can defend a cost/performance trade-off on a hardware, software, or network choice in language a non-IT board member can follow." },
      LO2: { performanceStatement: "The learner can read a draft SLA against business need and identify the clauses that would silently degrade service if signed." },
      LO3: { performanceStatement: "The learner can talk through a Disaster Recovery and Business Continuity plan from RPO/RTO targets to the named accountable owner per scenario." },
      LO4: { performanceStatement: "The learner can describe their organisation's cybersecurity posture in terms of specific threats addressed and residual risk owned by named business roles." },
      LO5: { performanceStatement: "The learner can map their IT operations to the relevant compliance regimes and identify the highest-residual-risk gap on a given day." },
      LO6: { performanceStatement: "The learner can articulate availability and reliability targets in business terms (e.g. lost revenue per hour of outage) and the design choices that protect them." },
      LO7: { performanceStatement: "The learner can describe a monitoring posture that catches degradation before it becomes a customer incident, naming the specific signals being watched." },
    },
  },
  {
    id: "23d4787e-32e6-4458-921b-0782be8363be",
    unitNumber: 9,
    title: "Enterprise and Business Architecture",
    description:
      "Unit 09 of The CIO/CTO Standard. Covers strategic objective alignment, technology roadmaps, IT governance frameworks, technology as business enabler, data-driven decision metrics, architecture principles, and modern/agile stack design. Seven LOs.",
    qualificationSpecSourceId: "04017dd0-c8e1-4d41-8321-463374199d11",
    keyTerms: [
      "strategic alignment",
      "technology roadmap",
      "IT governance framework",
      "TOGAF",
      "Zachman",
      "data-driven decision",
      "architecture principles",
      "modern stack",
      "agile architecture",
    ],
    assessmentCriteria: [
      "Names the organisation's top three strategic objectives and traces in-flight initiatives back to each",
      "Presents a technology roadmap that visibly serves a business outcome (not just an internal IT goal)",
      "Names the IT governance framework in use, describes its central control, and defends the fit",
      "Articulates two specific ways technology has enabled a recent business advantage, with the proving metric",
      "Describes key metrics tracked for IT initiative impact and explains the metric choice",
      "States the architecture principles teams are held to and gives a recent decision that turned on one",
      "Describes the current stack against a modern-and-agile yardstick and identifies the highest-leverage modernisation move",
    ],
    los: {
      LO1: { performanceStatement: "The learner can name the organisation's top three strategic objectives and trace at least one in-flight technology initiative back to each." },
      LO2: { performanceStatement: "The learner can present a technology roadmap that visibly serves a business outcome rather than an internal IT goal." },
      LO3: { performanceStatement: "The learner can name the IT governance framework in use, describe its central control, and explain why that framework fits this organisation." },
      LO4: { performanceStatement: "The learner can articulate at least two specific ways technology has enabled a recent business advantage, with the metric that proves it." },
      LO5: { performanceStatement: "The learner can describe the key metrics tracked for IT initiative impact and explain why those metrics (not others) were chosen." },
      LO6: { performanceStatement: "The learner can state the architecture principles they hold their teams to, and give a recent decision that turned on one of those principles." },
      LO7: { performanceStatement: "The learner can describe their organisation's current stack against a modern-and-agile yardstick and identify the highest-leverage modernisation move." },
    },
  },
  {
    id: "394a1d95-2dfa-4045-84a9-962d2f25dc1e",
    unitNumber: 10,
    title: "Application Definition and Development",
    description:
      "Unit 10 of The CIO/CTO Standard. Covers programming methodologies, quality assurance and testing strategies, language/framework/methodology fluency, and complex technical problem-solving with stakeholder expectation management. Four LOs.",
    qualificationSpecSourceId: "c98cc5ff-0540-48cf-9b3e-2e8bb7fff968",
    keyTerms: [
      "programming methodology",
      "domain-driven design",
      "quality assurance",
      "test automation",
      "framework selection",
      "expectation management",
    ],
    assessmentCriteria: [
      "Picks the right programming methodology for a given project shape and defends it to a sceptical sponsor",
      "Articulates the QA and testing strategy for a delivery, including automation coverage vs time-to-feedback trade-off",
      "Describes the languages, frameworks, and methodologies the teams use and the team-skill-shape rationale",
      "Walks through a recent complex technical decision, the alternatives considered, and how business expectations were managed alongside it",
    ],
    los: {
      LO1: { performanceStatement: "The learner can pick the right programming methodology for a given project shape (e.g. why DDD here and not waterfall) and defend it to a sceptical sponsor." },
      LO2: { performanceStatement: "The learner can articulate the QA and testing strategy for a delivery, including the trade-off between automation coverage and time-to-feedback." },
      LO3: { performanceStatement: "The learner can describe the languages, frameworks, and methodologies their teams use and explain the team-skill-shape rationale behind the stack." },
      LO4: { performanceStatement: "The learner can walk through a recent complex technical decision, the alternatives considered, and how business expectations were managed alongside it." },
    },
  },
  {
    id: "20bbb0f5-c7af-4f32-8619-ce2ddb0a1cc2",
    unitNumber: 16,
    title: "Data and Information Management and Development",
    description:
      "Unit 16 of The CIO/CTO Standard. Covers data strategy, data architecture and integration, analytics and BI for decision support, and responsible data management (security, ethics, lifecycle). Four LOs.",
    qualificationSpecSourceId: "ad30e5e5-cd55-45a2-a915-ca3a92d22606",
    keyTerms: [
      "data strategy",
      "data architecture",
      "systems integration",
      "analytics",
      "business intelligence",
      "data ethics",
      "data lifecycle",
      "data security",
    ],
    assessmentCriteria: [
      "Articulates the data strategy in two sentences and names the business decisions that depend on it",
      "Describes the data architecture against the integration challenges it must solve and names the biggest current constraint",
      "Talks through how analytics and BI feed business decisions, citing specific decisions improved in the last quarter",
      "Describes data security, ethics, and lifecycle posture and identifies the highest residual risk on a named dataset",
    ],
    los: {
      LO1: { performanceStatement: "The learner can articulate their organisation's data strategy in two sentences and name the business decisions that depend on it." },
      LO2: { performanceStatement: "The learner can describe their data architecture against the integration challenges it must solve, and name the integration that is currently the biggest constraint." },
      LO3: { performanceStatement: "The learner can talk through how analytics and BI feed business decisions, including the specific decisions that have been improved by data in the last quarter." },
      LO4: { performanceStatement: "The learner can describe the organisation's data security, ethics, and lifecycle posture and identify the highest residual risk on a named dataset." },
    },
  },
  {
    id: "9429c33b-7205-42ce-836a-5965f7334554",
    unitNumber: 21,
    title: "Strategic Planning and Delivery",
    description:
      "Unit 21 of The CIO/CTO Standard. Covers IT strategy aligned to business goals, governance around strategic plans, IT team resourcing across current operations and strategic priorities, and the practice of staying current on technology trends. Four LOs.",
    qualificationSpecSourceId: "b2e626c9-be57-4690-a758-9bb76a6bed45",
    keyTerms: [
      "IT strategy",
      "strategic alignment",
      "strategic governance",
      "team resourcing",
      "strategic horizon",
      "technology trends",
      "stakeholder expectations",
    ],
    assessmentCriteria: [
      "Articulates the IT strategy in a single page and traces each strategic move back to a named business goal",
      "Describes the governance ritual that holds technology initiatives to their expected outcomes",
      "Describes IT team resourcing against both current operations and strategic priorities, naming the highest-leverage hire or repositioning",
      "Describes a regular practice that keeps them current on technology trends and names a specific decision in the last six months it improved",
    ],
    los: {
      LO1: { performanceStatement: "The learner can articulate the IT strategy in a single page and trace each strategic move back to a named business goal." },
      LO2: { performanceStatement: "The learner can describe the governance ritual that holds technology initiatives to their expected outcomes, including the specific decisions made by that governance in the last quarter." },
      LO3: { performanceStatement: "The learner can describe their IT team resourcing against both current operations and strategic priorities, naming the highest-leverage hire or repositioning currently needed." },
      LO4: { performanceStatement: "The learner can describe a regular practice that keeps them current on technology trends and best practice, and name a specific decision in the last six months that was improved by it." },
    },
  },
] as const;

const MODULE_DEFAULTS = {
  estimatedDurationMinutes: 25,    // matches Revision Aid duration cap (the dominant session for these modules)
  masteryThreshold: 0.75,           // Practitioner tier on the 4-tier rubric (0.25/0.5/0.75/1.0)
};

const LO_DEFAULTS = {
  masteryThreshold: 0.7,            // slightly looser than module — an individual LO can land while the module
                                    // still progresses
};

async function updateSubject() {
  const before = await prisma.subject.findUnique({
    where: { id: SUBJECT_ID },
    select: { qualificationBody: true, qualificationRef: true, qualificationLevel: true, teachingDepth: true },
  });
  const target = {
    qualificationBody: "SIAS",
    qualificationRef: "The CIO/CTO Standard V6.0",
    qualificationLevel: "L4",
    teachingDepth: 4,
  };
  await prisma.subject.update({ where: { id: SUBJECT_ID }, data: target });
  return { before, after: target };
}

async function updateModule(mod: ModuleSpec) {
  const before = await prisma.curriculumModule.findUnique({
    where: { id: mod.id },
    select: {
      description: true, estimatedDurationMinutes: true, masteryThreshold: true,
      keyTerms: true, assessmentCriteria: true, sourceContentId: true,
    },
  });
  const target = {
    description: mod.description,
    estimatedDurationMinutes: MODULE_DEFAULTS.estimatedDurationMinutes,
    masteryThreshold: MODULE_DEFAULTS.masteryThreshold,
    keyTerms: [...mod.keyTerms],
    assessmentCriteria: [...mod.assessmentCriteria],
    sourceContentId: mod.qualificationSpecSourceId,
  };
  await prisma.curriculumModule.update({ where: { id: mod.id }, data: target });
  return { unit: mod.unitNumber, before, after: target };
}

async function updateLOs(mod: ModuleSpec) {
  const los = await prisma.learningObjective.findMany({
    where: { moduleId: mod.id },
    select: { id: true, ref: true, description: true, performanceStatement: true, masteryThreshold: true, originalText: true },
    orderBy: { sortOrder: "asc" },
  });
  let updated = 0;
  let missing = 0;
  for (const lo of los) {
    const spec = mod.los[lo.ref];
    if (!spec) {
      missing++;
      console.warn(`  ⚠ Module Unit ${mod.unitNumber}: no performance statement for ${lo.ref} — skipping`);
      continue;
    }
    await prisma.learningObjective.update({
      where: { id: lo.id },
      data: {
        performanceStatement: spec.performanceStatement,
        masteryThreshold: LO_DEFAULTS.masteryThreshold,
        // Per #317: originalText preserves verbatim source text on first import.
        // It was missed at original import; populate it now from the current `description`
        // (which IS the verbatim SIAS V6.0 wording — confirmed against ContentSource accreditation).
        // Idempotency: only write if currently null, never overwrite a captured original.
        ...(lo.originalText == null ? { originalText: lo.description } : {}),
      },
    });
    updated++;
  }
  return { updated, missing };
}

async function main() {
  console.log("=== Slice B — content quality ===\n");

  console.log("[1/3] Subject update...");
  const subj = await updateSubject();
  console.log(`  before: ${JSON.stringify(subj.before)}`);
  console.log(`  after:  ${JSON.stringify(subj.after)} ✓\n`);

  console.log("[2/3] Module metadata + sourceContentId back-link (5 modules)...");
  for (const mod of MODULES) {
    const res = await updateModule(mod);
    const beforeMissing = !res.before?.description && !res.before?.estimatedDurationMinutes && !res.before?.masteryThreshold;
    console.log(`  Unit ${String(res.unit).padStart(2, "0")}: ${beforeMissing ? "FRESH" : "OVERWROTE"} — duration=${res.after.estimatedDurationMinutes} threshold=${res.after.masteryThreshold} keyTerms=${res.after.keyTerms.length} criteria=${res.after.assessmentCriteria.length} sourceContentId=${res.after.sourceContentId.slice(0, 8)} ✓`);
  }
  console.log();

  console.log("[3/3] LO performanceStatement + masteryThreshold + originalText (26 LOs)...");
  let totalUpdated = 0, totalMissing = 0;
  for (const mod of MODULES) {
    const res = await updateLOs(mod);
    console.log(`  Unit ${String(mod.unitNumber).padStart(2, "0")}: ${res.updated} LO(s) updated, ${res.missing} missing performanceStatement`);
    totalUpdated += res.updated;
    totalMissing += res.missing;
  }
  console.log(`\n  Total: ${totalUpdated} updated, ${totalMissing} missing (expected 26 updated, 0 missing)`);

  console.log("\n[done] Slice B complete. Re-run is idempotent (overwrites Subject/Module/LO fields; preserves LO.originalText once set).");
}

main()
  .catch((e) => {
    console.error("[slice-b] FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
