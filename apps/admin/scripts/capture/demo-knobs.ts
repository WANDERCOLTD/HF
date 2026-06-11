/**
 * demo-knobs.ts — Tier-2 KB generator for Epic #1442 Layer 3 Slice 1.
 *
 * Emits `docs/kb/generated/demo-knobs.json` — the operator-facing
 * catalogue of cascade-resolvable knobs that drive the demo experience.
 * Imports `LISTED_KNOBS` from `lib/cascade/knob-keys.ts` (side-effect-free
 * module by design — see header there) so the generator can run under
 * `npx tsx` without dragging the Prisma / Next runtime into scope.
 *
 * Cross-references `COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS` for the
 * `composeAffecting` flag. NB: that constant covers `Playbook.config` blob
 * keys ONLY. `BEH-*` knobs flow through composition indirectly (AGGREGATE
 * stage), so they are NEVER marked compose-affecting here — they
 * influence the next-call prompt but live outside the config-blob
 * staleness contract.
 *
 * Run:  npx tsx scripts/capture/demo-knobs.ts        (from apps/admin)
 * CI:   re-run and `git diff --exit-code -I '"generatedAt":'` to catch drift.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LISTED_KNOBS, type ListedKnob } from "../../lib/cascade/knob-keys";
import { COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS } from "../../lib/compose/affecting-keys";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const OUT_PATH = resolve(REPO_ROOT, "docs/kb/generated/demo-knobs.json");

interface KnobRow extends ListedKnob {
  composeAffecting: boolean;
}

function composeAffectingFor(knob: ListedKnob): boolean {
  // The compose-staleness contract only tracks Playbook.config blob keys.
  // BEH-* and identity-spec flow through AGGREGATE / extract-identity
  // respectively — they affect downstream prompts but are NOT in the
  // config-blob set. Filter to only the families whose knobKey IS a
  // direct config-blob field.
  if (knob.family !== "session-flow" && knob.family !== "welcome-message") {
    return false;
  }
  return (COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS as readonly string[]).includes(
    knob.knobKey,
  );
}

function main(): void {
  const knobs: KnobRow[] = LISTED_KNOBS.map((knob) => ({
    ...knob,
    composeAffecting: composeAffectingFor(knob),
  }));

  const out = {
    $schema: "demo-knobs/v1",
    generatedAt: new Date().toISOString(),
    knobs,
  };

  const dir = dirname(OUT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

  const demoCount = knobs.filter((k) => k.demoKnob).length;
  console.log(
    `[demo-knobs] ${knobs.length} knobs (${demoCount} demoKnob:true) → ${OUT_PATH}`,
  );
}

main();
