/**
 * @api GET /api/courses/[courseId]/skills-framework
 *
 * Reads the Skills Framework projection for one course and returns the
 * structured rubric the educator authored: skills × tiers × descriptors,
 * plus per-skill target value + parameter binding.
 *
 * Auth: OPERATOR+ (matches Course Detail tab conventions). STUDENT
 * doesn't see this — it's the educator's structural view of the
 * framework they designed.
 *
 * Sprint 2 SP2-B from the Skills Framework Inspector epic. Backs the
 * Framework Map lens at `/x/courses/[courseId]?tab=skills&v=3`.
 *
 * Data sources:
 *   - `resolveAllSkillsForPlaybook(courseId)` for the BehaviorTarget +
 *     Parameter + tierScheme tuples (PR #1569)
 *   - `ContentAssertion(category: skill_framework)` for raw descriptor
 *     text — the educator's prose from the course-ref doc, preserved
 *     verbatim for provenance
 *   - `Parameter.config` for per-skill bandThresholds + description
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveAllSkillsForPlaybook } from "@/lib/curriculum/resolve-skill";

export interface SkillsFrameworkSkill {
  skillRef: string;
  parameterId: string;
  /** Display name from the Parameter — typically the slugified skill name. */
  parameterName: string;
  description: string | null;
  targetValue: number;
  tierScheme: string[];
  /** Map of tier name (lowercase) → descriptor text from the course-ref doc. */
  tiers: Record<string, string>;
  /** Optional per-band descriptors (IELTS-style 9-band) keyed by band number. */
  bandThresholds: Record<string, string> | null;
}

export interface SkillsFrameworkResponse {
  courseId: string;
  playbookStatus: string;
  skills: SkillsFrameworkSkill[];
  /** When projection has emitted no skill_* params, the educator likely needs
   *  to add a `## Skills Framework` section to the course-ref doc. */
  empty: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) return auth.error;

  const playbook = await prisma.playbook.findUnique({
    where: { id: courseId },
    select: { id: true, status: true },
  });
  if (!playbook) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const skills = await resolveAllSkillsForPlaybook(courseId);

  // Build parameterIds to fetch descriptions + bandThresholds in one round-trip.
  const parameterIds = skills.map((s) => s.parameterId);
  const parameters = parameterIds.length
    ? await prisma.parameter.findMany({
        where: { parameterId: { in: parameterIds } },
        select: { parameterId: true, name: true, definition: true, config: true },
      })
    : [];
  const paramById = new Map(parameters.map((p) => [p.parameterId, p]));

  // ContentAssertion rows tagged `skill_framework` carry the educator's
  // raw tier descriptor text from the course-ref doc. ContentAssertion's
  // playbook link is via the ContentSource → PlaybookSource join — no
  // direct playbookId column.
  const skillAssertions = await prisma.contentAssertion.findMany({
    where: {
      category: "skill_framework",
      source: {
        playbookSources: { some: { playbookId: courseId } },
      },
    },
    select: { id: true, assertion: true, section: true, chapter: true, tags: true },
    take: 200,
  });

  // Group assertions by skill — first by `tags` containing the SKILL-NN ref,
  // falling back to `section` containing the parameter slug.
  function assertionsForSkill(skillRef: string, parameterName: string): string[] {
    return skillAssertions
      .filter(
        (a) =>
          (a.tags ?? []).some((t) => t.toLowerCase() === skillRef.toLowerCase()) ||
          (a.section ?? "").toLowerCase().includes(parameterName.toLowerCase()),
      )
      .map((a) => a.assertion);
  }

  const response: SkillsFrameworkResponse = {
    courseId,
    playbookStatus: playbook.status,
    skills: skills.map((s) => {
      const param = paramById.get(s.parameterId);
      const cfg = (param?.config as Record<string, unknown> | null) ?? {};
      const tiersFromConfig = (cfg.tiers as Record<string, string> | undefined) ?? {};
      const bandThresholds =
        (cfg.bandThresholds as Record<string, string> | undefined) ?? null;
      const parameterName = param?.name ?? s.parameterId;

      // Tier descriptors: prefer Parameter.config.tiers (written by
      // apply-projection at create time); fall back to ContentAssertion text
      // when the educator re-uploaded after a parser extension.
      const tiers: Record<string, string> = { ...tiersFromConfig };
      if (Object.keys(tiers).length === 0) {
        const text = assertionsForSkill(s.skillRef, parameterName);
        if (text.length > 0) {
          // Place all unmatched text under the top tier as a placeholder.
          // Sprint 3 SP3-B (Source Lineage lens) will format this richer.
          tiers[s.tierScheme[s.tierScheme.length - 1] ?? "secure"] = text.join(" · ");
        }
      }

      return {
        skillRef: s.skillRef,
        parameterId: s.parameterId,
        parameterName,
        description: param?.definition ?? null,
        targetValue: s.targetValue,
        // resolveAllSkillsForPlaybook returns readonly[] for safety; the API
        // serialises as a plain array so client consumers get string[].
        tierScheme: [...s.tierScheme],
        tiers,
        bandThresholds,
      };
    }),
    empty: skills.length === 0,
  };

  return NextResponse.json(response);
}
