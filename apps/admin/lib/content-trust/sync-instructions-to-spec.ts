/**
 * Sync Instruction Assertions to Identity Spec
 *
 * After extraction, instruction-category assertions (teaching_rule,
 * session_flow, scaffolding_technique, etc.) are synced into the
 * per-course identity spec overlay. This makes them part of the
 * identity merge chain (course → domain → archetype) rather than
 * rendering as a standalone ## COURSE RULES section.
 *
 * Category → Config Key Mapping:
 *   communication_rule, scaffolding_technique, differentiation → styleGuidelines[]
 *   teaching_rule, edge_case → constraints[] (stacked via merge)
 *   session_flow → parameters[].config.opening/main/closing
 *   skill_framework → parameters[].config.principles[]
 *   assessment_approach → parameters[].config.methods[]
 */

import { prisma } from "@/lib/prisma";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";

export async function syncInstructionsToIdentitySpec(playbookId: string): Promise<void> {
  // 1. Find the playbook and its domain
  const playbook = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: { id: true, domainId: true },
  });
  if (!playbook?.domainId) return;

  // 2. Find the course overlay spec (linked via PlaybookItem at negative sortOrder)
  const courseItem = await prisma.playbookItem.findFirst({
    where: {
      playbookId,
      itemType: "SPEC",
      spec: { specRole: "IDENTITY", extendsAgent: { not: null } },
      sortOrder: { lt: 0 },
    },
    include: { spec: { select: { id: true, slug: true, config: true } } },
  });
  if (!courseItem?.spec) return;

  // 3. Load instruction-category assertions for this playbook's content scope
  const { subjects } = await getSubjectsForPlaybook(playbookId, playbook.domainId);
  const sourceIds = [...new Set(subjects.flatMap((s) => s.sources.map((ss) => ss.sourceId)))];
  if (sourceIds.length === 0) return;

  const instructions = await prisma.contentAssertion.findMany({
    where: {
      sourceId: { in: sourceIds },
      category: { in: [...INSTRUCTION_CATEGORIES] },
    },
    select: { assertion: true, category: true, chapter: true },
    orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    take: 200,
  });
  if (instructions.length === 0) return;

  // 4. Map categories to identity spec config keys
  const styleGuidelines: string[] = [];
  const constraints: string[] = [];
  const sessionFlow: { opening?: string[]; main?: string[]; closing?: string[] } = {};
  const assessmentPrinciples: string[] = [];
  const assessmentMethods: string[] = [];

  for (const inst of instructions) {
    const text = inst.assertion;
    switch (inst.category) {
      case "communication_rule":
      case "scaffolding_technique":
      case "differentiation":
        styleGuidelines.push(text);
        break;
      case "teaching_rule":
      case "edge_case":
        constraints.push(text);
        break;
      case "session_flow": {
        const phase = inst.chapter?.toLowerCase().includes("open") ? "opening"
          : inst.chapter?.toLowerCase().includes("clos") ? "closing"
          : "main";
        if (!sessionFlow[phase]) sessionFlow[phase] = [];
        sessionFlow[phase]!.push(text);
        break;
      }
      case "skill_framework":
        assessmentPrinciples.push(text);
        break;
      case "assessment_approach":
        assessmentMethods.push(text);
        break;
    }
  }

  // 5. Build config update — replace course_instructions param (idempotent on re-sync)
  const existingConfig = (courseItem.spec.config as Record<string, unknown>) || {};
  const existingParams = (existingConfig.parameters as Array<{ id?: string }>) || [];

  const instrParam = {
    id: "course_instructions",
    name: "Course Teaching Rules",
    section: "identity",
    config: {
      ...(styleGuidelines.length > 0 ? { styleGuidelines } : {}),
      ...(sessionFlow.opening ? { opening: sessionFlow.opening } : {}),
      ...(sessionFlow.main ? { main: sessionFlow.main } : {}),
      ...(sessionFlow.closing ? { closing: sessionFlow.closing } : {}),
      ...(assessmentPrinciples.length > 0 ? { principles: assessmentPrinciples } : {}),
      ...(assessmentMethods.length > 0 ? { methods: assessmentMethods } : {}),
    },
  };

  // Replace existing course_instructions param or append
  const otherParams = existingParams.filter((p) => p.id !== "course_instructions");
  const updatedConfig = {
    ...existingConfig,
    parameters: [...otherParams, instrParam],
    constraints: [...((existingConfig.constraints as string[]) || []).filter(
      (c) => !constraints.includes(c) // dedup on re-sync
    ), ...constraints],
    _syncedFromAssertions: true,
    _syncedAt: new Date().toISOString(),
  };

  // 6. Save
  await prisma.analysisSpec.update({
    where: { id: courseItem.spec.id },
    data: { config: updatedConfig as any, isDirty: true },
  });

  console.log(
    `[sync-instructions] Synced ${instructions.length} instruction assertions → ${courseItem.spec.slug} (${styleGuidelines.length} style, ${constraints.length} constraints, ${assessmentPrinciples.length + assessmentMethods.length} assessment)`
  );
}
