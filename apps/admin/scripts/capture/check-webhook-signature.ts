/**
 * check-webhook-signature.ts — meta-guard for voice-provider webhook verification.
 *
 * Audit HF-K. The Retell provider shipped a `verifyInboundRequest` STUB that
 * returned null unconditionally — i.e. every inbound webhook was trusted without
 * signature verification (#1079 follow-up debt, fixed in HF-C). This guard makes
 * that regression structurally impossible: every voice provider's
 * `verifyInboundRequest` method MUST do real work — it may NOT be a trivial
 * `return null` stub.
 *
 * A passing impl either delegates to a verifier (`verifyVapiRequest`,
 * `verifyRetellRequest`, …) or computes an HMAC inline. The "pass-through when no
 * secret is configured" early-return lives INSIDE those verifiers (dev ergonomics),
 * not in the provider method — so this guard correctly flags only the no-op shape.
 *
 * Run:  npx tsx scripts/capture/check-webhook-signature.ts   (from apps/admin)
 * Wired into `npm run kb:check`.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = resolve(SCRIPT_DIR, "../../lib/voice/providers");

/** Extract the body of `verifyInboundRequest(...) { ... }` via brace matching. */
function extractMethodBody(src: string, methodName: string): string | null {
  const sigIdx = src.indexOf(`${methodName}(`);
  if (sigIdx === -1) return null;
  const openIdx = src.indexOf("{", sigIdx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** Strip comments + `void identifier;` no-op statements + whitespace. */
function normalizeBody(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, "") // line comments
    .replace(/void\s+\w+\s*;/g, "") // `void _req;` no-ops
    .replace(/\s+/g, ""); // all whitespace
}

function main() {
  const offenders: string[] = [];
  const checked: string[] = [];

  for (const entry of readdirSync(PROVIDERS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = `${PROVIDERS_DIR}/${entry.name}/index.ts`;
    if (!existsSync(indexPath)) continue;
    const src = readFileSync(indexPath, "utf8");
    const body = extractMethodBody(src, "verifyInboundRequest");
    if (body === null) continue; // provider doesn't implement it — not our concern here
    checked.push(entry.name);
    const norm = normalizeBody(body);
    // Stub shapes: empty body, or just `return null` / `returnnull;`.
    if (norm === "" || /^return(null)?;?$/.test(norm)) {
      offenders.push(`${entry.name} (lib/voice/providers/${entry.name}/index.ts)`);
    }
  }

  console.log(
    `[webhook-signature] checked ${checked.length} provider(s): ${checked.join(", ")}`,
  );

  if (offenders.length) {
    console.error(
      `\n✖ ${offenders.length} voice provider(s) have a no-op verifyInboundRequest stub:\n` +
        offenders.map((o) => `    - ${o}`).join("\n") +
        `\n\n  A provider webhook verifier MUST do real work (delegate to a verify*` +
        `\n  helper or compute an HMAC). The "pass-through when unconfigured" early` +
        `\n  return belongs INSIDE the verifier, not the provider method. See` +
        `\n  docs/kb/guard-registry.md#guard-check-webhook-signature (audit HF-K).\n`,
    );
    process.exit(1);
  }

  console.log("✔ all voice-provider webhook verifiers do real work.");
}

main();
