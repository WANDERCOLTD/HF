/**
 * #1078 — V6 wizard Phase 1 spike: structural CHAIN guard tests.
 *
 * Three-layer defence; this vitest exercises layer 2 (application-layer
 * assertion in the projector). Layer 1 (ESLint) is tested at
 * `tests/eslint-rules/no-undeclared-field-require.test.ts`. Layer 3
 * (DB trigger) is integration-level — see
 * `docs/decisions/2026-06-XX-v6-phase-1-spike-close.md` §"Contract
 * violation proof" for the live integration capture (the DB trigger
 * can't fire without a real Postgres connection; this unit test
 * documents what it WOULD reject).
 *
 * The CHAIN violation we prove here: calling `projectV6Snapshot`
 * without a Prisma transaction client throws immediately, with a
 * message that names the prior-art trap.
 *
 * The integration counterpart (deferred to manual smoke for P1):
 *   1. Open `prisma.$transaction(async tx => { ... })`
 *   2. Skip the `SET LOCAL hf.v6_projector` step
 *   3. Call `updatePlaybookConfig` with the `__v6` namespace
 *   4. Expect `check_violation` error from `enforce_v6_snapshot_write`
 */

import { describe, it, expect } from "vitest";
import { projectV6Snapshot } from "@/lib/wizard-v6/projector";

describe("V6 projector — CHAIN guard layer 2 (application assertion)", () => {
  it("throws when called without a Prisma transaction client", async () => {
    // Cast: the assertion specifically catches the runtime mistake of
    // omitting `tx`; TypeScript would normally block this at compile
    // time. We force the runtime path here to prove the assertion fires.
    await expect(
      projectV6Snapshot(undefined as never, {
        playbookId: "fake",
        sessionId: "fake",
        specKey: "CreateRecipe",
        specVersion: 1,
        answeredFields: { title: "Pasta" },
        lastEventSequence: 1,
      }),
    ).rejects.toThrow(
      /projectV6Snapshot called without a tx client/,
    );
  });

  it("error message names the prior-art trap (SET LOCAL is tx-scoped)", async () => {
    let captured: string | null = null;
    try {
      await projectV6Snapshot(undefined as never, {
        playbookId: "fake",
        sessionId: "fake",
        specKey: "CreateRecipe",
        specVersion: 1,
        answeredFields: {},
        lastEventSequence: 0,
      });
    } catch (e) {
      captured = e instanceof Error ? e.message : String(e);
    }
    expect(captured).toMatch(/SET LOCAL is/);
    expect(captured).toMatch(/transaction-scoped/);
  });

  it("error message points operators to the prior-art file", async () => {
    let captured: string | null = null;
    try {
      await projectV6Snapshot(undefined as never, {
        playbookId: "fake",
        sessionId: "fake",
        specKey: "CreateRecipe",
        specVersion: 1,
        answeredFields: {},
        lastEventSequence: 0,
      });
    } catch (e) {
      captured = e instanceof Error ? e.message : String(e);
    }
    expect(captured).toMatch(/lib\/snapshots\/snapshot-restore\.ts/);
  });
});
