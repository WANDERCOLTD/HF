import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EnrolV2FinishClient } from "./EnrolV2FinishClient";

/**
 * @page /intake/v2/[token]/[callerId]
 * V2 post-start surface: PIN gate first, then chat-to-complete profile.
 * Hit via redirect from POST /api/intake/v2/start. Story 2 of #1141.
 *
 * The page validates token + callerId match the cohort + that the Caller
 * actually belongs to it (defence against URL tampering — someone
 * pasting another caller's UUID), then hands off to the client.
 *
 * If the Caller's chat completion has already happened (verifiedAt set
 * AND profile fields populated) we send them straight to /x/sim.
 */
export default async function IntakeV2FinishPage({
  params,
}: {
  params: Promise<{ token: string; callerId: string }>;
}) {
  const { token, callerId } = await params;

  const [cohort, caller] = await Promise.all([
    prisma.cohortGroup.findUnique({
      where: { joinToken: token },
      select: {
        id: true,
        isActive: true,
        name: true,
        domain: { select: { name: true } },
      },
    }),
    prisma.caller.findUnique({
      where: { id: callerId },
      select: { id: true, email: true, name: true, cohortGroupId: true },
    }),
  ]);

  if (!cohort || !cohort.isActive) notFound();
  if (!caller || caller.cohortGroupId !== cohort.id) notFound();

  return (
    <EnrolV2FinishClient
      token={token}
      callerId={caller.id}
      email={caller.email ?? ""}
      cohortName={cohort.name}
      domainName={cohort.domain.name}
    />
  );
}
