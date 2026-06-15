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

  // Detect root and strip the placeholder `[]` if present.
  if (path.startsWith("config.")) {
    return {
      root: "config",
      segments: stripBrackets(path.slice("config.".length).split(".")),
      arraySelector,
      writeMode,
    };
  }
  if (path.startsWith("sessionFlow.")) {
    return {
      root: "sessionFlow",
      segments: stripBrackets(path.slice("sessionFlow.".length).split(".")),
      arraySelector,
      writeMode,
    };
  }
  if (path.startsWith("tolerances.")) {
    return {
      root: "tolerances",
      segments: stripBrackets(path.slice("tolerances.".length).split(".")),
      arraySelector,
      writeMode,
    };
  }
  if (path.startsWith("playbook.voiceConfig.")) {
    return {
      root: "playbook.voiceConfig",
      segments: stripBrackets(path.slice("playbook.voiceConfig.".length).split(".")),
      arraySelector,
      writeMode,
    };
  }
  if (path.startsWith("domain.")) {
    return {
      root: "domain",
      segments: stripBrackets(path.slice("domain.".length).split(".")),
      arraySelector,
      writeMode,
    };
  }
  if (path.startsWith("behaviorTargets")) {
    return {
      root: "behaviorTargets",
      segments: stripBrackets(path.split(".")),
      arraySelector,
      writeMode,
    };
  }
  return { root: "unknown", segments: [], arraySelector, writeMode };
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
