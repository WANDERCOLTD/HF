/**
 * DEFAULT_VOICE_PROVIDER_SLUG — pin + adoption ratchet.
 *
 * Pin: value is "vapi" (an operator-visible change to flip this would be
 * a deployment-affecting decision; the test catches accidental drift).
 *
 * Ratchet: no consumer under `apps/admin/lib/voice/` falls back to a
 * bare `?? "vapi"` outside the provider's own identity file. Provider-
 * internal `slug = "vapi"` is excluded — that's the provider's own
 * name, not "the default fallback."
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { DEFAULT_VOICE_PROVIDER_SLUG } from "@/lib/voice/default-provider";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const VOICE_DIR = join(REPO_ADMIN, "lib", "voice");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Provider-internal identity files where `slug = "vapi"` is the provider's own name. */
const PROVIDER_IDENTITY_FILES = [
  "lib/voice/providers/vapi/index.ts",
  "lib/voice/llm-proxy/run-vapi-chat-completion.ts",
  "lib/voice/default-provider.ts",
];

describe("DEFAULT_VOICE_PROVIDER_SLUG", () => {
  it('exports "vapi"', () => {
    expect(DEFAULT_VOICE_PROVIDER_SLUG).toBe("vapi");
  });

  it('no fallback `?? "vapi"` under lib/voice/ outside provider identity files', () => {
    const PATTERN = /\?\?\s*"vapi"/;
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of walk(VOICE_DIR)) {
      const rel = file.replace(REPO_ADMIN + "/", "");
      if (PROVIDER_IDENTITY_FILES.includes(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (!PATTERN.test(src)) continue;
      src.split("\n").forEach((line, idx) => {
        if (PATTERN.test(line)) {
          offenders.push({ file: rel, line: idx + 1, text: line.trim() });
        }
      });
    }
    expect(
      offenders,
      `Bare \`?? "vapi"\` fallback — use DEFAULT_VOICE_PROVIDER_SLUG from @/lib/voice/default-provider:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.text}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
