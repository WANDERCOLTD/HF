/**
 * Save round-trip smoke test — Followup #6 to journey-tab closeout.
 *
 * **What this test pins:**
 *  Every contract in `JOURNEY_SETTINGS` (+ `VOICE_SETTINGS`) can have a
 *  representative value written through the storage-path applier and
 *  read back at the same path. Catches the drift class where a
 *  contract's `storagePath` is malformed, references a non-existent
 *  root, or carries an `arrayKey` without the `selectorValue` needed
 *  to actually address an array element.
 *
 *  This is a smoke test, not a contract conformance gate:
 *  - It uses `applyAtPath` directly against a `PlaybookConfig` clone
 *    (no DB, no auth, no route wiring) — fast.
 *  - It generates a representative value per `control` type. Real
 *    payloads from the Inspector are more constrained but that's not
 *    what this test pins.
 *  - It expects round-trip equality OR a documented skip reason
 *    (e.g. `scope: "module"` storage paths live on AuthoredModule,
 *    not PlaybookConfig — the journey-setting PATCH route can't
 *    address them without a moduleId selector and they have a
 *    separate writer surface).
 *
 * **Why this exists:**
 *  Followup audit during the Slice C closeout (2026-06-16). 35 Lane 3
 *  contracts shipped quickly and the user wanted "confidence every
 *  contract persists." StoragePathStruct entries with `arrayKey` /
 *  `selectorValue` / `writeMode` are the highest-risk class — array
 *  writes can silently land in the wrong shape.
 *
 *  This test surfaces every shape currently in the registry and pins
 *  the category counts. New contracts join an existing bucket or
 *  flip a count and force the author to document why.
 *
 * **How to fix a failure:**
 *  - "Contract has unknown root" — storagePath starts with a prefix
 *    `resolveStoragePath` doesn't recognise. Fix the path or add a
 *    new root to `storage-path-applier.ts`.
 *  - "Round-trip mismatch" — the applier wrote one shape and we read
 *    back another. Usually means the path has an array hop that
 *    needs a selectorValue, or writeMode "merge" but the contract
 *    expects "replace".
 *  - "Module-scoped count drift" — a new G8 (or sibling-scoped)
 *    contract was added or removed. Update the expected count.
 */

import { describe, it, expect } from "vitest";

import {
  JOURNEY_SETTINGS,
} from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import type {
  JourneySettingContract,
  ControlType,
} from "@/lib/journey/setting-contracts";
import {
  applyAtPath,
  resolveStoragePath,
  type ResolvedPath,
  type StorageRoot,
} from "@/lib/journey/storage-path-applier";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/** Representative value per control type. Not exhaustive — the goal is
 *  a non-trivial value that survives a round-trip. */
function representativeValue(
  c: JourneySettingContract,
): unknown {
  const firstOption = c.options?.[0]?.value;
  switch (c.control as ControlType) {
    case "toggle":
      return true;
    case "select":
      return firstOption ?? "test-value";
    case "multi-select":
      return firstOption ? [firstOption] : ["test-value"];
    case "text":
      return "round-trip-text";
    case "number":
      return 42;
    case "slider":
      return 0.5;
    case "duration":
      return 30;
    case "json-fallback":
      return { test: "value" };
    case "phases":
      return [{ phase: "test", duration: 1 }];
    case "targets":
      return [{ scope: "firstCall", parameterId: "test", min: 0 }];
    case "banding":
      return { tierPresetId: "Generic" };
    case "voice-picker":
      return { voiceProvider: "vapi", voiceId: "test-voice" };
    case "stop": {
      // Structured stop contracts address an array element by
      // `arrayKey: "id"` + a canonical `selectorValue` (`"pre-test"` /
      // `"mid-test"` / `"post-test"` / `"nps"`). The applier injects the
      // selector onto pushed elements, so the round-trip read-back will
      // carry the id; mirror it in the written value so the comparison
      // matches.
      const struct = typeof c.storagePath === "object" ? c.storagePath : null;
      const id =
        struct?.arrayKey === "id" && struct.selectorValue
          ? struct.selectorValue
          : undefined;
      return {
        ...(id ? { id } : {}),
        kind: "pre_test",
        enabled: true,
        trigger: { type: "first_session" },
      };
    }
    case "min-target":
      return { min: 1, target: 2 };
    case "array-editor":
      return [{ id: "test", value: 1 }];
    default:
      return "test-value";
  }
}

/** Walk segments to read the value back. Mirrors the applier's traversal
 *  exactly so a successful round-trip is a real one, not a tautology. */
function readAtPath(
  config: PlaybookConfig,
  resolved: ResolvedPath,
): unknown {
  let parent: Record<string, unknown> = config as Record<string, unknown>;
  switch (resolved.root) {
    case "config":
      break;
    case "sessionFlow":
      parent = (parent.sessionFlow ?? {}) as Record<string, unknown>;
      break;
    case "tolerances":
      parent = (parent.tolerances ?? {}) as Record<string, unknown>;
      break;
    case "playbook.voiceConfig":
      parent = (parent.voiceConfig ?? {}) as Record<string, unknown>;
      break;
    default:
      return undefined;
  }
  for (let i = 0; i < resolved.segments.length - 1; i++) {
    const k = resolved.segments[i];
    const next = parent[k];
    if (typeof next !== "object" || next === null) return undefined;
    parent = next as Record<string, unknown>;
  }
  const finalKey = resolved.segments[resolved.segments.length - 1];
  if (!finalKey) return undefined;

  if (resolved.arraySelector) {
    const arr = parent[finalKey];
    if (!Array.isArray(arr)) return undefined;
    return arr.find(
      (it) =>
        typeof it === "object" &&
        it !== null &&
        (it as Record<string, unknown>)[resolved.arraySelector!.key] ===
          resolved.arraySelector!.value,
    );
  }
  return parent[finalKey];
}

interface CategorizedContract {
  id: string;
  category:
    | "passed-roundtrip"
    | "skipped-domain"
    | "skipped-behavior-targets"
    | "skipped-unknown-root"
    | "skipped-module-scope"
    | "failed-roundtrip"
    | "failed-write-noop";
  detail?: string;
}

function categorize(c: JourneySettingContract): CategorizedContract {
  if (c.scope === "module") {
    // Module-scoped contracts store on AuthoredModule.settings and have
    // their own writer (the journey-setting PATCH route cannot address
    // them without a moduleId selector — would need a body extension).
    return { id: c.id, category: "skipped-module-scope" };
  }

  const resolved = resolveStoragePath(c.storagePath);
  if (resolved.root === ("domain" as StorageRoot)) {
    return { id: c.id, category: "skipped-domain" };
  }
  if (resolved.root === ("behaviorTargets" as StorageRoot)) {
    // PATCH route returns compoundOwnedSave: true — the wrapped editor
    // owns the actual save loop. No round-trip via applyAtPath.
    return { id: c.id, category: "skipped-behavior-targets" };
  }
  if (resolved.root === ("unknown" as StorageRoot)) {
    return {
      id: c.id,
      category: "skipped-unknown-root",
      detail: typeof c.storagePath === "string"
        ? c.storagePath
        : c.storagePath.path,
    };
  }

  const config: PlaybookConfig = {} as PlaybookConfig;
  const value = representativeValue(c);
  applyAtPath(config, resolved, value);
  const readBack = readAtPath(config, resolved);

  if (readBack === undefined) {
    return {
      id: c.id,
      category: "failed-write-noop",
      detail: typeof c.storagePath === "string"
        ? c.storagePath
        : c.storagePath.path,
    };
  }
  if (JSON.stringify(readBack) !== JSON.stringify(value)) {
    return {
      id: c.id,
      category: "failed-roundtrip",
      detail: `wrote ${JSON.stringify(value)} read ${JSON.stringify(readBack)}`,
    };
  }
  return { id: c.id, category: "passed-roundtrip" };
}

describe("Journey settings save round-trip smoke test", () => {
  const all = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS];
  const results = all.map(categorize);
  const byCategory = new Map<string, CategorizedContract[]>();
  for (const r of results) {
    const bucket = byCategory.get(r.category) ?? [];
    bucket.push(r);
    byCategory.set(r.category, bucket);
  }

  const get = (k: CategorizedContract["category"]): CategorizedContract[] =>
    byCategory.get(k) ?? [];

  it("no contract fails the round-trip (silent shape drift)", () => {
    const failures = get("failed-roundtrip");
    expect(
      failures,
      `Contracts where read-back value !== written value (storage path drift):\n  ${failures
        .map((f) => `${f.id}: ${f.detail}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("no contract writes a no-op (path silently lost)", () => {
    const failures = get("failed-write-noop");
    expect(
      failures,
      `Contracts where applyAtPath wrote nothing readable (segments lost?):\n  ${failures
        .map((f) => `${f.id}: ${f.detail}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("no contract has an unknown storage root", () => {
    const failures = get("skipped-unknown-root");
    expect(
      failures,
      `Contracts whose storagePath prefix isn't in storage-path-applier.ts:\n  ${failures
        .map((f) => `${f.id}: ${f.detail}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("category counts match expectations (ratchet)", () => {
    // Bumping these counts intentionally is fine — but the reviewer
    // sees the bump and confirms the new contract belongs in its
    // category. Catch-up ratchets like this catch BA-failure cases
    // where a new contract slips into an unexpected bucket.
    //
    // Pinned at 2026-06-16 (post-Slice C closeout):
    expect(get("passed-roundtrip").length).toBeGreaterThan(0);
    // Domain-rooted contracts route to /api/domains/[id]/onboarding,
    // not this journey-setting PATCH. The cascade still surfaces them
    // in the menu; the write lands on the Domain row, not Playbook.
    // Today: intakeSpecId + onboardingFlowPhases.
    expect(get("skipped-domain").length).toBe(2);
    expect(get("skipped-behavior-targets").length).toBe(1); // first session targets
    expect(get("skipped-module-scope").length).toBe(7);    // G8 — Theme 1 + #1704
  });
});
