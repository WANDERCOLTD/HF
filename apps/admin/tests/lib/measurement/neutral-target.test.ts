/**
 * NEUTRAL_PARAMETER_TARGET — pin the canonical midpoint + adoption.
 *
 * **What this test pins:**
 *  1. The constant value (0.5) and tolerance (0.05) — surprising drift
 *     would silently change tutor behavior across all consumers.
 *  2. No transform under `lib/prompt/composition/transforms/` falls back
 *     to a bare `?? 0.5` literal — every neutral-target fallback must use
 *     the named constant. The ratchet catches new offenders before merge.
 *
 *  See `.claude/rules/pipeline-and-prompt.md` — composition transforms
 *  must not hold raw behavior values; sourced or semantically-named only.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  NEUTRAL_PARAMETER_TARGET,
  NEUTRAL_TARGET_TOLERANCE,
} from "@/lib/measurement/neutral-target";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const TRANSFORMS_DIR = join(
  REPO_ADMIN,
  "lib",
  "prompt",
  "composition",
  "transforms",
);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("NEUTRAL_PARAMETER_TARGET — canonical midpoint", () => {
  it("constant value is 0.5", () => {
    expect(NEUTRAL_PARAMETER_TARGET).toBe(0.5);
  });

  it("tolerance is 0.05", () => {
    expect(NEUTRAL_TARGET_TOLERANCE).toBe(0.05);
  });

  it("no transform falls back to a bare `?? 0.5` literal", () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of listTsFiles(TRANSFORMS_DIR)) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        // `?? 0.5` with a word-boundary trailing — matches `0.5,` `0.5)` `0.5;`
        // but NOT `0.55`. Skips `NEUTRAL_PARAMETER_TARGET` itself.
        if (/\?\?\s*0\.5(?![0-9])/.test(line)) {
          offenders.push({
            file: file.replace(REPO_ADMIN + "/", ""),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }
    expect(
      offenders,
      `Bare \`?? 0.5\` fallback in composition transforms — replace with NEUTRAL_PARAMETER_TARGET from @/lib/measurement/neutral-target:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
