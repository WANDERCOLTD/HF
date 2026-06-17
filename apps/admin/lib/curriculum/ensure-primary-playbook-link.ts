import type { Prisma, PrismaClient } from "@prisma/client";
import { PlaybookCurriculumRole } from "@prisma/client";

type TxOrClient =
  | PrismaClient
  | Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">
  | Prisma.TransactionClient;

/**
 * Idempotently ensure a `PlaybookCurriculum(role:'primary')` join row exists for
 * the given (playbookId, curriculumId) pair. The canonical write-side guard for
 * the Playbook ↔ Curriculum duality — see
 * [`docs/CONTRACTS-PLAYBOOK-CURRICULUM.md`](../../../../../docs/CONTRACTS-PLAYBOOK-CURRICULUM.md) §3.
 *
 * Use inside the same `$transaction` as a `Curriculum.create` / `upsert` to
 * prevent the orphan-Curriculum bug class (#1184, #1202, #1203, #1204).
 *
 * Behaviour:
 * - No existing row → creates with role='primary'.
 * - Existing row with any role → leaves it (variants must not be promoted to
 *   primary by accident; if a true ownership change is needed, do it
 *   explicitly).
 *
 * This helper does NOT enforce that the call is inside a transaction at the
 * type level — callers must wrap it themselves. The proposed ESLint rule
 * `hf-curriculum/no-orphan-curriculum-create` will catch lexical misuse.
 */
export async function ensurePrimaryPlaybookLink(
  tx: TxOrClient,
  playbookId: string,
  curriculumId: string,
): Promise<void> {
  if (!playbookId || !curriculumId) {
    throw new Error(
      `ensurePrimaryPlaybookLink: both playbookId and curriculumId required ` +
        `(got playbookId=${JSON.stringify(playbookId)}, curriculumId=${JSON.stringify(curriculumId)}).`,
    );
  }

  await tx.playbookCurriculum.upsert({
    where: {
      playbookId_curriculumId: { playbookId, curriculumId },
    },
    create: {
      playbookId,
      curriculumId,
      role: PlaybookCurriculumRole.primary,
    },
    update: {},
  });
}
