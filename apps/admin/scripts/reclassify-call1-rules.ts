/**
 * One-off: re-classify pre-existing ContentAssertion rows so course-ref
 * Call-1 rules become `category: session_override` with `section: "1"`.
 *
 * Background (2026-05-19 incident, course e5f379ed): the extractor prompt
 * didn't recognise `> **Session scope:** N` markers, so Call-1 rules
 * landed as `category: rule` with the section heading text stored in
 * `section`. Downstream `matchesSessionRange()` looks for `section === "1"`
 * (or `"2+"` etc.) and `category === "session_override"` — none matched
 * → tutor saw no Call-1-specific instructions → Call 1 jumped straight to
 * a Part-2 cue card instead of running a Part-1 warm-up.
 *
 * The forward fix is in extract-assertions.ts (prompt update). This script
 * fixes the existing rows in place so the IELTS course works for ongoing
 * tests without an expensive full re-extraction.
 *
 * Heuristic: assertion text starts with or contains "On Call 1" / "Call 1"
 * / "In Call 1" / "First Call" / "Call-1" near the start, AND is in a
 * COURSE_REFERENCE_CANONICAL source. Updates to category=session_override
 * and section="1".
 *
 * Run on hf-dev VM (script needs DB access):
 *   npx tsx scripts/reclassify-call1-rules.ts                          # dry-run, ALL sources
 *   npx tsx scripts/reclassify-call1-rules.ts --execute                # apply, ALL sources
 *   npx tsx scripts/reclassify-call1-rules.ts --source-id <id> --execute
 *
 * Idempotent: re-running on already-fixed rows is a no-op (skipped).
 */

import { prisma } from "@/lib/prisma";

const CALL1_PATTERN = /\b(On|In)\s+Call\s*1\b|^Call\s*1\b|\bFirst\s+Call\b|\bCall-1\b/i;

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const sourceIdIdx = args.indexOf("--source-id");
  const sourceId = sourceIdIdx >= 0 ? args[sourceIdIdx + 1] : null;
  const dryRun = !execute;

  console.log(
    `\n=== Re-classify Call-1 rules → session_override ===\n` +
      `  mode:   ${dryRun ? "DRY-RUN" : "EXECUTE"}\n` +
      `  scope:  ${sourceId ? `source ${sourceId}` : "all COURSE_REFERENCE_CANONICAL sources"}\n`,
  );

  const candidates = await prisma.contentAssertion.findMany({
    where: {
      category: { not: "session_override" },
      ...(sourceId
        ? { sourceId }
        : { source: { documentType: "COURSE_REFERENCE_CANONICAL" } }),
    },
    select: { id: true, assertion: true, category: true, section: true, sourceId: true },
  });

  const matches = candidates.filter((a) => CALL1_PATTERN.test(a.assertion));
  console.log(`Scanned ${candidates.length} non-session_override assertion(s); ${matches.length} match Call-1 pattern\n`);

  if (matches.length === 0) {
    console.log("Nothing to re-classify.\n");
    return;
  }

  for (const m of matches.slice(0, 20)) {
    console.log(`  - [${m.category}] ${m.assertion.slice(0, 90)}`);
  }
  if (matches.length > 20) console.log(`  ... +${matches.length - 20} more`);
  console.log("");

  if (dryRun) {
    console.log("Dry-run only. Re-run with --execute to apply.\n");
    return;
  }

  const result = await prisma.contentAssertion.updateMany({
    where: { id: { in: matches.map((m) => m.id) } },
    data: { category: "session_override", section: "1" },
  });
  console.log(`Updated ${result.count} row(s) → category=session_override, section="1"\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
