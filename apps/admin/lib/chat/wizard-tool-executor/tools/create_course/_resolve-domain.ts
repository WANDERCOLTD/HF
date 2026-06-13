/**
 * Stage 2 of `create_course` — domain resolution.
 *
 * Extracted from the monolithic `create_course.ts` per #1544. Walks the
 * canonical `domainId` cascade — validate AI input, prefer setupData
 * truth, fall back to a DB slug/name lookup, then a safety-net
 * `ensureInstitutionAndDomain` when AI skipped `create_institution` but
 * setupData still carries an `institutionName`. Returns the resolved id
 * or an `is_error: true` payload telling the AI to collect an
 * organisation name first.
 *
 * Behaviour-preserving relative to the pre-extract code at create_course.ts
 * L28-96 with one structural note: the subjectDiscipline guard (L55-70 in
 * the pre-extract file, future Stage 3) used to sit BETWEEN the slug/name
 * lookup and the safety-net. The orchestrator now runs that guard BEFORE
 * calling this helper, so on the unhappy path (missing subjectDiscipline)
 * one DB read (`prisma.domain.findFirst` for the slug fallback) is skipped
 * that pre-extract would have performed. No functional change — the
 * orchestrator early-returns either way, no DB writes occur on either
 * branch, and the dispatcher pins (#1544 Stage 1 graph guard / #607 reuse
 * unlink) both short-circuit before reaching this cascade.
 */

import type { WizardToolExec } from "../../_shared/types";
import { validUuid } from "../../_shared/valid-uuid";
import { ensureInstitutionAndDomain } from "../../_shared/ensure-institution-and-domain";

export interface CreateCourseContext {
  input: Record<string, unknown>;
  userId: string;
  setupData?: Record<string, unknown>;
}

export type ResolveDomainResult =
  | { ok: true; domainId: string }
  | { ok: false; earlyReturn: WizardToolExec };

export async function resolveDomainOrError(
  ctx: CreateCourseContext,
): Promise<ResolveDomainResult> {
  const { input, userId, setupData } = ctx;
  const { prisma } = await import("@/lib/prisma");

  let domainId =
    validUuid(setupData?.existingDomainId) ||
    validUuid(setupData?.draftDomainId) ||
    validUuid(input.domainId);

  if (!domainId && input.domainId && typeof input.domainId === "string") {
    console.warn(
      `[wizard-tools] create_course: rejected invalid domainId from AI: "${input.domainId}" — attempting slug/name lookup`,
    );
    const domain = await prisma.domain.findFirst({
      where: {
        OR: [
          { slug: input.domainId as string },
          { name: { equals: input.domainId as string, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (domain) {
      domainId = domain.id;
      console.log(
        `[wizard-tools] create_course: resolved slug/name "${input.domainId}" → ${domain.id}`,
      );
    }
  }

  if (!domainId && setupData?.institutionName) {
    const result = await ensureInstitutionAndDomain(
      setupData.institutionName as string,
      userId,
      setupData.typeSlug as string | undefined,
    );
    if (result) domainId = result.domainId;
  }

  if (!domainId) {
    return {
      ok: false,
      earlyReturn: {
        content: JSON.stringify({
          ok: false,
          error:
            "No institution set up yet. Ask the user for their organisation name first, then retry.",
        }),
        is_error: true,
      },
    };
  }

  return { ok: true, domainId };
}
