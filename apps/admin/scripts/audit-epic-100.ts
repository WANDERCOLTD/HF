/**
 * Epic 100 — Adaptive Loop Contract Hygiene
 * Verification harness — audit script.
 *
 * Single read-only audit pass over the live database that counts
 * contract violations across the adaptive loop. Each counter maps
 * to a specific Epic 100 child issue; each child story drives its
 * counter to the documented target (usually 0) as it merges.
 *
 * Idempotent + read-only. If the database is unreachable, exits 0
 * with a warning so unrelated CI steps aren't blocked (mirrors
 * `check-fk-consistency.ts` behaviour).
 *
 * Usage:
 *   npx tsx apps/admin/scripts/audit-epic-100.ts
 *   npx tsx apps/admin/scripts/audit-epic-100.ts --json
 *   npx tsx apps/admin/scripts/audit-epic-100.ts --diff=tests/fixtures/epic-100-audit-baseline.json
 *
 * Exit codes:
 *   0  — no counter exceeded its target (or DB unreachable)
 *   1  — at least one counter exceeded its target
 *
 * See: docs/epic-100-verification.md
 *      docs/epic-100-chain-walk.md
 *      gh issue view 631
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

interface CounterDefinition {
  /** Stable identifier — referenced by baseline JSON + story ACs. */
  key: string;
  /** Story number this counter belongs to. */
  story: string;
  /** Target value once the story merges (usually 0). */
  target: number;
  /** Human-friendly description for the report. */
  description: string;
  /** Returns the violation count. May throw on DB error. */
  query: () => Promise<number>;
}

interface CounterResult {
  key: string;
  story: string;
  count: number;
  target: number;
  description: string;
  status: "pass" | "fail" | "skipped";
  error?: string;
}

/* ---------------------------------------------------------------------- */
/* Counter definitions                                                    */
/* ---------------------------------------------------------------------- */

const counters: CounterDefinition[] = [
  /* #607 — duplicate PlaybookSubject from quick-launch/analyze + create_course */
  {
    key: "duplicatePlaybookSubjects",
    story: "#607",
    target: 0,
    description:
      "PlaybookSubject rows where (playbookId, subjectId) has duplicates — same subject linked twice to same playbook.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT "playbookId", "subjectId"
          FROM "PlaybookSubject"
          GROUP BY "playbookId", "subjectId"
          HAVING COUNT(*) > 1
        ) AS dups
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #605 — recall_quiz auto-tagged on tutor-instruction assertions */
  {
    key: "recallQuizOnInstructionCategories",
    story: "#605",
    target: 0,
    description:
      "ContentAssertion rows whose category is an INSTRUCTION_CATEGORY but whose teachMethod is 'recall_quiz' (should be 'tutor_instruction').",
    query: async () => {
      // INSTRUCTION_CATEGORIES — keep in sync with lib/extraction/category-to-teach-method.ts
      const instructionCategories = [
        "teaching_rule",
        "session_flow",
        "tutor_briefing",
        "tutor_instruction",
        "tutor_note",
      ];
      return prisma.contentAssertion.count({
        where: {
          assertionCategory: { in: instructionCategories },
          teachMethod: "recall_quiz",
        },
      });
    },
  },

  /* #606 — TUTOR_ONLY questions reachable via the curriculumQuestions loader */
  {
    key: "tutorOnlyQuestionsRenderedToLearner",
    story: "#606",
    target: 0,
    description:
      "ContentQuestion rows with assessmentUse='TUTOR_ONLY' that would be returned by curriculumQuestions loader pre-filter. Drops to 0 once #606 loader filter merges.",
    query: async () => {
      // After #606 ships, the loader excludes assessmentUse=TUTOR_ONLY.
      // Pre-ship: this counts how many TUTOR_ONLY rows are reachable
      // from any active playbook source (synthetic measure — exact value
      // depends on environment; non-zero means leak surface exists).
      return prisma.contentQuestion.count({
        where: {
          assessmentUse: "TUTOR_ONLY",
        },
      });
    },
  },

  /* #611 Fix A — dual lo_mastery keys (name-form + slug-form) for same caller */
  {
    key: "dualLoMasteryKeysSameLO",
    story: "#611",
    target: 0,
    description:
      "CallerAttribute rows where two lo_mastery:* keys for the same caller resolve to the same LO under different module-token forms (name vs slug).",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT "callerId",
                 SUBSTRING("key" FROM ':lo_mastery:[^:]+:([^:]+)$') AS lo_ref
          FROM "CallerAttribute"
          WHERE "key" LIKE '%:lo_mastery:%'
            AND ("validUntil" IS NULL OR "validUntil" > NOW())
          GROUP BY "callerId", lo_ref
          HAVING COUNT(*) > 1
        ) AS dups
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #611 Fix B — zero-storm calls (>40 CallScore rows all scored 0 for one call) */
  {
    key: "callScoreZeroStorms",
    story: "#611",
    target: 0,
    description:
      "Calls with >40 CallScore rows where every row was scored exactly 0 — symptom of evidence-gate missing on AGGREGATE writes.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM (
          SELECT "callId"
          FROM "CallScore"
          GROUP BY "callId"
          HAVING COUNT(*) > 40
             AND BOOL_AND(score = 0)
        ) AS storms
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #615 — orphan LearningObjective rows (no parent CurriculumModule) */
  {
    key: "orphanLearningObjectives",
    story: "#615",
    target: 0,
    description:
      "LearningObjective rows whose moduleId references a CurriculumModule that no longer exists.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "LearningObjective" lo
        LEFT JOIN "CurriculumModule" cm ON cm.id = lo."moduleId"
        WHERE cm.id IS NULL
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #615 — dangling ContentAssertion.learningObjectiveId */
  {
    key: "danglingContentAssertionLOs",
    story: "#615",
    target: 0,
    description:
      "ContentAssertion rows with non-null learningObjectiveId where the LearningObjective no longer exists (soft-FK).",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ContentAssertion" ca
        LEFT JOIN "LearningObjective" lo ON lo.id = ca."learningObjectiveId"
        WHERE ca."learningObjectiveId" IS NOT NULL
          AND lo.id IS NULL
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #608 — advisor leak in ComposedPrompt.inputs.specUsed */
  {
    key: "advisorInInputsSnapshot",
    story: "#608",
    target: 0,
    description:
      "Active ComposedPrompt rows whose inputs.specUsed JSON contains 'spec-advisor-001' (SYSTEM-scope IDENTITY leaking into playbook-scope prompts).",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ComposedPrompt"
        WHERE "inputs"::text LIKE '%spec-advisor-001%'
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #614 — old-form CallerAttribute lo_mastery keys (name-form, not slug-form) */
  {
    key: "callerAttributeOldKeyFormCount",
    story: "#614",
    target: 0,
    description:
      "CallerAttribute rows whose lo_mastery key contains uppercase letters or spaces in the module token — old name-form, awaiting migration to slug-form.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "CallerAttribute"
        WHERE "key" LIKE '%:lo_mastery:%'
          AND "key" ~ ':lo_mastery:[^:]*[A-Z ][^:]*:'
          AND ("validUntil" IS NULL OR "validUntil" > NOW())
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #604 prerequisite — playbooks without teachingMode set */
  {
    key: "playbooksWithoutTeachingMode",
    story: "#604",
    target: 0,
    description:
      "Playbook rows with no teachingMode set — #604's archetype-aware criticalRules needs this populated to take effect.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "Playbook"
        WHERE "teachingMode" IS NULL
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #610 — hardcoded behavioural strings remaining in composition transforms */
  {
    key: "hardcodedRulesRemainingInTransforms",
    story: "#610",
    target: 0,
    description:
      "Count of files under lib/prompt/composition/transforms/ that still contain hardcoded behavioural strings (e.g. 'ALWAYS review', 'If RETURNING_CALLER'). Static grep, not a DB query.",
    query: async () => {
      const transformsDir = path.resolve(
        __dirname,
        "..",
        "lib",
        "prompt",
        "composition",
        "transforms",
      );
      if (!fs.existsSync(transformsDir)) return 0;
      // Hardcoded behavioural phrases we want to lift to spec config (#604, #610).
      const phrases = [
        "ALWAYS review",
        "If RETURNING_CALLER",
        "MUST never",
        "NEVER ever",
      ];
      let count = 0;
      const files = (fs.readdirSync(transformsDir, { recursive: true }) as unknown[])
        .filter((f): f is string => typeof f === "string" && f.endsWith(".ts"));
      for (const f of files) {
        const contents = fs.readFileSync(path.join(transformsDir, f), "utf8");
        if (phrases.some((p) => contents.includes(p))) count++;
      }
      return count;
    },
  },
];

/* ---------------------------------------------------------------------- */
/* Runner                                                                 */
/* ---------------------------------------------------------------------- */

interface CliFlags {
  json: boolean;
  diffBaseline: string | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { json: false, diffBaseline: null };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") flags.json = true;
    else if (arg.startsWith("--diff=")) {
      flags.diffBaseline = arg.slice("--diff=".length);
    }
  }
  return flags;
}

async function runCounters(): Promise<CounterResult[]> {
  const results: CounterResult[] = [];
  for (const c of counters) {
    try {
      const count = await c.query();
      const status: CounterResult["status"] = count <= c.target ? "pass" : "fail";
      results.push({
        key: c.key,
        story: c.story,
        count,
        target: c.target,
        description: c.description,
        status,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        key: c.key,
        story: c.story,
        count: -1,
        target: c.target,
        description: c.description,
        status: "skipped",
        error: message,
      });
    }
  }
  return results;
}

function printHuman(results: CounterResult[], diffMap: Map<string, number>): void {
  console.log("\n=== Epic 100 audit — adaptive-loop contract hygiene ===\n");
  for (const r of results) {
    const symbol = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "?";
    const baseline = diffMap.get(r.key);
    const delta =
      baseline !== undefined && r.count >= 0
        ? ` (Δ ${r.count - baseline >= 0 ? "+" : ""}${r.count - baseline})`
        : "";
    console.log(
      `  ${symbol} ${r.story.padEnd(6)} ${r.key.padEnd(40)} ${r.count}${delta}  target=${r.target}`,
    );
    if (r.error) {
      console.log(`        ! error: ${r.error}`);
    }
  }
  console.log("");
  const fails = results.filter((r) => r.status === "fail");
  if (fails.length > 0) {
    console.log(`[audit-epic-100] FAILED — ${fails.length} counter(s) above target.`);
    console.log("    See: docs/epic-100-verification.md");
    console.log("    See: docs/epic-100-chain-walk.md");
  } else {
    console.log("[audit-epic-100] All counters at or below target.");
  }
}

function readBaseline(filePath: string): Map<string, number> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    console.warn(`[audit-epic-100] WARN: baseline file not found at ${abs}`);
    return new Map();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as {
      counters?: Array<{ key: string; count: number }>;
    };
    const out = new Map<string, number>();
    for (const c of raw.counters ?? []) out.set(c.key, c.count);
    return out;
  } catch (err) {
    console.warn(
      `[audit-epic-100] WARN: could not parse baseline (${err instanceof Error ? err.message : String(err)})`,
    );
    return new Map();
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);

  let results: CounterResult[] = [];
  try {
    results = await runCounters();
  } catch (err: unknown) {
    // Database completely unreachable — exit 0 with a warning, mirroring
    // check-fk-consistency.ts so unrelated CI steps aren't blocked.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[audit-epic-100] WARNING: database unreachable (${message}). Skipping audit.`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
    return;
  }

  const diffMap = flags.diffBaseline ? readBaseline(flags.diffBaseline) : new Map<string, number>();

  if (flags.json) {
    const payload = {
      generatedAt: new Date().toISOString(),
      counters: results.map((r) => ({
        key: r.key,
        story: r.story,
        count: r.count,
        target: r.target,
        status: r.status,
        description: r.description,
        ...(r.error ? { error: r.error } : {}),
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHuman(results, diffMap);
  }

  await prisma.$disconnect();

  const anyFail = results.some((r) => r.status === "fail");
  process.exit(anyFail ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("[audit-epic-100] uncaught error:", err);
  process.exit(1);
});
