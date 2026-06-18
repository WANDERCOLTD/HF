/**
 * parametersAsDirectives — #1907 dispatcher transform.
 *
 * Reads behaviour-parameter entries that carry a `promptInjection` block in
 * the registry, resolves each parameter's effective cascade target via the
 * batched `getEffectiveBehaviorTargetsForCaller` reader, picks the
 * template variant (low vs high vs always) for the resolved value, and
 * emits one directive string per parameter into the [STYLE] (or other
 * named) section of the composed prompt.
 *
 * Architectural notes:
 *
 *   - **One DB read per compose cycle.** The cascade resolver is called
 *     ONCE with `(playbookId, callerId)`. Resolving 70 params via
 *     `resolveBehaviorTarget` would cost ~350 queries; the batched helper
 *     does 3.
 *
 *   - **Null-effective contract.** When the cascade resolves to no
 *     populated layer (parameter has no SYSTEM/PLAYBOOK/CALLER row), the
 *     dispatcher silently skips emission for that parameter. The next
 *     turn of the LLM proxy will see no directive for it — same as if
 *     `promptInjection` were not set. This is the documented "skip + log"
 *     behaviour from `parameter-coverage.md`.
 *
 *   - **Sibling-writer: targets.ts.** The existing `targets.ts` transform
 *     emits structured `BehaviorTarget` data to the LLM via
 *     `instructions.behavior_targets_summary` — distinct presentation
 *     (structured context vs natural-language directive). The two coexist
 *     without conflict; both can mention the same `parameterId` because
 *     the LLM consumes them as separate signals (data + guidance).
 *
 *   - **`@renderer-consumed-at` sentinel.** Required by the
 *     `composition-directive-needs-renderer` ESLint rule (#1848). Render
 *     site: `renderPromptSummary.ts::renderProviderPrompt`.
 *
 * @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts
 *
 * @see docs/decisions/2026-06-17-registry-schema-coverage.md
 * @see .claude/rules/parameter-coverage.md
 * @see github.com/.../issues/1907
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import { getEffectiveBehaviorTargetsForCaller } from "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller";
import { NEUTRAL_PARAMETER_TARGET } from "@/lib/measurement/neutral-target";

// ── Registry shape ──────────────────────────────────────────────────────
// Mirror of the JSON shape; promptInjection is optional. Only entries
// that carry it participate in the dispatcher.

interface PromptInjectionConfig {
  /** Render section name — e.g. "STYLE", "AUDIENCE", "PEDAGOGY". */
  section: string;
  /**
   * Emission gate: "always" emits regardless of value; "when-non-default"
   * skips emission when the effective value equals `defaultTarget`. The
   * latter is the documented default for behaviour-shape params.
   */
  condition?: "always" | "when-non-default";
  /**
   * Single-template path: a single directive line, with `{value}` token
   * substitution. Mutually exclusive with templateLow/templateHigh.
   */
  template?: string;
  /**
   * Bipolar template path: pick `templateLow` when effectiveValue <
   * threshold, `templateHigh` otherwise. Useful for axis-style params
   * (abstract↔concrete, formal↔casual, etc.).
   */
  templateLow?: string;
  templateHigh?: string;
  /** Threshold for the bipolar split (default 0.5). */
  threshold?: number;
}

interface RegistryEntry {
  parameterId: string;
  defaultTarget: number;
  promptInjection?: PromptInjectionConfig;
}

interface Registry {
  parameters: RegistryEntry[];
}

// ── Module-level load of the registry JSON ──────────────────────────────
// Loaded once per server process — the JSON is seed-data, byte-identical
// across compose cycles within a deployment.

let _registryCache: Registry | null = null;
function loadRegistry(): Registry {
  if (_registryCache) return _registryCache;
  const registryPath = resolve(
    process.cwd(),
    "docs-archive",
    "bdd-specs",
    "behavior-parameters.registry.json",
  );
  try {
    const text = readFileSync(registryPath, "utf8");
    _registryCache = JSON.parse(text) as Registry;
  } catch (err) {
    console.warn(
      `[parametersAsDirectives] failed to load registry from ${registryPath}:`,
      err instanceof Error ? err.message : String(err),
    );
    _registryCache = { parameters: [] };
  }
  return _registryCache;
}

// ── Directive rendering ─────────────────────────────────────────────────

interface SectionDirectives {
  section: string;
  directives: string[];
}

function pickTemplate(
  cfg: PromptInjectionConfig,
  effectiveValue: number,
): string | null {
  // Single-template path
  if (cfg.template) {
    return cfg.template.replace(/\{value\}/g, formatValue(effectiveValue));
  }
  // Bipolar template path
  const threshold = cfg.threshold ?? NEUTRAL_PARAMETER_TARGET;
  if (effectiveValue >= threshold) {
    return cfg.templateHigh ?? cfg.templateLow ?? null;
  }
  return cfg.templateLow ?? cfg.templateHigh ?? null;
}

function formatValue(v: number): string {
  // Two decimals; trim trailing zeros so 0.50 → "0.5", 0.75 → "0.75".
  return Number.isFinite(v)
    ? v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
    : "";
}

// ── Transform ───────────────────────────────────────────────────────────

interface DispatcherInput {
  playbookId: string | null;
  callerId: string;
}

interface DispatcherOutput {
  /** Sections grouped by name, each with its emitted directive lines. */
  sections: SectionDirectives[];
  /** Total directive count emitted across all sections. */
  directiveCount: number;
}

registerTransform(
  "parametersAsDirectives",
  async (
    rawData: DispatcherInput,
    _context: AssembledContext,
  ): Promise<DispatcherOutput> => {
    const { playbookId, callerId } = rawData;

    if (!playbookId || !callerId) {
      return { sections: [], directiveCount: 0 };
    }

    const registry = loadRegistry();
    const injectable = registry.parameters.filter(
      (p): p is RegistryEntry & { promptInjection: PromptInjectionConfig } =>
        Boolean(p.promptInjection),
    );

    if (injectable.length === 0) {
      return { sections: [], directiveCount: 0 };
    }

    // ── Single batched cascade read for all parameters at once ─────────
    const effective = await getEffectiveBehaviorTargetsForCaller(
      playbookId,
      callerId,
    );
    const effectiveByParam = new Map(
      effective.map((e) => [e.parameterId, e.effectiveValue]),
    );

    // ── Build directives grouped by section ────────────────────────────
    const bySection = new Map<string, string[]>();
    for (const entry of injectable) {
      const effectiveValue = effectiveByParam.get(entry.parameterId);

      // Null-effective contract: parameter has no populated cascade
      // layer — silently skip emission. The bundle (#1906) carries the
      // module content; the directive layer is purely supplemental.
      if (effectiveValue === undefined) continue;

      // when-non-default gate: skip when value matches the seeded default
      const condition = entry.promptInjection.condition ?? "when-non-default";
      if (condition === "when-non-default" && effectiveValue === entry.defaultTarget) {
        continue;
      }

      const directive = pickTemplate(entry.promptInjection, effectiveValue);
      if (!directive) continue;

      const section = entry.promptInjection.section;
      const list = bySection.get(section) ?? [];
      list.push(directive);
      bySection.set(section, list);
    }

    const sections: SectionDirectives[] = Array.from(bySection.entries()).map(
      ([section, directives]) => ({ section, directives }),
    );
    const directiveCount = sections.reduce(
      (sum, s) => sum + s.directives.length,
      0,
    );

    return { sections, directiveCount };
  },
);
