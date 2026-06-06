import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EnrolV2EntryClient } from "./EnrolV2EntryClient";

/**
 * @page /intake/v2/[token]
 * V2 auth-first enrolment entry — single field (email or phone with
 * auto-detection). Pre-PIN, pre-disclosure-chat, pre-everything.
 * Story 2 of the #1141 epic.
 */
export default async function IntakeV2EntryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const cohort = await prisma.cohortGroup.findUnique({
    where: { joinToken: token },
    select: {
      isActive: true,
      joinTokenExp: true,
      name: true,
      domain: { select: { name: true } },
      institution: { select: { name: true } },
    },
  });

  if (!cohort || !cohort.isActive) notFound();
  const expired =
    cohort.joinTokenExp && new Date(cohort.joinTokenExp) < new Date();
  if (expired) notFound();

  return (
    <EnrolV2EntryClient
      token={token}
      cohortName={cohort.name}
      domainName={cohort.domain.name}
      institutionName={cohort.institution?.name ?? null}
    />
  );
}
