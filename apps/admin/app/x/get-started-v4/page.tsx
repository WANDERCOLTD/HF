import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ConversationalWizard } from "./components/ConversationalWizard";
import type { WizardInitialContext } from "./components/ConversationalWizard";

export default async function GetStartedV4Page() {
  const session = await auth();
  if (!session?.user) return <ConversationalWizard />;

  const { user } = session;
  const institutionId = user.institutionId;

  if (!institutionId) return <ConversationalWizard />;

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
    return <ConversationalWizard />;
  }

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

  return <ConversationalWizard initialContext={initialContext} />;
}
