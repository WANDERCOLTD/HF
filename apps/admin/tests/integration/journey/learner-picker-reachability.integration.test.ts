/**
 * #948 / L9 — Learner-Facing Module Picker Reachability — integration test
 *
 * Pins the L9 chain contract (`docs/CHAIN-CONTRACTS.md`) against live DB
 * data. Walks four shapes of learner state and verifies the resolver's
 * decision matches the contract for each shape.
 *
 * Tests run DB-only (no server needed). Each test owns its rows under
 * uniquely-prefixed `externalId`s so concurrent test runs don't collide
 * and each test cleans up its own rows in `afterAll`.
 *
 * Acceptance criteria pinned:
 *
 *   1. Learner with 1 ACTIVE enrollment on a `modulesAuthored=true`
 *      playbook → resolver returns that playbookId; subsequent playbook
 *      fetch surfaces `modules` for the banner.
 *
 *   2. Learner with 2+ ACTIVE enrollments (different `enrolledAt`) →
 *      resolver picks the most-recently-enrolled.
 *
 *   3. Learner with 0 ACTIVE enrollments → resolver returns `null`
 *      (page would render empty state, not crash).
 *
 *   4. Learner with 1 ACTIVE enrollment on `modulesAuthored=false`
 *      playbook → resolver still returns that playbookId (it doesn't
 *      gate on `modulesAuthored`); the banner-gating happens downstream
 *      in the page component, not in the resolver.
 *
 * FK landmine: pre-fix, `educator-journey.integration.test.ts:406` tripped
 * on `prisma.caller.upsert` with a non-existent `userId`. The Caller →
 * User FK is enforced. For LEARNER-role callers in these fixtures we leave
 * `userId` null — these are sim-only callers, not portal users.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resolveActivePlaybookId } from "@/lib/caller/resolve-active-playbook";

const prisma = new PrismaClient();

// Per-run unique prefix so concurrent CI jobs don't fight over rows.
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PREFIX = `e2e-journey-l9-${RUN_ID}`;

interface L9Fixtures {
  domainId: string;
  // Test 1 — 1 ACTIVE, modulesAuthored=true
  callerSingleActiveId: string;
  playbookAuthoredId: string;
  // Test 2 — 2 ACTIVE enrollments, different enrolledAt
  callerMultiActiveId: string;
  playbookOlderId: string;
  playbookNewerId: string;
  // Test 3 — 0 ACTIVE enrollments
  callerNoEnrollmentId: string;
  // Test 4 — 1 ACTIVE on modulesAuthored=false
  callerSingleUnauthoredId: string;
  playbookUnauthoredId: string;
}

let fixtures: L9Fixtures;

async function ensurePlaybook(
  name: string,
  domainId: string,
  modulesAuthored: boolean,
  modules: Array<{ id: string; label: string }> | null,
): Promise<{ id: string }> {
  return prisma.playbook.create({
    data: {
      name,
      description: `L9 integration test playbook (${name})`,
      domainId,
      status: "PUBLISHED",
      publishedAt: new Date(),
      config: {
        ...(modulesAuthored ? { modulesAuthored: true } : { modulesAuthored: false }),
        ...(modules ? { modules } : {}),
      },
    },
    select: { id: true },
  });
}

async function ensureCaller(
  index: number,
  domainId: string,
  name: string,
): Promise<{ id: string; externalId: string | null }> {
  const externalId = `${PREFIX}-${index}-${name}`;
  return prisma.caller.create({
    data: {
      externalId,
      name: `L9 Test ${name}`,
      phone: `+1-555-${String(index).padStart(3, "0")}-L9XX`,
      domainId,
      role: "LEARNER",
      // userId intentionally left null — these are sim-only callers, not
      // portal users; setting a non-existent userId crashes the FK
      // (educator-journey landmine 2026-05-27).
    },
    select: { id: true, externalId: true },
  });
}

beforeAll(async () => {
  // 1. Single integration-test domain (shared across all test cases).
  const domain = await prisma.domain.upsert({
    where: { slug: `${PREFIX}-domain` },
    create: {
      slug: `${PREFIX}-domain`,
      name: "L9 Integration Test Domain",
      description: "Owned by learner-picker-reachability.integration.test.ts. Auto-deleted at end of suite.",
      isActive: true,
    },
    update: {},
  });

  // 2. Three playbooks: authored (4 modules), authored older + authored newer (multi-enrollment case), unauthored.
  const playbookAuthored = await ensurePlaybook(
    `${PREFIX}-authored-pb`,
    domain.id,
    true,
    [
      { id: "part1", label: "Part 1: Familiar Topics" },
      { id: "part2", label: "Part 2: Long Turn" },
      { id: "part3", label: "Part 3: Discussion" },
      { id: "review", label: "Part 4: Review" },
    ],
  );
  const playbookOlder = await ensurePlaybook(
    `${PREFIX}-older-pb`,
    domain.id,
    true,
    [{ id: "m1", label: "Older Module" }],
  );
  const playbookNewer = await ensurePlaybook(
    `${PREFIX}-newer-pb`,
    domain.id,
    true,
    [{ id: "m1", label: "Newer Module" }],
  );
  const playbookUnauthored = await ensurePlaybook(
    `${PREFIX}-unauthored-pb`,
    domain.id,
    false,
    null,
  );

  // 3. Four callers — one per L9 shape.
  const callerSingleActive = await ensureCaller(1, domain.id, "single-active");
  const callerMultiActive = await ensureCaller(2, domain.id, "multi-active");
  const callerNoEnrollment = await ensureCaller(3, domain.id, "no-enrollment");
  const callerSingleUnauthored = await ensureCaller(4, domain.id, "single-unauthored");

  // 4. Enrollments.
  // 4a — Test 1: 1 ACTIVE on authored playbook.
  await prisma.callerPlaybook.create({
    data: {
      callerId: callerSingleActive.id,
      playbookId: playbookAuthored.id,
      status: "ACTIVE",
      enrolledBy: PREFIX,
      isDefault: true,
    },
  });

  // 4b — Test 2: 2 ACTIVE, different enrolledAt.
  // Insert "older" first with explicit older enrolledAt, then "newer".
  const olderEnrolledAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  const newerEnrolledAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
  await prisma.callerPlaybook.create({
    data: {
      callerId: callerMultiActive.id,
      playbookId: playbookOlder.id,
      status: "ACTIVE",
      enrolledBy: PREFIX,
      enrolledAt: olderEnrolledAt,
    },
  });
  await prisma.callerPlaybook.create({
    data: {
      callerId: callerMultiActive.id,
      playbookId: playbookNewer.id,
      status: "ACTIVE",
      enrolledBy: PREFIX,
      enrolledAt: newerEnrolledAt,
      isDefault: true,
    },
  });

  // 4c — Test 3: zero enrollments (intentionally empty).

  // 4d — Test 4: 1 ACTIVE on unauthored playbook.
  await prisma.callerPlaybook.create({
    data: {
      callerId: callerSingleUnauthored.id,
      playbookId: playbookUnauthored.id,
      status: "ACTIVE",
      enrolledBy: PREFIX,
      isDefault: true,
    },
  });

  fixtures = {
    domainId: domain.id,
    callerSingleActiveId: callerSingleActive.id,
    playbookAuthoredId: playbookAuthored.id,
    callerMultiActiveId: callerMultiActive.id,
    playbookOlderId: playbookOlder.id,
    playbookNewerId: playbookNewer.id,
    callerNoEnrollmentId: callerNoEnrollment.id,
    callerSingleUnauthoredId: callerSingleUnauthored.id,
    playbookUnauthoredId: playbookUnauthored.id,
  };
});

afterAll(async () => {
  // FK-safe cleanup — children first.
  const callerIds = [
    fixtures.callerSingleActiveId,
    fixtures.callerMultiActiveId,
    fixtures.callerNoEnrollmentId,
    fixtures.callerSingleUnauthoredId,
  ];
  const playbookIds = [
    fixtures.playbookAuthoredId,
    fixtures.playbookOlderId,
    fixtures.playbookNewerId,
    fixtures.playbookUnauthoredId,
  ];

  await prisma.callerPlaybook.deleteMany({ where: { callerId: { in: callerIds } } });
  await prisma.composedPrompt.deleteMany({ where: { callerId: { in: callerIds } } });
  await prisma.caller.deleteMany({ where: { id: { in: callerIds } } });
  await prisma.playbook.deleteMany({ where: { id: { in: playbookIds } } });
  await prisma.domain.deleteMany({ where: { id: fixtures.domainId } });
  await prisma.$disconnect();
});

describe("#948 / L9 — learner-picker-reachability (integration)", () => {
  it("Test 1 — 1 ACTIVE enrollment on modulesAuthored=true → resolver returns that playbookId", async () => {
    const result = await resolveActivePlaybookId(fixtures.callerSingleActiveId);

    expect(result).toBe(fixtures.playbookAuthoredId);

    // Confirm the downstream banner-gating data is present (the page would
    // fetch /api/playbooks/[id] to read this). We assert directly off the
    // DB row to keep the test DB-only.
    const playbook = await prisma.playbook.findUnique({
      where: { id: result! },
      select: { config: true },
    });
    expect(playbook).not.toBeNull();
    const config = playbook!.config as { modulesAuthored?: boolean; modules?: unknown[] };
    expect(config.modulesAuthored).toBe(true);
    expect(Array.isArray(config.modules)).toBe(true);
    expect((config.modules as unknown[]).length).toBe(4);
  });

  it("Test 2 — 2 ACTIVE enrollments → resolver picks the more recent (most-recently-enrolled wins)", async () => {
    const result = await resolveActivePlaybookId(fixtures.callerMultiActiveId);

    expect(result).toBe(fixtures.playbookNewerId);
    expect(result).not.toBe(fixtures.playbookOlderId);
  });

  it("Test 3 — 0 ACTIVE enrollments → resolver returns null (not crash, not undefined)", async () => {
    const result = await resolveActivePlaybookId(fixtures.callerNoEnrollmentId);

    expect(result).toBeNull();
  });

  it("Test 4 — 1 ACTIVE on modulesAuthored=false → resolver returns playbookId; downstream banner gating handles modulesAuthored separately", async () => {
    const result = await resolveActivePlaybookId(fixtures.callerSingleUnauthoredId);

    expect(result).toBe(fixtures.playbookUnauthoredId);

    // Confirm the banner WOULD NOT fire — modulesAuthored=false. The
    // resolver is correct (returns the playbookId), the page's downstream
    // conditional is what suppresses the banner. Both behaviours are part
    // of the L9 contract: resolver doesn't gate on modulesAuthored; page
    // does.
    const playbook = await prisma.playbook.findUnique({
      where: { id: result! },
      select: { config: true },
    });
    expect(playbook).not.toBeNull();
    const config = playbook!.config as { modulesAuthored?: boolean };
    expect(config.modulesAuthored).toBe(false);
  });

  it("URL override branch — wins even when enrollments differ (deep-link semantics)", async () => {
    // Caller is enrolled in playbookAuthored only, but we pass a different
    // id as the override. The override wins per L9 step 1.
    const result = await resolveActivePlaybookId(
      fixtures.callerSingleActiveId,
      fixtures.playbookOlderId,
    );

    expect(result).toBe(fixtures.playbookOlderId);
    expect(result).not.toBe(fixtures.playbookAuthoredId);
  });
});
