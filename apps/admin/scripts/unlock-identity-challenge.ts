/**
 * Admin unlock for a learner locked out of the first-call PIN gate (#1101).
 *
 * Usage:
 *   npx tsx scripts/unlock-identity-challenge.ts <callerId>
 *
 * Clears BOTH `lockedAt` AND `attemptCount` on every CallerIdentityChallenge
 * row issued in the last 24h for the caller. Clearing only lockedAt would
 * leave attemptCount at the cap, so the next wrong attempt would re-lock
 * immediately (TL review fix).
 *
 * Use this when a learner contacted their teacher to say they're locked out
 * of their first call. The next PIN they receive (via /api/identity/resend-pin
 * or a fresh enrolment) will be verifiable from a clean state.
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const callerId = process.argv[2];
  if (!callerId) {
    console.error("Usage: tsx scripts/unlock-identity-challenge.ts <callerId>");
    process.exit(1);
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true, email: true },
  });
  if (!caller) {
    console.error(`No Caller found with id ${callerId}`);
    process.exit(1);
  }

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await prisma.callerIdentityChallenge.updateMany({
    where: {
      callerId,
      issuedAt: { gte: windowStart },
    },
    data: {
      lockedAt: null,
      attemptCount: 0,
    },
  });

  console.log(
    `Unlocked ${result.count} challenge row(s) in the last 24h for caller ${caller.name ?? callerId} (${caller.email ?? "no email"}).`,
  );
  console.log(
    "The learner can now re-enter their last PIN, or request a fresh one from the gate.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
