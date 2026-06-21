/**
 * Domain-wide compose-staleness fanout — A4 of epic #2225.
 *
 * When a `Domain`-scoped compose-affecting write lands (currently only
 * `Domain.onboardingIdentitySpecId` flows through the journey-setting
 * PATCH route — see `app/api/courses/[courseId]/journey-setting/route.ts`),
 * the staleness signal must reach every dependent Playbook's section
 * cache.
 *
 * The domain-level coarse signal — `Domain.composeInputsUpdatedAt` — is
 * already bumped by `updateDomainConfig` and read by the
 * staleness check at `lib/compose/staleness.ts::isPromptStale` (the
 * Domain timestamp is one of the four scope rows compared against
 * `ComposedPrompt.composedAt`). That covers prompt-level staleness for
 * every caller in every dependent playbook for free.
 *
 * This helper handles the SECTION-grain signal —
 * `PlaybookSectionStaleness` rows are keyed on `(playbookId, sectionKey)`
 * so a Domain write needs to bump the same `(playbookId, sectionKey)`
 * pair for EVERY playbook in the domain. Without this, section-grain
 * staleness banners in the Inspector would miss domain-rooted edits.
 *
 * Per `bumpPlaybookComposeTimestamp` defensive contract: best-effort,
 * silent on missing rows, never throws.
 */

import { prisma } from "@/lib/prisma";
import { bumpSectionHash } from "./section-staleness";
import type { ComposeSectionKey } from "./section";

/**
 * Bump section-staleness for the given `sectionKey` on every Playbook
 * in the given Domain. Returns the list of affected playbook ids
 * (useful for response telemetry).
 *
 * Fire-and-forget caller pattern — domain writes have already committed
 * by the time this runs; lazy recompose still covers any per-playbook
 * miss via the Domain-level timestamp check.
 */
export async function bumpDomainSectionStaleness(
  domainId: string,
  sectionKeys: readonly ComposeSectionKey[],
  inputs: unknown,
): Promise<string[]> {
  if (!domainId || sectionKeys.length === 0) return [];

  const playbooks = await prisma.playbook.findMany({
    where: { domainId },
    select: { id: true },
  });
  const playbookIds = playbooks.map((p) => p.id);

  await Promise.all(
    playbookIds.flatMap((playbookId) =>
      sectionKeys.map((sectionKey) =>
        bumpSectionHash(playbookId, sectionKey, inputs).catch((err) => {
          // Best-effort — never let a bump failure break the upstream
          // domain write. See `bumpPlaybookComposeTimestamp` rationale.
          console.warn(
            `[bumpDomainSectionStaleness] swallowed error for ${playbookId}/${sectionKey}:`,
            err,
          );
          return { changed: false, sectionHash: "" };
        }),
      ),
    ),
  );

  return playbookIds;
}
