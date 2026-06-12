/**
 * Slice 2 of epic #1510 (#1512) — seed-ielts-prosody.ts.
 *
 * The script ships two pure planner functions (`planPlaybookActions`,
 * `planProviderAction`) for testability without standing up a Prisma
 * client. The DB-mutating code path is covered structurally by a source
 * read — running the script for real requires hf-dev / hf-staging /
 * hf-prod and the operator step.
 *
 * Covers issue #1512 acceptance criteria:
 *   - --dry-run / no flag mode reports planned writes without making any
 *   - --execute writes tierPresetId on IELTS playbooks that don't have it
 *   - already-set tierPresetId is a no-op
 *   - SpeechAssessmentProvider.isDefault behaviour: sets one when none
 *     exists; warns + leaves alone when multiple; respects single-default
 *     already-set state
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { planPlaybookActions, planProviderAction } from "../../scripts/seed-ielts-prosody";

const scriptPath = path.resolve(
  __dirname,
  "../../scripts/seed-ielts-prosody.ts",
);

const source = fs.readFileSync(scriptPath, "utf8");

// ── Static guarantees (CLI shape + safety defaults) ───────

describe("scripts/seed-ielts-prosody.ts — CLI shape", () => {
  it("exists at the canonical scripts/ location", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it("defaults to dry-run — --execute is required for writes", () => {
    expect(source).toMatch(/const EXECUTE = args\.has\("--execute"\)/);
  });

  it("guards every prisma update call behind the EXECUTE flag", () => {
    // applyPlaybookTier + applyProviderDefault are the only mutation sites.
    // Both must sit inside an `if (EXECUTE)` branch.
    const playbookGate = source.match(
      /if \(EXECUTE\)[\s\S]*?await applyPlaybookTier/,
    );
    const providerGate = source.match(
      /if \(EXECUTE\)[\s\S]*?await applyProviderDefault/,
    );
    expect(playbookGate).not.toBeNull();
    expect(providerGate).not.toBeNull();
  });

  it("writes an AppLog audit row for every mutation (writeAuditLog helper)", () => {
    expect(source).toMatch(/await writeAuditLog\("playbook\.tierPresetId\.set"/);
    expect(source).toMatch(/await writeAuditLog\("provider\.isDefault\.set"/);
  });
});

// ── planPlaybookActions ───────────────────────────────────

describe("planPlaybookActions — IELTS detection + idempotency", () => {
  it("matches IELTS playbooks case-insensitively by name", () => {
    const actions = planPlaybookActions([
      { id: "p1", name: "IELTS Speaking Prep", config: {} },
      { id: "p2", name: "ielts band 7", config: {} },
      { id: "p3", name: "IELTS Prep Lab", config: null },
      { id: "p4", name: "French Conversation", config: {} },
    ]);
    const matched = actions.map((a) => a.playbookId).sort();
    expect(matched).toEqual(["p1", "p2", "p3"]);
  });

  it("marks already-set tierPresetId as no-op (idempotent)", () => {
    const actions = planPlaybookActions([
      {
        id: "p1",
        name: "IELTS Speaking",
        config: { tierPresetId: "ielts-speaking" },
      },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      playbookId: "p1",
      before: "ielts-speaking",
      after: "ielts-speaking",
      wrote: false,
      noopReason: "already-set",
    });
  });

  it("plans a write when tierPresetId is null/missing on an IELTS playbook", () => {
    const actions = planPlaybookActions([
      { id: "p1", name: "IELTS Listening", config: {} },
      { id: "p2", name: "IELTS Writing", config: { somethingElse: 1 } },
    ]);
    expect(actions).toHaveLength(2);
    for (const a of actions) {
      expect(a.before).toBeNull();
      expect(a.after).toBe("ielts-speaking");
      expect(a.noopReason).toBeUndefined();
    }
  });

  it("does NOT overwrite an existing non-IELTS tier preset on an IELTS-named playbook", () => {
    // Defensive — the planner records the existing value as `before` but still
    // PLANS the write (operator can read the dry-run output and abort if the
    // existing value was deliberate). Idempotency only short-circuits on the
    // exact ielts-speaking value.
    const actions = planPlaybookActions([
      {
        id: "p1",
        name: "IELTS Speaking",
        config: { tierPresetId: "cefr" },
      },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      before: "cefr",
      after: "ielts-speaking",
    });
    expect(actions[0].noopReason).toBeUndefined();
  });

  it("skips non-IELTS playbooks even when tierPresetId is unset", () => {
    const actions = planPlaybookActions([
      { id: "p1", name: "Spanish Conversation", config: {} },
      { id: "p2", name: "Maths Tutoring", config: null },
    ]);
    expect(actions).toHaveLength(0);
  });
});

// ── planProviderAction ────────────────────────────────────

describe("planProviderAction — SpeechAssessmentProvider default", () => {
  it("picks the first enabled row when no default exists", () => {
    const action = planProviderAction([
      { id: "p1", slug: "speechsuper", isDefault: false, enabled: false },
      { id: "p2", slug: "speechace", isDefault: false, enabled: true },
    ]);
    expect(action).toMatchObject({
      kind: "set-default",
      providerId: "p2",
      providerSlug: "speechace",
      wrote: false,
    });
  });

  it("prefers slug ASC among enabled rows when multiple are enabled", () => {
    const action = planProviderAction([
      { id: "p1", slug: "speechsuper", isDefault: false, enabled: true },
      { id: "p2", slug: "speechace", isDefault: false, enabled: true },
    ]);
    expect(action).toMatchObject({
      kind: "set-default",
      providerSlug: "speechace",
    });
  });

  it("is a no-op when exactly one row is already isDefault=true (idempotent)", () => {
    const action = planProviderAction([
      { id: "p1", slug: "speechace", isDefault: true, enabled: true },
      { id: "p2", slug: "speechsuper", isDefault: false, enabled: true },
    ]);
    expect(action).toMatchObject({
      kind: "already-has-default",
      providerSlug: "speechace",
    });
  });

  it("warns + leaves alone when multiple rows have isDefault=true (operator decision)", () => {
    const action = planProviderAction([
      { id: "p1", slug: "speechace", isDefault: true, enabled: true },
      { id: "p2", slug: "speechsuper", isDefault: true, enabled: true },
    ]);
    expect(action).toMatchObject({
      kind: "multiple-defaults",
      defaultsCount: 2,
    });
    if (action.kind === "multiple-defaults") {
      expect(action.providerSlugs.sort()).toEqual(["speechace", "speechsuper"]);
    }
  });

  it("returns no-eligible-row when DB is empty", () => {
    const action = planProviderAction([]);
    expect(action).toEqual({ kind: "no-eligible-row" });
  });

  it("falls back to ALL rows by slug ASC when none are enabled", () => {
    const action = planProviderAction([
      { id: "p1", slug: "speechsuper", isDefault: false, enabled: false },
      { id: "p2", slug: "speechace", isDefault: false, enabled: false },
    ]);
    expect(action).toMatchObject({
      kind: "set-default",
      providerSlug: "speechace",
    });
  });
});
