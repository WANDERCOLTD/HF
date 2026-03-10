import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ConversationalWizard } from "../get-started-v4/components/ConversationalWizard";
import { V5WizardWithSelector } from "./V5WizardWithSelector";

/**
 * Get Started V5 — Graph-driven wizard.
 *
 * Differences from V4:
 * - Institution selector for SUPERADMIN (switch between orgs for demos)
 * - Institution pre-filled from user record (changeable in wizard)
 * - System prompt lets the graph evaluator drive conversation order (no linear phases)
 * - Content upload available right after institution/domain exists
 */
export default async function GetStartedV5Page() {
  const session = await auth();
  if (!session?.user) return <ConversationalWizard wizardVersion="v5" />;

  const { user } = session;
  const institutionId = user.institutionId;

  // No assigned institution — SUPERADMIN still gets the selector (fetches all from API)
  if (!institutionId) {
    return <V5WizardWithSelector defaultInstitution={null} userRole={user.role} />;
  }

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
    return <V5WizardWithSelector defaultInstitution={null} userRole={user.role} />;
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

  const defaultInstitution = {
    id: institution.id,
    name: institution.name,
    domainId,
    domainKind,
    typeSlug: institution.type?.slug ?? null,
  };

  return <V5WizardWithSelector defaultInstitution={defaultInstitution} userRole={user.role} />;
}
