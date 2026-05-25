#!/usr/bin/env tsx
/**
 * Reads a k6 --out json file and prints a verdict per scenario.
 * Pass/fail per threshold defined in k6.config.js.
 *
 * Streams input line-by-line — a 100-VU × 19-min run produces ~1GB,
 * hitting Node's max-string-length on naive readFileSync.
 *
 * Usage:
 *   npx tsx summarise.ts results/run-1779634000.json
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.argv[2];
if (!file) {
  console.error('usage: tsx summarise.ts <k6-output.json>');
  process.exit(2);
}

const TARGETS: Record<string, { p95?: number; label: string }> = {
  health: { p95: 200, label: '/api/health' },
  readiness: { p95: 500, label: '/api/system/readiness' },
  vapi_webhook: { p95: 500, label: 'POST /api/vapi/webhook' },
  pipeline: { p95: 2000, label: 'POST /api/calls/[id]/pipeline' },
  prisma_probe: { p95: 1500, label: '#191 probe routes' },
};

interface Sample {
  type: string;
  metric: string;
  data: { time: string; value: number; tags?: { scenario?: string; status?: string } };
}

const durations: Record<string, number[]> = {};
const failures: Record<string, number> = {};
const totals: Record<string, number> = {};
const failuresByStatus: Record<string, Record<string, number>> = {};

async function readPoints() {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let p: Sample | null;
    try {
      p = JSON.parse(line) as Sample;
    } catch {
      continue;
    }
    if (!p || p.type !== 'Point') continue;
    const scen = p.data.tags?.scenario;
    if (!scen) continue;
    if (p.metric === 'http_req_duration') {
      (durations[scen] ??= []).push(p.data.value);
    }
    if (p.metric === 'http_req_failed') {
      totals[scen] = (totals[scen] ?? 0) + 1;
      if (p.data.value === 1) {
        failures[scen] = (failures[scen] ?? 0) + 1;
        const status = p.data.tags?.status || 'unknown';
        (failuresByStatus[scen] ??= {})[status] = (failuresByStatus[scen]?.[status] ?? 0) + 1;
      }
    }
  }
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return Math.round(sorted[idx]);
}

function printSummary() {
  let overall = 'PASS';
  for (const [scen, samples] of Object.entries(durations)) {
    const target = TARGETS[scen];
    const p50 = pct(samples, 50);
    const p95 = pct(samples, 95);
    const p99 = pct(samples, 99);
    const errN = failures[scen] ?? 0;
    const totN = totals[scen] ?? samples.length;
    const errRate = totN > 0 ? errN / totN : 0;

    const verdict =
      target?.p95 && p95 > target.p95 ? 'FAIL'
      : errRate > 0.01 ? 'WARN'
      : 'PASS';
    if (verdict === 'FAIL') overall = 'FAIL';
    else if (verdict === 'WARN' && overall !== 'FAIL') overall = 'WARN';

    const label = target?.label ?? scen;
    console.log(
      `  ${label.padEnd(38)} p50=${String(p50).padStart(4)}ms  p95=${String(p95).padStart(4)}ms  p99=${String(p99).padStart(4)}ms  errors=${errN}/${totN}  ${verdict}` +
      (target?.p95 ? ` (target p95<${target.p95}ms)` : ''),
    );
  }

  // Failure breakdown by HTTP status — distinguishes gateway 429 vs app 5xx vs timeout
  for (const [scen, byStatus] of Object.entries(failuresByStatus)) {
    const top = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
    if (top.length > 0) {
      const breakdown = top.map(([s, n]) => `${s}=${n}`).join(' ');
      console.log(`  ${scen.padEnd(38)} failure breakdown by status: ${breakdown}`);
    }
  }

  console.log(`\nOverall: ${overall}`);
  process.exit(overall === 'FAIL' ? 1 : 0);
}

readPoints().then(printSummary).catch((e) => {
  console.error(e);
  process.exit(1);
});
