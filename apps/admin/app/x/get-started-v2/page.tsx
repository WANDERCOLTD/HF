import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AIConversationWizard } from "./components/AIConversationWizard";
import type { WizardInitialContext } from "./components/AIConversationWizard";

export default async function GetStartedV2Page() {
  const session = await auth();
  if (!session?.user) return <AIConversationWizard />;

  const { user } = session;
  const institutionId = user.institutionId;

  if (!institutionId) return <AIConversationWizard />;

  // Single query: institution + type + active domains
  const institution = await prisma.institution.findUnique({
    where: { id: institutionId, isActive: true },
    select: {
      id: true,
      name: true,
      type: { select: { slug: true } },
      domains: {
        where: { isActive: true },
        select: { id: true, kind: true },
        orderBy: { createdAt: "asc" },
        take: 5,
      },
    },
  });

  if (!institution || institution.domains.length === 0) {
    return <AIConversationWizard />;
  }

  // Resolve domain: prefer assignedDomainId if it belongs to this institution
  let domainId = institution.domains[0].id;
  let domainKind = institution.domains[0].kind as "INSTITUTION" | "COMMUNITY";

  if (user.assignedDomainId) {
    const match = institution.domains.find((d) => d.id === user.assignedDomainId);
    if (match) {
      domainId = match.id;
      domainKind = match.kind as "INSTITUTION" | "COMMUNITY";
    }
  }

  const initialContext: WizardInitialContext = {
    institutionName: institution.name,
    institutionId: institution.id,
    domainId,
    domainKind,
    typeSlug: institution.type?.slug ?? null,
    userRole: user.role,
  };

  return <AIConversationWizard initialContext={initialContext} />;
}
