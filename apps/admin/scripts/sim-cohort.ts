/**
 * sim-cohort.ts — One-shot N-call cohort driver.
 *
 * Calls `sim-drive-call.ts` N times in sequence against a single caller.
 * Per-call options:
 *   • Module pick (e.g. `part2` / `part3` / `mock`) — passed as `--module=`
 *   • AI-led (no module pick) — `--module=` omitted
 *   • Persona — same persona across the cohort (configurable)
 *   • Turn count — same across cohort
 *
 * Between calls: short pause so the pipeline writes settle + the dev
 * server's prompt cache refreshes. sim-drive-call fires `mode=prompt`
 * pipeline at end of each call, which composes the next-call prompt
 * automatically.
 *
 * Usage:
 *   npx tsx scripts/sim-cohort.ts <callerId> --plan='[{"label":"warmup","module":null},{"label":"focus-part2","module":"part2"},{"label":"mock","module":"mock"}]' --persona="..." --turns=6
 *
 * Or use the shorthand `--n=8 --picks=3:part2,5:part2,6:part3,8:mock`:
 *   npx tsx scripts/sim-cohort.ts <callerId> --n=8 --picks=3:part2,5:part2,6:part3,8:mock --persona="..." --turns=5
 *
 * Output: prints per-call summary + final snapshot of CallerModuleProgress
 * + CallerTarget so you can see the trajectory.
 *
 * @see scripts/sim-drive-call.ts
 * @see scripts/snap-ielts-progress.ts
 */

import { spawn } from "node:child_process";
import * as path from "node:path";

interface CohortCall {
  index: number;
  label: string;
  module: string | null;
}

interface Args {
  callerId: string;
  plan: CohortCall[];
  persona: string;
  turns: number;
  /** Pause (ms) between calls — gives pipeline writes time to settle. */
  pauseMs: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let callerId: string | null = null;
  let planRaw: string | null = null;
  let nRaw: string | null = null;
  let picksRaw: string | null = null;
  let persona = "Polish receptionist, B2 English, nervous but keen, sometimes drops articles";
  let turns = 5;
  let pauseMs = 3000;

  for (const a of argv) {
    if (a.startsWith("--plan=")) planRaw = a.slice("--plan=".length);
    else if (a.startsWith("--n=")) nRaw = a.slice("--n=".length);
    else if (a.startsWith("--picks=")) picksRaw = a.slice("--picks=".length);
    else if (a.startsWith("--persona=")) persona = a.slice("--persona=".length);
    else if (a.startsWith("--turns=")) turns = parseInt(a.slice("--turns=".length), 10) || 5;
    else if (a.startsWith("--pause=")) pauseMs = parseInt(a.slice("--pause=".length), 10) || 3000;
    else if (!a.startsWith("--")) callerId = a;
  }

  if (!callerId) {
    console.error("Missing <callerId> — first positional arg.");
    process.exit(1);
  }

  let plan: CohortCall[] = [];
  if (planRaw) {
    try {
      const parsed = JSON.parse(planRaw) as Array<{ label?: string; module?: string | null }>;
      plan = parsed.map((p, i) => ({
        index: i + 1,
        label: p.label ?? `Call #${i + 1}`,
        module: p.module ?? null,
      }));
    } catch (err: any) {
      console.error("Failed to parse --plan=...: " + err.message);
      process.exit(1);
    }
  } else if (nRaw) {
    const n = parseInt(nRaw, 10);
    if (!n || n < 1) {
      console.error("--n must be a positive integer");
      process.exit(1);
    }
    const picks = new Map<number, string>();
    if (picksRaw) {
      for (const entry of picksRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const [idxStr, module] = entry.split(":");
        const idx = parseInt(idxStr, 10);
        if (!idx || !module) {
          console.error(`Bad pick entry "${entry}" — expected format \`N:module\` (e.g. \`3:part2\`)`);
          process.exit(1);
        }
        picks.set(idx, module);
      }
    }
    for (let i = 1; i <= n; i++) {
      const module = picks.get(i) ?? null;
      plan.push({
        index: i,
        label: module ? `Call #${i} (${module})` : `Call #${i} (AI-led)`,
        module,
      });
    }
  } else {
    console.error("Provide either --plan=<json> or --n=<count> [--picks=N:module,...]");
    process.exit(1);
  }

  return { callerId, plan, persona, turns, pauseMs };
}

function runOneCall(callerId: string, label: string, module: string | null, persona: string, turns: number): Promise<{ exitCode: number; lastLine: string }> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, "sim-drive-call.ts");
    const args: string[] = ["tsx", scriptPath];
    if (module) args.push(`--module=${module}`);
    args.push(`--persona=${persona}`, `--turns=${turns}`, callerId, label);

    const child = spawn("npx", args, {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let buf = "";
    let lastLine = "";
    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      buf += s;
      process.stdout.write(s);
      const lines = s.trim().split("\n").filter(Boolean);
      if (lines.length > 0) lastLine = lines[lines.length - 1];
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? -1, lastLine }));
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { callerId, plan, persona, turns, pauseMs } = parseArgs();

  console.log("\n" + "═".repeat(78));
  console.log(` SIM COHORT — ${plan.length} calls against ${callerId.slice(0, 8)}`);
  console.log("═".repeat(78));
  console.log(`  Persona: ${persona}`);
  console.log(`  Turns per call: ${turns}`);
  console.log(`  Pause between calls: ${pauseMs}ms`);
  console.log(`  Plan:`);
  for (const c of plan) {
    console.log(`    ${String(c.index).padStart(2)}. ${c.label.padEnd(40)} module=${c.module ?? "(AI-led)"}`);
  }
  console.log("═".repeat(78) + "\n");

  const startedAt = Date.now();
  const results: Array<{ index: number; label: string; module: string | null; ok: boolean; lastLine: string }> = [];

  for (const c of plan) {
    console.log(`\n┌─ Call ${c.index}/${plan.length} ─ ${c.label} ─ module=${c.module ?? "(AI-led)"}`);
    const callStart = Date.now();
    try {
      const { exitCode, lastLine } = await runOneCall(callerId, c.label, c.module, persona, turns);
      const dur = Math.round((Date.now() - callStart) / 1000);
      const ok = exitCode === 0;
      results.push({ index: c.index, label: c.label, module: c.module, ok, lastLine });
      console.log(`└─ Call ${c.index} ${ok ? "✓" : "✗"} in ${dur}s  ${lastLine}\n`);
    } catch (err: any) {
      results.push({ index: c.index, label: c.label, module: c.module, ok: false, lastLine: err?.message ?? "spawn error" });
      console.error(`└─ Call ${c.index} ✗ FAILED — ${err?.message ?? err}\n`);
    }

    if (c.index < plan.length) {
      console.log(`   waiting ${pauseMs}ms for pipeline writes to settle...`);
      await sleep(pauseMs);
    }
  }

  const wallSec = Math.round((Date.now() - startedAt) / 1000);
  console.log("\n" + "═".repeat(78));
  console.log(` COHORT COMPLETE in ${wallSec}s`);
  console.log("═".repeat(78));
  const ok = results.filter((r) => r.ok).length;
  console.log(`  Calls: ${ok}/${results.length} succeeded`);
  for (const r of results) {
    console.log(`    ${r.ok ? "✓" : "✗"} #${r.index}  ${r.label.padEnd(40)} module=${r.module ?? "AI-led"}`);
  }
  console.log("═".repeat(78));
  console.log("\nNow run `npx tsx scripts/snap-ielts-progress.ts` to see the trajectory.");
}

main().catch((err) => {
  console.error("[sim-cohort] crash:", err);
  process.exit(1);
});
