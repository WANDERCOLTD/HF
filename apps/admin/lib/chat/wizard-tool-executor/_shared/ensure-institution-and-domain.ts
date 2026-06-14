import { resolveInstitutionByName } from "../resolvers/institution-by-name";
import { inferTypeFromName } from "../resolvers/infer-type-from-name";

/** Resolve existing institution by name, or create institution + domain + link user. */
export async function ensureInstitutionAndDomain(
  institutionName: string,
  userId: string,
  typeSlug?: string,
): Promise<{ domainId: string; institutionId: string; domainKind: "INSTITUTION" | "COMMUNITY" } | null> {
  const resolved = await resolveInstitutionByName(institutionName);
  if (resolved) {
    return { domainId: resolved.domainId, institutionId: resolved.institutionId, domainKind: resolved.domainKind as "INSTITUTION" | "COMMUNITY" };
  }

  try {
    const { prisma } = await import("@/lib/prisma");
    const slugify = (await import("slugify")).default;

    let typeId: string | undefined;
    let domainKind: "INSTITUTION" | "COMMUNITY" = "INSTITUTION";
    const resolvedTypeSlug = typeSlug || inferTypeFromName(institutionName) || undefined;
    if (resolvedTypeSlug) {
      const instType = await prisma.institutionType.findFirst({
        where: { slug: resolvedTypeSlug },
        select: { id: true, defaultDomainKind: true },
      });
      typeId = instType?.id;
      if (instType?.defaultDomainKind === "COMMUNITY") domainKind = "COMMUNITY";
    }

    const [institution, domain] = await prisma.$transaction(async (tx) => {
      const inst = await tx.institution.create({
        data: {
          name: institutionName,
          slug: slugify(institutionName, { lower: true, strict: true }),
          ...(typeId ? { typeId } : {}),
        },
      });
      const dom = await tx.domain.create({
        data: {
          name: institutionName,
          slug: slugify(institutionName, { lower: true, strict: true }),
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

    console.log(`[wizard-tools] ensureInstitutionAndDomain: created "${institutionName}" (inst: ${institution.id}, domain: ${domain.id})`);
    return { domainId: domain.id, institutionId: institution.id, domainKind };
  } catch (err) {
    console.error("[wizard-tools] ensureInstitutionAndDomain failed:", err);
    return null;
  }
}
