/**
 * Storage-path applier — Phase 2 of epic #1675.
 *
 * Translates a `StoragePath` (string or structured) into a mutation
 * against a `PlaybookConfig` object. Used by the journey-setting PATCH
 * route + the `applyAutoEnableLinks` helper.
 *
 * Storage paths in the journey + voice registries start with one of the
 * known roots:
 *   - `config.…`                  → mutate `playbookConfig.<rest>`
 *   - `sessionFlow.…`             → mutate `playbookConfig.sessionFlow.<rest>`
 *   - `tolerances.…`              → mutate `playbookConfig.tolerances.<rest>`
 *   - `playbook.voiceConfig.…`    → mutate `playbookConfig.voiceConfig.<rest>`
 *   - `behaviorTargets[…]`        → not handled here (BehaviorTarget is a
 *     separate model; Phase 3 wires the structured path for that one
 *     entry — for Phase 2 the route returns 501 Not Implemented)
 *   - `domain.…`                  → not handled here; domain writes go
 *     via `/api/domains/[domainId]/onboarding` (out of scope)
 *
 * The structured form (`StoragePathStruct` with `arrayKey + selectorValue`)
 * is handled only when the path is rooted inside `playbookConfig`.
 *
 * Array traversal modes (both supported):
 *  - **Final-segment array** (legacy): the `[]` marker is the LAST
 *    segment, e.g. `sessionFlow.stops[]`. The whole array element is
 *    replaced / merged.
 *  - **Mid-path array** (P3c #1850): `[]` sits in the middle, e.g.
 *    `config.modules[].settings.questionTarget`. The applier walks to
 *    the array, finds / creates the element matching `arraySelector`,
 *    then dives into the trailing segments to write a specific key
 *    inside the matched element. Used for G8 module-scoped settings.
 *
 * The applier is pure — call it from inside `updatePlaybookConfig`'s
 * transformer.
 */

import type {
  StoragePath,
  StoragePathStruct,
} from "./setting-contracts";
import type { PlaybookConfig } from "@/lib/types/json-fields";

export type StorageRoot =
  | "config"
  | "sessionFlow"
  | "tolerances"
  | "playbook.voiceConfig"
  | "domain"
  | "behaviorTargets"
  | "unknown";

export interface ResolvedPath {
  root: StorageRoot;
  /** Dot-path SEGMENTS after the root (e.g. `config.firstCallMode` → ["firstCallMode"]). */
  segments: readonly string[];
  /** When structured: the array-item selector (kind/id) and value. */
  arraySelector: { key: string; value: string } | null;
  /** Index into `segments` of the array marker `[]`, when present. Used
   *  by `applyAtPath` to distinguish a final-segment array
   *  (e.g. `sessionFlow.stops[]`) from a mid-path array
   *  (e.g. `config.modules[].settings.questionTarget`). Defaults to the
   *  final-segment behaviour when omitted. P3c (#1850) wired the
   *  mid-path traversal for G8 module-scoped writes. */
  arraySegmentIndex: number | null;
  /** Write mode — "merge" shallow-merges into the parent, "replace" overwrites. */
  writeMode: "merge" | "replace";
}

export function resolveStoragePath(storage: StoragePath): ResolvedPath {
  const path = typeof storage === "string" ? storage : storage.path;
  const arraySelector = isStruct(storage) && storage.arrayKey && storage.selectorValue !== undefined
    ? { key: storage.arrayKey, value: storage.selectorValue }
    : null;
  const writeMode: "merge" | "replace" =
    isStruct(storage) && storage.writeMode === "merge" ? "merge" : "replace";

  // Detect root, then capture the array-marker index BEFORE stripping
  // brackets so `applyAtPath` can tell mid-path arrays from
  // final-segment arrays.
  function buildAfter(rootStripped: string, root: StorageRoot): ResolvedPath {
    const rawParts = rootStripped.split(".");
    let arraySegmentIndex: number | null = null;
    for (let i = 0; i < rawParts.length; i++) {
      if (rawParts[i].endsWith("[]")) {
        arraySegmentIndex = i;
        break;
      }
    }
    return {
      root,
      segments: stripBrackets(rawParts),
      arraySelector,
      arraySegmentIndex,
      writeMode,
    };
  }

  if (path.startsWith("config.")) {
    return buildAfter(path.slice("config.".length), "config");
  }
  if (path.startsWith("sessionFlow.")) {
    return buildAfter(path.slice("sessionFlow.".length), "sessionFlow");
  }
  if (path.startsWith("tolerances.")) {
    return buildAfter(path.slice("tolerances.".length), "tolerances");
  }
  if (path.startsWith("playbook.voiceConfig.")) {
    return buildAfter(path.slice("playbook.voiceConfig.".length), "playbook.voiceConfig");
  }
  if (path.startsWith("domain.")) {
    return buildAfter(path.slice("domain.".length), "domain");
  }
  if (path.startsWith("behaviorTargets")) {
    // behaviorTargets keeps the legacy split-on-dot behaviour; the array
    // marker sits inside the bracket-segment itself, not as a trailing `[]`.
    return {
      root: "behaviorTargets",
      segments: stripBrackets(path.split(".")),
      arraySelector,
      arraySegmentIndex: null,
      writeMode,
    };
  }
  return { root: "unknown", segments: [], arraySelector, arraySegmentIndex: null, writeMode };
}

/** Apply a value at the resolved path inside a PlaybookConfig clone. */
export function applyAtPath(
  config: PlaybookConfig,
  resolved: ResolvedPath,
  value: unknown,
): PlaybookConfig {
  // Phase 2A handles only the `playbookConfig`-rooted writes (config /
  // sessionFlow / tolerances / playbook.voiceConfig). Domain writes go
  // to a separate route; behaviorTargets is its own model.
  let parent: Record<string, unknown> = config as Record<string, unknown>;
  switch (resolved.root) {
    case "config":
      // segments traverse PlaybookConfig directly
      break;
    case "sessionFlow":
      parent = ensureObject(parent, "sessionFlow");
      break;
    case "tolerances":
      parent = ensureObject(parent, "tolerances");
      break;
    case "playbook.voiceConfig":
      parent = ensureObject(parent, "voiceConfig");
      break;
    case "domain":
    case "behaviorTargets":
    case "unknown":
      // Caller handles these — leave the config untouched. The PATCH
      // route returns 501 / 400 for these cases.
      return config;
  }

  // Mid-path array (P3c, #1850): `config.modules[].settings.<key>` where
  // `modules` is the array and `settings.<key>` lives WITHIN each
  // matched element. Walk up to the array segment, locate / create the
  // matching element, then dive into its trailing segments. The
  // final-segment array branch below handles the legacy
  // `sessionFlow.stops[]` case (array IS the final segment).
  const lastIdx = resolved.segments.length - 1;
  if (
    resolved.arraySelector &&
    resolved.arraySegmentIndex !== null &&
    resolved.arraySegmentIndex < lastIdx
  ) {
    // Walk segments up to (but not including) the array segment as objects.
    for (let i = 0; i < resolved.arraySegmentIndex; i++) {
      parent = ensureObject(parent, resolved.segments[i]);
    }
    // The array segment itself.
    const arrayKey = resolved.segments[resolved.arraySegmentIndex];
    const arr = ensureArray(parent, arrayKey);
    let idx = arr.findIndex(
      (it) =>
        typeof it === "object" &&
        it !== null &&
        (it as Record<string, unknown>)[resolved.arraySelector!.key] ===
          resolved.arraySelector!.value,
    );
    if (idx === -1) {
      // Element doesn't yet exist → seed it with the selector key.
      arr.push({
        [resolved.arraySelector.key]: resolved.arraySelector.value,
      });
      idx = arr.length - 1;
    }
    let element = arr[idx] as Record<string, unknown>;
    if (typeof element !== "object" || element === null) {
      element = { [resolved.arraySelector.key]: resolved.arraySelector.value };
      arr[idx] = element;
    }
    // Walk the trailing segments WITHIN the matched element.
    let cursor: Record<string, unknown> = element;
    for (let i = resolved.arraySegmentIndex + 1; i < lastIdx; i++) {
      cursor = ensureObject(cursor, resolved.segments[i]);
    }
    const finalKey = resolved.segments[lastIdx];
    if (!finalKey) return config;
    if (
      resolved.writeMode === "merge" &&
      typeof value === "object" &&
      value !== null &&
      typeof cursor[finalKey] === "object" &&
      cursor[finalKey] !== null
    ) {
      cursor[finalKey] = {
        ...(cursor[finalKey] as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      cursor[finalKey] = value;
    }
    return config;
  }

  // Walk segments creating intermediate objects.
  for (let i = 0; i < resolved.segments.length - 1; i++) {
    parent = ensureObject(parent, resolved.segments[i]);
  }

  const finalKey = resolved.segments[resolved.segments.length - 1];
  if (!finalKey) return config; // empty path — no-op

  // Array-with-selector path: find or push the matching element.
  if (resolved.arraySelector) {
    const arr = ensureArray(parent, finalKey);
    const idx = arr.findIndex(
      (it) =>
        typeof it === "object" &&
        it !== null &&
        (it as Record<string, unknown>)[resolved.arraySelector!.key] ===
          resolved.arraySelector!.value,
    );
    if (idx === -1) {
      // Element doesn't exist → push a new one with the selector keyed.
      arr.push({
        [resolved.arraySelector.key]: resolved.arraySelector.value,
        ...(typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)
          : { value }),
      });
    } else {
      const existing = arr[idx] as Record<string, unknown>;
      if (resolved.writeMode === "merge" && typeof value === "object" && value !== null) {
        arr[idx] = { ...existing, ...(value as Record<string, unknown>) };
      } else {
        arr[idx] = value;
      }
    }
    return config;
  }

  // Simple write — replace at finalKey.
  if (
    resolved.writeMode === "merge" &&
    typeof value === "object" &&
    value !== null &&
    typeof parent[finalKey] === "object" &&
    parent[finalKey] !== null
  ) {
    parent[finalKey] = {
      ...(parent[finalKey] as Record<string, unknown>),
      ...(value as Record<string, unknown>),
    };
  } else {
    parent[finalKey] = value;
  }
  return config;
}

function ensureObject(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const cur = parent[key];
  if (typeof cur === "object" && cur !== null && !Array.isArray(cur)) {
    return cur as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function ensureArray(parent: Record<string, unknown>, key: string): unknown[] {
  const cur = parent[key];
  if (Array.isArray(cur)) return cur;
  const next: unknown[] = [];
  parent[key] = next;
  return next;
}

function isStruct(s: StoragePath): s is StoragePathStruct {
  return typeof s !== "string";
}

function stripBrackets(parts: string[]): string[] {
  return parts.map((p) => p.replace(/\[\]$/, ""));
}
