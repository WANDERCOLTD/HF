/**
 * Resolve a current value at a `StoragePath` against the live
 * playbookConfig snapshot — Phase 4 of epic #1675.
 *
 * Mirrors the write-side `applyAtPath` from
 * `lib/journey/storage-path-applier.ts`. Returns `undefined` when the
 * path doesn't resolve.
 */

import type { StoragePath } from "@/lib/journey/setting-contracts";

export function resolveValueAtPath(
  config: Record<string, unknown> | null,
  storage: StoragePath,
): unknown {
  if (!config) return undefined;

  const path = typeof storage === "string" ? storage : storage.path;
  const arraySelector =
    typeof storage !== "string" &&
    storage.arrayKey &&
    storage.selectorValue !== undefined
      ? { key: storage.arrayKey, value: storage.selectorValue }
      : null;

  const segments = stripRoot(path).split(".").map((s) => s.replace(/\[\]$/, ""));
  const root = detectRoot(path);

  // Step into the root bucket inside `config`.
  let node: unknown = pickRoot(config, root);
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isObj(node)) return undefined;
    node = node[segments[i]];
  }
  const finalKey = segments[segments.length - 1];
  if (!finalKey) return undefined;

  if (arraySelector) {
    if (!isObj(node)) return undefined;
    const arr = node[finalKey];
    if (!Array.isArray(arr)) return undefined;
    const match = arr.find(
      (it) =>
        isObj(it) && it[arraySelector.key] === arraySelector.value,
    );
    return match;
  }

  if (!isObj(node)) return undefined;
  return node[finalKey];
}

function detectRoot(path: string): string {
  if (path.startsWith("config.")) return "config";
  if (path.startsWith("sessionFlow.")) return "sessionFlow";
  if (path.startsWith("tolerances.")) return "tolerances";
  if (path.startsWith("playbook.voiceConfig.")) return "voiceConfig";
  if (path.startsWith("domain.")) return "domain";
  if (path.startsWith("behaviorTargets")) return "behaviorTargets";
  return "unknown";
}

function pickRoot(
  config: Record<string, unknown>,
  root: string,
): unknown {
  switch (root) {
    case "config":
      // config.* paths read directly off the top-level PlaybookConfig
      return config;
    case "sessionFlow":
      return config.sessionFlow ?? null;
    case "tolerances":
      return config.tolerances ?? null;
    case "voiceConfig":
      return config.voiceConfig ?? null;
    default:
      // domain / behaviorTargets / unknown → not in playbookConfig
      return null;
  }
}

function stripRoot(path: string): string {
  if (path.startsWith("config.")) return path.slice("config.".length);
  if (path.startsWith("sessionFlow.")) return path.slice("sessionFlow.".length);
  if (path.startsWith("tolerances.")) return path.slice("tolerances.".length);
  if (path.startsWith("playbook.voiceConfig.")) return path.slice("playbook.voiceConfig.".length);
  if (path.startsWith("domain.")) return path.slice("domain.".length);
  return path;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
