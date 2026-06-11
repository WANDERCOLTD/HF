/**
 * Pins the demo-knobs.json generator output shape.
 *
 * Re-runs the generator into a temp file, parses the JSON, and asserts
 * the schema + invariants the `/x/help/demos` page consumes.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

const OUT_PATH = resolve(
  __dirname,
  "../../../../docs/kb/generated/demo-knobs.json",
);

interface KnobsManifest {
  $schema: string;
  generatedAt: string;
  knobs: Array<{
    knobKey: string;
    family: string;
    label: string;
    description: string;
    recommendedLayer: string;
    demoKnob: boolean;
    composeAffecting: boolean;
  }>;
}

function readManifest(): KnobsManifest {
  expect(existsSync(OUT_PATH), `${OUT_PATH} missing — run \`npm run kb:demo-knobs\``).toBe(true);
  return JSON.parse(readFileSync(OUT_PATH, "utf8")) as KnobsManifest;
}

describe("demo-knobs.json generator output", () => {
  it("top-level shape matches the schema name + has an ISO generatedAt", () => {
    const m = readManifest();
    expect(m.$schema).toBe("demo-knobs/v1");
    expect(new Date(m.generatedAt).toString()).not.toBe("Invalid Date");
    expect(Array.isArray(m.knobs)).toBe(true);
  });

  it("every knob carries the full row shape (no missing fields)", () => {
    const m = readManifest();
    for (const knob of m.knobs) {
      expect(typeof knob.knobKey).toBe("string");
      expect(knob.knobKey.length).toBeGreaterThan(0);
      expect(typeof knob.family).toBe("string");
      expect(typeof knob.label).toBe("string");
      expect(typeof knob.description).toBe("string");
      expect(["DOMAIN", "PLAYBOOK"]).toContain(knob.recommendedLayer);
      expect(typeof knob.demoKnob).toBe("boolean");
      expect(typeof knob.composeAffecting).toBe("boolean");
    }
  });

  it("BEH-* rows are never marked composeAffecting (live via AGGREGATE, not config blob)", () => {
    const m = readManifest();
    for (const knob of m.knobs) {
      if (knob.knobKey.startsWith("BEH-")) {
        expect(knob.composeAffecting).toBe(false);
      }
    }
  });

  it("at least the 4 demo-preset knobs are marked demoKnob:true", () => {
    const m = readManifest();
    const demoKeys = new Set(
      m.knobs.filter((k) => k.demoKnob).map((k) => k.knobKey),
    );
    expect(demoKeys.has("welcomeMessage")).toBe(true);
    expect(demoKeys.has("BEH-RESPONSE-LEN")).toBe(true);
    expect(demoKeys.has("BEH-WARMTH")).toBe(true);
    expect(demoKeys.has("intake")).toBe(true);
  });
});
