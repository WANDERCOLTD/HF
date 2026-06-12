import type { WizardToolExec } from "../_shared/types";

export async function execute(
  _input: Record<string, unknown>,
  _userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // #317 follow-up: previously this returned "Setup complete" with no
  // precondition checks. If create_course had failed (e.g. BLOCKED on
  // missing fields, or backgrounded curriculum-gen task didn't persist),
  // the user was shown a misleading success card. Now: must have a real
  // Playbook AND a real Curriculum with modules in the DB before we
  // declare setup complete.
  const draftPbId = (setupData?.draftPlaybookId as string | undefined) ?? null;
  if (!draftPbId) {
    console.warn(`[wizard-tools] mark_complete BLOCKED — no draftPlaybookId in setupData`);
    return {
      content: JSON.stringify({
        ok: false,
        error:
          "Cannot mark complete — no course has been created yet. Call create_course first; check the response includes a playbook ID.",
      }),
      is_error: true,
    };
  }
  const { prisma } = await import("@/lib/prisma");
  const pb = await prisma.playbook.findUnique({
    where: { id: draftPbId },
    select: {
      id: true,
      name: true,
      // #1205 — canonical PlaybookCurriculum primary join.
      playbookCurricula: {
        where: { role: "primary" },
        take: 1,
        select: {
          curriculum: {
            select: { id: true, _count: { select: { modules: true } } },
          },
        },
      },
    },
  });
  if (!pb) {
    console.warn(`[wizard-tools] mark_complete BLOCKED — playbook ${draftPbId} not found in DB`);
    return {
      content: JSON.stringify({
        ok: false,
        error: `Cannot mark complete — playbook ${draftPbId} is referenced in setupData but doesn't exist in the database. Re-run create_course.`,
      }),
      is_error: true,
    };
  }
  const cur = pb.playbookCurricula[0]?.curriculum;
  if (!cur || cur._count.modules === 0) {
    console.warn(`[wizard-tools] mark_complete BLOCKED — playbook ${draftPbId} has no curriculum modules`);
    return {
      content: JSON.stringify({
        ok: false,
        error: `Cannot mark complete — course "${pb.name}" exists but has no curriculum modules yet. Curriculum generation may still be running, or it failed silently. Check the curriculum-generation UserTask, or invoke generate_curriculum.`,
      }),
      is_error: true,
    };
  }
  console.log(`[wizard-tools] mark_complete: playbook ${draftPbId} verified — ${cur._count.modules} modules persisted`);
  return { content: "Setup complete. The user can now try a sim call." };
}
