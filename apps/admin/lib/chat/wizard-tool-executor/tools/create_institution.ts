import type { WizardToolExec } from "../_shared/types";
import { validUuid } from "../_shared/valid-uuid";
import { resolveInstitutionByName } from "../resolvers/institution-by-name";

export async function execute(
  input: Record<string, unknown>,
  userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolExec> {
  // Server-side: actually create the institution
  try {
    const { prisma } = await import("@/lib/prisma");
    const slugify = (await import("slugify")).default;

    const name = input.name as string;
    const typeSlug = input.typeSlug as string | undefined;

    // ── Guard: if institution already exists (setupData or name match), return it ──
    // The AI sometimes calls create_institution even when update_setup already resolved one.
    const existingDomainId = validUuid(setupData?.existingDomainId);
    const existingInstitutionId = validUuid(setupData?.existingInstitutionId);
    if (existingDomainId && existingInstitutionId) {
      console.log(`[wizard-tools] create_institution: institution already resolved (${existingInstitutionId}), returning existing`);
      return {
        content: JSON.stringify({
          ok: true,
          institutionId: existingInstitutionId,
          domainId: existingDomainId,
          alreadyExisted: true,
        }),
      };
    }
    // Also check by name
    const resolved = await resolveInstitutionByName(name);
    if (resolved) {
      console.log(`[wizard-tools] create_institution: "${name}" already exists (${resolved.institutionId}), returning existing`);
      return {
        content: JSON.stringify({
          ok: true,
          institutionId: resolved.institutionId,
          domainId: resolved.domainId,
          alreadyExisted: true,
        }),
      };
    }

    // Find institution type + its default domain kind
    let typeId: string | undefined;
    let domainKind: "INSTITUTION" | "COMMUNITY" = "INSTITUTION";
    if (typeSlug) {
      const instType = await prisma.institutionType.findFirst({
        where: { slug: typeSlug },
        select: { id: true, defaultDomainKind: true },
      });
      typeId = instType?.id;
      if (instType?.defaultDomainKind === "COMMUNITY") domainKind = "COMMUNITY";
    }

    // Create institution + domain + link user atomically
    const [institution, domain] = await prisma.$transaction(async (tx) => {
      const inst = await tx.institution.create({
        data: {
          name,
          slug: slugify(name, { lower: true, strict: true }),
          ...(typeId ? { typeId } : {}),
        },
      });

      const dom = await tx.domain.create({
        data: {
          name,
          slug: slugify(name, { lower: true, strict: true }),
          institutionId: inst.id,
          kind: domainKind,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { activeInstitutionId: inst.id },
      });

      return [inst, dom] as const;
    });

    return {
      content: JSON.stringify({
        ok: true,
        institutionId: institution.id,
        domainId: domain.id,
        domainKind,
      }),
    };
  } catch (err) {
    return {
      content: JSON.stringify({ ok: false, error: String(err) }),
      is_error: true,
    };
  }
}
