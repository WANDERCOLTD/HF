import type { WizardToolExec } from "../_shared/types";
import { ensureInstitutionAndDomain } from "../_shared/ensure-institution-and-domain";

export async function execute(
  _input: Record<string, unknown>,
  userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // Safety net: auto-create institution if domainId is missing but we have enough data.
  // This handles the case where the AI skips create_institution before the content phase.
  const existingDomainId = (setupData?.existingDomainId || setupData?.draftDomainId) as string | undefined;
  if (!existingDomainId && setupData?.institutionName) {
    const result = await ensureInstitutionAndDomain(
      setupData.institutionName as string,
      userId,
      setupData.typeSlug as string | undefined,
    );
    if (result) {
      return {
        autoInjectFields: {
          draftDomainId: result.domainId,
          draftInstitutionId: result.institutionId,
          defaultDomainKind: result.domainKind,
        },
        content: "Teaching Materials panel is visible in the right column. Guide the user to drop files there. Wait for their response.",
      };
    }
    // ensureInstitutionAndDomain returned null — fall through, show upload anyway
  }
  return { content: `Teaching Materials panel is visible in the right column. Guide the user to drop files there. Wait for their response.` };
}
