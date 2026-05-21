/**
 * Diagnose why Nico Grant shows "Caller Scores (3 of 50)" on the What tab.
 *
 * Prints:
 *   - Number of calls for the caller
 *   - Per-parameter score histogram: n_scores, min, max, spread, avg
 *   - Counts of parameters with spread > / <= CHANGED_THRESHOLD (0.05)
 *   - Counts of parameters whose scores are all zero
 *
 * Run: npx tsx scripts/diag-nico-scores.ts [callerNameQuery]
 */

import { prisma } from "@/lib/prisma";

const CHANGED_THRESHOLD = 0.05;

async function main() {
  const query = process.argv[2] || "Nico";

  const caller = await prisma.caller.findFirst({
    where: { name: { contains: query, mode: "insensitive" } },
    select: { id: true, name: true },
  });

  if (!caller) {
    console.error(`No caller matching "${query}"`);
    process.exit(1);
  }

  console.log(`Caller: ${caller.name} (${caller.id})`);

  const [callCount, scores] = await Promise.all([
    prisma.call.count({ where: { callerId: caller.id } }),
    prisma.callScore.findMany({
      where: { call: { callerId: caller.id } },
      select: {
        score: true,
        parameterId: true,
        confidence: true,
        parameter: { select: { name: true } },
      },
    }),
  ]);

  console.log(`Total calls: ${callCount}`);
  console.log(`Total CallScore rows: ${scores.length}`);

  const byParam = new Map<string, { name: string; values: number[]; confidences: (number | null)[] }>();
  for (const s of scores) {
    const key = s.parameterId;
    const name = s.parameter?.name ?? s.parameterId;
    if (!byParam.has(key)) byParam.set(key, { name, values: [], confidences: [] });
    byParam.get(key)!.values.push(s.score);
    byParam.get(key)!.confidences.push(s.confidence);
  }

  const rows = Array.from(byParam.values()).map((r) => {
    const min = Math.min(...r.values);
    const max = Math.max(...r.values);
    const avg = r.values.reduce((a, b) => a + b, 0) / r.values.length;
    return {
      name: r.name,
      n: r.values.length,
      min,
      max,
      spread: max - min,
      avg,
      allZero: max === 0,
    };
  });

  rows.sort((a, b) => b.spread - a.spread || b.n - a.n);

  console.log(`\nUnique parameters scored: ${rows.length}`);
  const changed = rows.filter((r) => r.n <= 1 || r.spread > CHANGED_THRESHOLD).length;
  const flat = rows.length - changed;
  const allZero = rows.filter((r) => r.allZero).length;
  const singleCall = rows.filter((r) => r.n === 1).length;
  const multiCallFlat = rows.filter((r) => r.n > 1 && r.spread <= CHANGED_THRESHOLD).length;

  console.log(`Would show ("changed"):     ${changed}`);
  console.log(`Would hide ("flat"):         ${flat}`);
  console.log(`  ├─ single-score params:   ${singleCall}  (always considered changed → not in 'flat')`);
  console.log(`  └─ multi-score with spread ≤ ${CHANGED_THRESHOLD}: ${multiCallFlat}`);
  console.log(`Params where max == 0:       ${allZero}  (scored but no evidence found)`);

  console.log(`\nPer-parameter table (sorted by spread desc):`);
  console.log(
    "name".padEnd(40),
    "n".padStart(4),
    "min".padStart(7),
    "max".padStart(7),
    "spread".padStart(8),
    "avg".padStart(7),
  );
  for (const r of rows) {
    console.log(
      r.name.slice(0, 40).padEnd(40),
      String(r.n).padStart(4),
      r.min.toFixed(3).padStart(7),
      r.max.toFixed(3).padStart(7),
      r.spread.toFixed(3).padStart(8),
      r.avg.toFixed(3).padStart(7),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
