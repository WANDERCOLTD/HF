/**
 * parameter-inventory.ts — Structural-fact generator: behaviour-parameter inventory.
 *
 * Emits two artefacts:
 *   - docs/kb/generated/parameter-inventory.json — machine-readable per-param record
 *   - docs/kb/generated/parameter-inventory.md   — human-readable table grouped by domainGroup
 *
 * For each parameter in `behavior-parameters.registry.json`, walks the same
 * `CONSUMER_DIRS` set as `tests/lib/measurement/parameter-coverage.test.ts`
 * and identifies which consumer file mentions the canonical id (or alias /
 * camelCase / SCREAMING_SNAKE variants). Output is the single source for
 * "is this parameter producer-only?" — gives pedagogy reviewers + operators
 * a one-look answer instead of having to read the test or grep the source.
 *
 * Pairs with the parameter-coverage ratchet test (same data, different
 * presentation). When new consumers land, regenerate this artefact in the
 * same commit so the inventory reflects reality.
 *
 * Run:  npx tsx scripts/capture/parameter-inventory.ts        (from apps/admin)
 * CI:   re-run and `git diff --exit-code -I '"generatedAt":'` to gate drift.
 *
 * Follow-on epic #1946; see issue #1965.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const APPS_ADMIN = resolve(REPO_ROOT, "apps/admin");
const REGISTRY_PATH = resolve(
  APPS_ADMIN,
  "docs-archive/bdd-specs/behavior-parameters.registry.json",
);
const OUT_JSON = resolve(REPO_ROOT, "docs/kb/generated/parameter-inventory.json");
const OUT_MD = resolve(REPO_ROOT, "docs/kb/generated/parameter-inventory.md");

// Mirror of `tests/lib/measurement/parameter-coverage.test.ts::CONSUMER_DIRS`.
// Keep in sync when one list moves.
const CONSUMER_DIRS = [
  "lib/prompt/composition/transforms",
  "lib/prompt/composition/loaders",
  "lib/prompt/composition",
  "lib/compose",
  "lib/pipeline",
  "lib/measurement",
  "lib/cascade/resolvers",
  "lib/scoring",
  "lib/tolerance",
  "lib/goals",
  "lib/voice",
  "lib/skill-banding",
  "lib/chat",
  "app/api",
];

interface RegistryEntry {
  parameterId: string;
  name?: string;
  definition?: string | null;
  domainGroup: string;
  defaultTarget?: number;
  interpretationHigh?: string | null;
  interpretationLow?: string | null;
  deprecatedAt?: string | null;
  aliases?: string[];
  skipInterpretationLengthCheck?: boolean;
  promptInjection?: unknown;
}

interface Registry {
  parameters: RegistryEntry[];
  generatedAt?: string;
  version?: string;
}

interface InventoryEntry {
  parameterId: string;
  name: string;
  domainGroup: string;
  deprecatedAt: string | null;
  hasInterpretationHigh: boolean;
  hasInterpretationLow: boolean;
  skipInterpretationLengthCheck: boolean;
  aliases: string[];
  consumerFiles: string[];
  classification: "covered" | "promptInjection-dispatcher" | "deprecated" | "gap";
}

function walkTs(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTs(full, acc);
    } else if (
      (e.endsWith(".ts") || e.endsWith(".tsx")) &&
      !e.endsWith(".test.ts") &&
      !e.endsWith(".spec.ts") &&
      !full.includes("/__tests__/")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

// Pre-compute the consumer files + cache their text per-file so we can
// report WHICH file matched a parameter id, not just whether any did.
function loadConsumerFiles(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const dir of CONSUMER_DIRS) {
    for (const file of walkTs(join(APPS_ADMIN, dir))) {
      try {
        const text = readFileSync(file, "utf8");
        out.push({ path: file, text });
      } catch {
        // skip unreadable
      }
    }
  }
  return out;
}

function searchTerms(parameterId: string): string[] {
  const variants = new Set<string>([parameterId]);
  // camelCase form
  variants.add(
    parameterId
      .replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase())
      .replace(/^([A-Z])/, (m) => m.toLowerCase()),
  );
  // SCREAMING_SNAKE
  variants.add(parameterId.toUpperCase().replace(/-/g, "_"));
  return Array.from(variants);
}

function findConsumers(
  p: RegistryEntry,
  consumerFiles: Array<{ path: string; text: string }>,
): string[] {
  const hits = new Set<string>();
  const allTerms = [p.parameterId, ...(p.aliases ?? [])].flatMap(searchTerms);
  for (const f of consumerFiles) {
    for (const term of allTerms) {
      if (term.length < 4) continue;
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(f.text)) {
        hits.add(f.path.replace(APPS_ADMIN + "/", ""));
        break;
      }
    }
  }
  return Array.from(hits).sort();
}

function classify(
  p: RegistryEntry,
  consumerFiles: string[],
): InventoryEntry["classification"] {
  if (p.deprecatedAt) return "deprecated";
  if (p.promptInjection) return "promptInjection-dispatcher";
  if (consumerFiles.length > 0) return "covered";
  return "gap";
}

function buildInventory(registry: Registry): InventoryEntry[] {
  const consumerFiles = loadConsumerFiles();
  return registry.parameters.map((p) => {
    const consumers = findConsumers(p, consumerFiles);
    return {
      parameterId: p.parameterId,
      name: p.name ?? p.parameterId,
      domainGroup: p.domainGroup,
      deprecatedAt: p.deprecatedAt ?? null,
      hasInterpretationHigh: Boolean(
        p.interpretationHigh && p.interpretationHigh.length > 0,
      ),
      hasInterpretationLow: Boolean(
        p.interpretationLow && p.interpretationLow.length > 0,
      ),
      skipInterpretationLengthCheck: Boolean(p.skipInterpretationLengthCheck),
      aliases: p.aliases ?? [],
      consumerFiles: consumers,
      classification: classify(p, consumers),
    };
  });
}

function renderJson(entries: InventoryEntry[]): string {
  return (
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        generator: "scripts/capture/parameter-inventory.ts",
        parameterCount: entries.length,
        active: entries.filter((e) => e.classification !== "deprecated").length,
        deprecated: entries.filter((e) => e.classification === "deprecated").length,
        gaps: entries.filter((e) => e.classification === "gap").length,
        entries,
      },
      null,
      2,
    ) + "\n"
  );
}

function renderMd(entries: InventoryEntry[]): string {
  const totalActive = entries.filter((e) => e.classification !== "deprecated").length;
  const totalGaps = entries.filter((e) => e.classification === "gap").length;
  const totalDispatcher = entries.filter(
    (e) => e.classification === "promptInjection-dispatcher",
  ).length;
  const totalCovered = entries.filter((e) => e.classification === "covered").length;
  const totalDeprecated = entries.filter((e) => e.classification === "deprecated").length;

  const byDomain = new Map<string, InventoryEntry[]>();
  for (const e of entries) {
    const list = byDomain.get(e.domainGroup) ?? [];
    list.push(e);
    byDomain.set(e.domainGroup, list);
  }
  const sortedDomains = Array.from(byDomain.keys()).sort();

  const lines: string[] = [];
  lines.push(
    `<!-- AUTO-GENERATED by scripts/capture/parameter-inventory.ts — do not edit by hand. -->`,
  );
  lines.push(``);
  lines.push(`# Parameter Inventory`);
  lines.push(``);
  lines.push(
    `Auto-generated from \`apps/admin/docs-archive/bdd-specs/behavior-parameters.registry.json\`. Edit the registry, not this file. \`npm run kb:parameter-inventory\` regenerates.`,
  );
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Class | Count |`);
  lines.push(`|---|---:|`);
  lines.push(`| Active parameters | ${totalActive} |`);
  lines.push(`| Deprecated | ${totalDeprecated} |`);
  lines.push(`| Covered by consumer file | ${totalCovered} |`);
  lines.push(`| Covered by promptInjection dispatcher | ${totalDispatcher} |`);
  lines.push(`| **Producer-only (gap)** | **${totalGaps}** |`);
  lines.push(`| **Total** | **${entries.length}** |`);
  lines.push(``);
  lines.push(`Producer-only entries are parameters with neither a code-level consumer nor a registry-driven \`promptInjection\` dispatcher — the operator can tune the cascade but nothing reads the value. See [\`tests/lib/measurement/parameter-coverage.test.ts\`](../../apps/admin/tests/lib/measurement/parameter-coverage.test.ts) for the ratchet pinning this count downward.`);
  lines.push(``);

  for (const domain of sortedDomains) {
    const rows = byDomain.get(domain)!;
    lines.push(`## \`${domain}\` (${rows.length})`);
    lines.push(``);
    lines.push(`| Parameter | Classification | Interpretations | Aliases | Consumer files |`);
    lines.push(`|---|---|---|---|---|`);
    for (const r of rows.sort((a, b) => a.parameterId.localeCompare(b.parameterId))) {
      const interp = [
        r.hasInterpretationHigh ? "H" : "—",
        r.hasInterpretationLow ? "L" : "—",
      ].join("/");
      const aliases = r.aliases.length > 0 ? r.aliases.join(", ") : "—";
      const consumers =
        r.consumerFiles.length === 0
          ? "—"
          : r.consumerFiles.length <= 3
            ? r.consumerFiles.map((c) => `\`${c}\``).join(", ")
            : `${r.consumerFiles
                .slice(0, 3)
                .map((c) => `\`${c}\``)
                .join(", ")}, +${r.consumerFiles.length - 3} more`;
      lines.push(
        `| \`${r.parameterId}\` | ${r.classification} | ${interp} | ${aliases} | ${consumers} |`,
      );
    }
    lines.push(``);
  }
  return lines.join("\n") + "\n";
}

function main() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Registry;
  const entries = buildInventory(registry);
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, renderJson(entries), "utf-8");
  writeFileSync(OUT_MD, renderMd(entries), "utf-8");
  console.log(`[parameter-inventory] wrote ${entries.length} entries`);
  console.log(`  → ${OUT_JSON}`);
  console.log(`  → ${OUT_MD}`);
}

main();
