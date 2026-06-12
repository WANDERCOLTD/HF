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
 *   0  — no invariant exceeded its target AND none were skipped
 *        (or the DB was completely unreachable at startup — same as
 *        check-fk-consistency.ts so unrelated CI steps aren't blocked)
 *   1  — at least one invariant exceeded its target OR was skipped
 *        due to a per-counter query error (e.g. dead DB pointer where
 *        the schema is missing — silent skips were masking real drift)
 *
 * See: docs/epic-100-verification.md
 *      docs/epic-100-chain-walk.md
 *      gh issue view 631
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";

/**
 * A counter is either an **invariant** the adaptive loop must hold (above
 * target = exit non-zero, blocks CI), or **informational** — leak surface
 * or historical drift that won't drop until a separate migration runs.
 * Informational counters report their value but never fail the build.
 */
type CounterKind = "invariant" | "informational";

interface CounterDefinition {
  /** Stable identifier — referenced by baseline JSON + story ACs. */
  key: string;
  /** Story number this counter belongs to. */
  story: string;
  /** invariant = blocks CI when above target; informational = report-only. */
  kind: CounterKind;
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
  kind: CounterKind;
  count: number;
  target: number;
  description: string;
  status: "pass" | "fail" | "info" | "skipped";
  error?: string;
}

/* ---------------------------------------------------------------------- */
/* Counter definitions                                                    */
/* ---------------------------------------------------------------------- */

const counters: CounterDefinition[] = [
  /* #607 — duplicate PlaybookSubject from quick-launch/analyze + create_course
   *
   * Pre-#607 this counter measured (playbookId, subjectId) pair-duplicates,
   * which the DB schema's `@@unique([playbookId, subjectId])` already prevents
   * (so the counter could never be > 0 and never detected #607's actual shape:
   * two *different* subjects on the same playbook — a domain-level subject
   * left over from quick-launch/analyze + the course-scoped subject from
   * create_course). Now measures the real symptom: playbooks where a
   * course-scoped subject coexists with a non-course-scoped one. The
   * course-scoped pattern is `{domain.slug}-{slugified-playbook-name}-{...}`
   * — any PlaybookSubject whose subject.slug doesn't start with that prefix
   * but coexists with one that does is the #607 displacement target.
   */
  {
    key: "duplicatePlaybookSubjects",
    story: "#607",
    kind: "invariant",
    target: 0,
    description:
      "Playbooks where a course-scoped Subject AND a non-course-scoped Subject are both linked via PlaybookSubject — #607 displacement target. The wizard's unlinkNonPrimaryPlaybookSubjects guard drives this to 0 for every new course; pre-existing duplicates need a one-off cleanup.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM (
          WITH ps_classified AS (
            SELECT
              pb.id AS playbook_id,
              -- "Course-scoped" = subject slug starts with "{domain.slug}-{slug(playbook.name)}-"
              -- regexp_replace mirrors slugify() — lowercased, non-alnum → '-'.
              CASE
                WHEN s.slug LIKE d.slug || '-' || regexp_replace(lower(pb.name), '[^a-z0-9]+', '-', 'g') || '-%'
                  THEN 'course-scoped'
                ELSE 'other'
              END AS scope
            FROM "PlaybookSubject" ps
            JOIN "Playbook" pb ON pb.id = ps."playbookId"
            JOIN "Subject"  s  ON s.id  = ps."subjectId"
            JOIN "Domain"   d  ON d.id  = pb."domainId"
          )
          SELECT playbook_id
          FROM ps_classified
          GROUP BY playbook_id
          HAVING bool_or(scope = 'course-scoped') AND bool_or(scope = 'other')
        ) AS mixed_scope_playbooks
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #605 — any learner-facing teachMethod on tutor-instruction assertions */
  {
    key: "recallQuizOnInstructionCategories",
    story: "#605",
    kind: "invariant",
    target: 0,
    description:
      "ContentAssertion rows whose category is an INSTRUCTION_CATEGORY but whose teachMethod is NOT 'tutor_instruction' (includes null and any learner-facing method like 'recall_quiz' / 'guided_discussion' / etc.).",
    query: async () => {
      // Imported from lib/content-trust/resolve-config so this counter cannot
      // drift from the canonical INSTRUCTION_CATEGORIES list. Pre-#605 this
      // array was hand-maintained here with the wrong members
      // ("tutor_briefing", "tutor_instruction", "tutor_note") — values that
      // never appeared in any ContentAssertion.category, so the counter
      // silently read 0 even while real INSTRUCTION_CATEGORIES rows were
      // mis-tagged.
      //
      // #605 follow-on (2026-05-23): the original query only matched
      // `teachMethod = "recall_quiz"`. The IELTS V1.0 wizard run on
      // 2026-05-23 surfaced 53 INSTRUCTION_CATEGORIES rows tagged
      // `guided_discussion` from legacy QUESTION_BANK sources — same
      // problem class (learner-facing method on a tutor-instruction
      // category) but a different value. The narrow counter reported 0
      // while real violations sat there. Widened to "anything that isn't
      // tutor_instruction" — matches what the runtime guard
      // `assertNoLearnerMethodOnInstructionCategory()` catches at
      // extraction boundaries. NULL is treated as a violation too (it
      // means the row was never run through the guard, e.g. legacy
      // assertions extracted before #605 shipped) so the backfill script
      // (`scripts/backfill-teach-methods.ts` pass 2) drains it on the
      // next run.
      //
      // Counter key preserved (`recallQuizOnInstructionCategories`) for
      // back-compat with the baseline JSON fixture and prior digests;
      // the description above is the source of truth for what it
      // measures now.
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ContentAssertion"
        WHERE category = ANY(${[...INSTRUCTION_CATEGORIES]}::text[])
          AND ("teachMethod" IS NULL OR "teachMethod" != 'tutor_instruction')
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #606 — TUTOR_ONLY questions present in the DB (leak SURFACE, not behaviour) */
  {
    key: "tutorOnlyQuestionsLeakSurface",
    story: "#606",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL (leak surface). Count of ContentQuestion rows with assessmentUse='TUTOR_ONLY' present in the DB. #606's runtime fix filters these at the loader; rows are not deleted. Vitest in #648 proves the loader filter holds. This count reflects authored content surface area, not learner-prompt exposure.",
    query: async () => {
      return prisma.contentQuestion.count({
        where: { assessmentUse: "TUTOR_ONLY" },
      });
    },
  },

  /* #611 Fix A — dual lo_mastery keys (historical drift; new writes use canonical resolver) */
  {
    key: "dualLoMasteryKeysSameLO",
    story: "#611",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL (historical drift). CallerAttribute rows where two lo_mastery:* keys for the same caller resolve to the same LO under different module-token forms (name vs slug). #611 Fix A makes all NEW writes canonical (slug-only via resolveModuleByLogicalId); this count reflects pre-#611 historical state and only drains as #614's migration runs.",
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

  /* #611 Fix B — zero-storm calls (historical drift; new writes are evidence-gated) */
  {
    key: "callScoreZeroStorms",
    story: "#611",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL (historical drift). Calls with >40 CallScore rows all scored exactly 0 — symptom of the missing evidence-gate on AGGREGATE writes. #611 Fix B added the gate for all NEW writes; this count reflects pre-#611 historical state and only drains via a future CallScore cleanup migration.",
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
    kind: "invariant",
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
    kind: "invariant",
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
    kind: "invariant",
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
    kind: "invariant",
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
    kind: "invariant",
    target: 0,
    description:
      "Playbook rows with no teachingMode set — #604's archetype-aware criticalRules needs this populated to take effect.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "Playbook"
        WHERE (config->>'teachingMode') IS NULL
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #910 — authoring-side cascade-read bypass (epic #909)
   *
   * Components that fetch both /api/playbooks/[id]/targets AND
   * /api/callers/[id]/behavior-targets (or .../effective-behavior-targets)
   * and then merge the cascade layers in-component, without importing
   * the canonical resolver in lib/tolerance/resolve-tolerance.ts (or the
   * bulk wrapper getEffectiveBehaviorTargetsForCaller landing in #911).
   *
   * Static grep, not a DB query. Matches the chain-contracts Link 3a
   * invariant and arch-checker Check F.
   *
   * Expected today (post-#910): 1 (PromptTunerSidebar.tsx — fixed by
   * #911). Expected after #911 lands: 0.
   *
   * Soft contract: the symptom is "Tune sidebar shows stale course-level
   * value after a learner-scope save because the in-component merge
   * never re-ran". Caught empirically 2026-05-26.
   */
  {
    key: "authoringBehTargetBypassCount",
    story: "#910",
    kind: "invariant",
    target: 0,
    description:
      "Components under apps/admin/components/** that fetch both /api/playbooks/[id]/targets AND /api/callers/[id]/behavior-targets (or /effective-behavior-targets) WITHOUT importing from @/lib/tolerance/resolve-tolerance or @/lib/tolerance/getEffectiveBehaviorTargetsForCaller. Chain-contracts Link 3a — authoring-side cascade reads must go through the canonical resolver. Today: 1 (PromptTunerSidebar, fixed by #911). Target after #911: 0.",
    query: async () => {
      const componentsDir = path.resolve(__dirname, "..", "components");
      if (!fs.existsSync(componentsDir)) return 0;

      const PLAYBOOK_TARGETS_PATTERN = /\/api\/playbooks\/[^\s"'`]*\/targets/;
      const CALLER_BEH_TARGETS_PATTERN =
        /\/api\/callers\/[^\s"'`]*\/(behavior-targets|effective-behavior-targets)/;
      const RESOLVER_IMPORT_PATTERNS = [
        /from\s+["']@\/lib\/tolerance\/resolve-tolerance["']/,
        /from\s+["']@\/lib\/tolerance\/getEffectiveBehaviorTargetsForCaller["']/,
      ];

      const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            out.push(...walk(full));
          } else if (
            entry.isFile() &&
            (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
          ) {
            out.push(full);
          }
        }
        return out;
      };

      let count = 0;
      for (const file of walk(componentsDir)) {
        const contents = fs.readFileSync(file, "utf8");
        const hasPlaybookTargets = PLAYBOOK_TARGETS_PATTERN.test(contents);
        const hasCallerBehTargets = CALLER_BEH_TARGETS_PATTERN.test(contents);
        if (!hasPlaybookTargets || !hasCallerBehTargets) continue;
        const importsResolver = RESOLVER_IMPORT_PATTERNS.some((p) => p.test(contents));
        if (importsResolver) continue;
        count++;
      }
      return count;
    },
  },

  /* #610 — hardcoded behavioural strings remaining in composition transforms */
  {
    key: "hardcodedRulesRemainingInTransforms",
    story: "#610",
    kind: "invariant",
    target: 0,
    description:
      "Count of files under lib/prompt/composition/transforms/ that still contain hardcoded behavioural strings (e.g. 'ALWAYS review', 'If RETURNING_CALLER'). Static grep, not a DB query. #610 separated code-side defaults into lib/prompt/composition/defaults/ — that sibling directory is intentionally NOT scanned, so a transform that imports a default constant is not counted. The scan still flags any transform that embeds a behavioural phrase inline.",
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
      // Hardcoded behavioural phrases we want to lift out of transforms.
      // Sourced from #604 and the broader #610 audit. Extend as new
      // patterns are identified.
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

  /* #1006 / #1008 — generic-noun fallbacks reaching the ComposedPrompt body */
  {
    key: "composeGenericNounFallbackCount",
    story: "#1008",
    kind: "invariant",
    target: 0,
    description:
      "Count of ACTIVE ComposedPrompt rows whose `prompt` markdown contains a generic-noun fallback phrase ('previous concept' / 'next concept' / 'first concept'). Catches the I-C4 anti-pattern (chain-contracts.md Link 3 → COMPOSE→LLM). The build-time ESLint rule hf-compose/no-orphan-instruction-fallback prevents new sites; this counter measures how many already-composed prompts in the DB still carry the pattern. When this reads 0 for ≥7 days, the ESLint rule severity escalates from `warn` to `error`.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ComposedPrompt"
        WHERE status = 'active'
          AND (
            prompt ILIKE '%previous concept%'
            OR prompt ILIKE '%next concept%'
            OR prompt ILIKE '%first concept%'
          )
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #1006 / #1008 — memory-less reminisce reaching the ComposedPrompt body */
  {
    key: "composeMemorylessReminisceCount",
    story: "#1008",
    kind: "invariant",
    target: 0,
    description:
      "Count of ACTIVE ComposedPrompt rows where the prompt markdown contains a reminisce-class imperative ('reference last session', 'as we covered', 'pick up where we left off', 'remember from before', 'reference the learning journey so far') AND the caller has zero CallerMemory rows in the playbook's domain. Catches the I-C3 anti-pattern (#1006 Maya): the AI is told to reference history that doesn't exist, so it fabricates. When this reads 0 for ≥7 days, the runtime invariant runner's I-C3 severity escalates from `warn` to `error`.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "ComposedPrompt" cp
        WHERE cp.status = 'active'
          AND (
            cp.prompt ILIKE '%reference last session%'
            OR cp.prompt ILIKE '%as we covered%'
            OR cp.prompt ILIKE '%pick up where we left off%'
            OR cp.prompt ILIKE '%remember from before%'
            OR cp.prompt ILIKE '%reference the learning journey so far%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM "CallerMemory" cm WHERE cm."callerId" = cp."callerId"
          )
      `;
      return Number(rows[0]?.count ?? 0);
    },
  },

  /* #1006 / #1008 — call-counter incoherence within a single prompt */
  {
    key: "composeCallCounterIncoherent",
    story: "#1008",
    kind: "invariant",
    target: 0,
    description:
      "Count of ACTIVE ComposedPrompt rows whose `prompt` body contains two or more DIFFERENT `(call #N)` references. Catches the I-C2 anti-pattern: quickstart.this_caller and offboarding/session_pedagogy disagree about which call this is (Maya #1006: prompt labelled itself '(call #2)' while being used inside call 3). Implemented via a regex scan in Node rather than SQL because Postgres regex extraction is verbose; this counter therefore loads the prompt column. Safe at the current scale (low thousands of active prompts); revisit if total grows past ~50k.",
    query: async () => {
      const rows = await prisma.$queryRaw<Array<{ prompt: string }>>`
        SELECT prompt FROM "ComposedPrompt" WHERE status = 'active' AND prompt IS NOT NULL
      `;
      const callRefRegex = /\bcall\s*#\s*(\d+)\b/gi;
      let count = 0;
      for (const row of rows) {
        if (!row.prompt) continue;
        const distinct = new Set<number>();
        let m: RegExpExecArray | null;
        while ((m = callRefRegex.exec(row.prompt))) {
          const n = Number(m[1]);
          if (Number.isFinite(n)) distinct.add(n);
        }
        if (distinct.size > 1) count++;
      }
      return count;
    },
  },

  /* #1016 — AnyVoice transport-adapter contract (chain-contracts Link 3 sub)
   *
   * Static counters. Both at target 0 post-epic completion:
   *   - vapiNamedColumnsOnCallModel  → 0 (#1020 renamed vapi* → voice*).
   *   - vapiToolDefinitionsConstantPresent → 0 (#1019 migrated to TOOLS-001).
   *
   * Both also enforced at BUILD TIME by ESLint rules from #1024:
   *   - hf-voice/no-vapi-column-ref     blocks reintroduction of any of
   *     the 6 forbidden Call.vapi* column names in app code
   *   - hf-voice/no-vapi-tool-definitions-const  blocks reintroduction of
   *     the VAPI_TOOL_DEFINITIONS TS constant
   *
   * The audit counters here remain as a runtime sanity check on the
   * schema/source tree itself; the ESLint rules block identifier-level
   * regressions in PRs before they hit main.
   *
   * Read the source tree, not the database — they verify the code shape
   * promised by the I-VP2 / I-VP3 invariants in docs/CHAIN-CONTRACTS.md
   * "Link 3 sub-contract — COMPOSE → VOICE PROVIDER (transport adapter)".
   * Filesystem-only so they work on CI without DB.
   */
  {
    key: "vapiNamedColumnsOnCallModel",
    story: "#1016",
    kind: "invariant",
    target: 0,
    description:
      "Count of vapi-prefixed columns on the Call model in prisma/schema.prisma. Catches the I-VP3 anti-pattern (provider-specific column names leaking into the canonical Call schema). #1020 renames vapi* → voice* + voiceProviderRaw Json; this counter drives that work. Static grep over the Call model block.",
    query: async () => {
      const schemaPath = path.resolve(__dirname, "..", "prisma", "schema.prisma");
      if (!fs.existsSync(schemaPath)) return 0;
      const src = fs.readFileSync(schemaPath, "utf8");
      // Isolate the Call model body so vapi-named fields on other models
      // (none today, but defensive) don't get counted here.
      const start = src.indexOf("model Call {");
      if (start === -1) return 0;
      const end = src.indexOf("\n}", start);
      if (end === -1) return 0;
      const body = src.slice(start, end);
      // Field declarations start at column 0 of a line after indentation,
      // shape: `  vapiSomething   Type ...`. Match identifiers starting
      // with lowercase `vapi` to avoid false-positives in comments.
      const matches = body.match(/^\s+vapi[A-Z]\w*\s+/gm);
      return matches ? matches.length : 0;
    },
  },
  {
    key: "vapiToolDefinitionsConstantPresent",
    story: "#1016",
    kind: "invariant",
    target: 0,
    description:
      "Presence (0 or 1) of the VAPI_TOOL_DEFINITIONS TypeScript constant outside _archived/. Catches the I-VP2 anti-pattern (tool list lives as code, not as a spec). #1019 migrates the array into the TOOLS-001 spec and removes the constant; this counter drives that work. Static grep over the source tree.",
    query: async () => {
      // The constant lives in app/api/vapi/tools/route.ts today; the
      // generator script at scripts/generate-ai-capabilities.ts imports
      // it. Either presence trips this counter. Counting presence (0/1)
      // rather than occurrences so a future #1019-stub that re-imports
      // briefly during migration doesn't double-count.
      const roots = [
        path.resolve(__dirname, "..", "app"),
        path.resolve(__dirname, "..", "lib"),
        path.resolve(__dirname, "..", "scripts"),
      ];
      const skipDirs = new Set(["node_modules", "_archived", ".next"]);
      const walk = (dir: string): string[] => {
        if (!fs.existsSync(dir)) return [];
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (skipDirs.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) out.push(...walk(full));
          else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
        }
        return out;
      };
      for (const root of roots) {
        for (const file of walk(root)) {
          const src = fs.readFileSync(file, "utf8");
          // The DECLARATION shape, not the import — `export const
          // VAPI_TOOL_DEFINITIONS` is the SoT we want to drive to 0.
          if (/\bexport\s+const\s+VAPI_TOOL_DEFINITIONS\b/.test(src)) {
            return 1;
          }
        }
      }
      return 0;
    },
  },
  /* #1511 — Adaptive Loop observability invariants (epic #1510 Slice 1).
   *
   * All five counters are INFORMATIONAL — they count last-24h AppLog rows the
   * runtime invariant runner wrote, not contract violations in the DB. The
   * structural fixes that drive them to zero live in sibling slices
   * (#1512 PROSODY, #1513 SCORE_AGENT defaults). When those slices ship +
   * deploy, re-snap the baseline via:
   *   npx tsx scripts/audit-epic-100.ts --json > tests/fixtures/epic-100-audit-baseline.json
   *
   * See docs/CHAIN-CONTRACTS.md §6 for per-invariant contracts.
   */
  {
    key: "iAL1MemoryAbsentRealEngine",
    story: "#1511",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL. Last-24h AppLog rows with stage='pipeline.invariant.i-al1' — real-engine EXTRACT with transcript >= 200 chars produced zero CallerMemory rows. Mock engine excluded by design (route.ts:1029-1031 / G9 #1158 audit). Structural fix: epic #1510 Slice 5 (#1515 CONDITIONAL).",
    query: async () => countInvariantLogs("pipeline.invariant.i-al1"),
  },
  {
    key: "iAL2SkillTargetUnscored",
    story: "#1511",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL. Last-24h AppLog rows with stage='pipeline.invariant.i-al2' — skill_* CallScore rows exist for the caller in the 6h fresh window but CallerTarget.currentScore is null. Indicates aggregate-runner EMA cascade silently no-op'd. Structural fix: epic #1510 Slice 6 (#1516 CONDITIONAL).",
    query: async () => countInvariantLogs("pipeline.invariant.i-al2"),
  },
  {
    key: "iAL3DefaultFallbackInfo",
    story: "#1511",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL (signal, not violation). Last-24h AppLog rows with stage='pipeline.invariant.i-al3' — AGGREGATE-stage runner fell through to SKILL_DEFAULTS constants instead of reading from rule/playbook/contract config. Production should show some non-zero count (variance is healthy). A sudden drop OR spike is the signal to investigate — silent override loss vs override storm.",
    query: async () => countInvariantLogs("pipeline.invariant.i-al3"),
  },
  {
    key: "iAL4ProsodySkipWarn",
    story: "#1511",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL. Last-24h AppLog rows with stage='pipeline.invariant.i-al4' AND level='warn' — PROSODY skipped for an actionable reason (no-stereoUrl / no-tierPreset / no-provider). 'existing-envelope' cache hits emit level='info' and are excluded from this counter. Structural fix: epic #1510 Slice 2 (#1512 PROSODY loud-WARN + IELTS data seed) wires the missing emits.",
    query: async () =>
      countInvariantLogs("pipeline.invariant.i-al4", { onlyLevel: "warn" }),
  },
  {
    key: "iAL5ZeroTargetsWarn",
    story: "#1511",
    kind: "informational",
    target: 0,
    description:
      "INFORMATIONAL. Last-24h AppLog rows with stage='pipeline.invariant.i-al5' AND level IN ('warn','error') — SCORE_AGENT loaded zero BehaviorTarget(scope=PLAYBOOK) for a call. ERROR severity indicates the SYSTEM defaults are ALSO empty (cascade has no root). Structural fix: epic #1510 Slice 3 (#1513 BehaviorTarget system-defaults seed + SCORE_AGENT cascade fallback).",
    query: async () =>
      countInvariantLogs("pipeline.invariant.i-al5", {
        levels: ["warn", "error"],
      }),
  },
];

/**
 * Last-24h count helper for the Adaptive Loop AppLog counters. Wrapped so each
 * counter row stays readable. Returns 0 on schema mismatch (e.g. AppLog table
 * absent on a freshly-init'd DB) rather than skipping — these counters are
 * informational so the audit script can keep reporting even when the
 * observability surface hasn't shipped yet.
 */
async function countInvariantLogs(
  stage: string,
  options?: { onlyLevel?: string; levels?: string[] },
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    if (options?.onlyLevel) {
      const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "AppLog"
        WHERE stage = ${stage}
          AND level = ${options.onlyLevel}
          AND "createdAt" >= ${since}
      `;
      return Number(result[0]?.count ?? 0);
    }
    if (options?.levels && options.levels.length > 0) {
      const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "AppLog"
        WHERE stage = ${stage}
          AND level = ANY(${options.levels})
          AND "createdAt" >= ${since}
      `;
      return Number(result[0]?.count ?? 0);
    }
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "AppLog"
      WHERE stage = ${stage}
        AND "createdAt" >= ${since}
    `;
    return Number(result[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

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
      // Invariants fail when above target; informational counters report only.
      const status: CounterResult["status"] =
        count <= c.target ? "pass" : c.kind === "invariant" ? "fail" : "info";
      results.push({
        key: c.key,
        story: c.story,
        kind: c.kind,
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
        kind: c.kind,
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
  console.log("\n=== Epic 100 audit — adaptive-loop contract hygiene ===");
  console.log("    ✓ invariant met   ✗ invariant breached   ℹ informational   ? skipped\n");
  const invariants = results.filter((r) => r.kind === "invariant");
  const informational = results.filter((r) => r.kind === "informational");

  const renderRow = (r: CounterResult): void => {
    const symbol =
      r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : r.status === "info" ? "ℹ" : "?";
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
  };

  console.log("  Invariants (block CI when above target):");
  for (const r of invariants) renderRow(r);
  if (informational.length > 0) {
    console.log("\n  Informational (report-only — leak surface / historical drift):");
    for (const r of informational) renderRow(r);
  }
  console.log("");
  const fails = invariants.filter((r) => r.status === "fail");
  if (fails.length > 0) {
    console.log(`[audit-epic-100] FAILED — ${fails.length} invariant(s) above target.`);
    console.log("    See: docs/epic-100-verification.md");
    console.log("    See: docs/epic-100-chain-walk.md");
  } else {
    console.log("[audit-epic-100] All invariants at or below target.");
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
        kind: r.kind,
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

  // Only invariants block CI. Informational counters (leak surface / historical
  // drift) report their value but never fail the build.
  const anyInvariantFail = results.some(
    (r) => r.kind === "invariant" && r.status === "fail",
  );

  // Skipped invariants ALSO block CI — a counter that couldn't run is not a
  // counter that proved zero. Silent skips were masking dead DB pointers:
  // when #726 Phase 3 dropped `hf_dev` (2026-05-25), every per-counter query
  // returned `relation "X" does not exist`, the script exited 0, and the
  // build looked green with no real audit. Fail loud instead.
  //
  // Note: this is the *per-counter* skip path (one query threw mid-run).
  // A completely unreachable DB still exits 0 via the catch block above,
  // matching `check-fk-consistency.ts` so unrelated CI steps aren't blocked.
  const skippedInvariants = results.filter(
    (r) => r.kind === "invariant" && r.status === "skipped",
  );
  if (skippedInvariants.length > 0) {
    console.error(
      `[audit-epic-100] FAIL: ${skippedInvariants.length} invariant counter(s) skipped — DB schema mismatch or query error. Affected:`,
    );
    for (const c of skippedInvariants) {
      console.error(`  - ${c.key} (${c.story}): ${c.error}`);
    }
  }

  process.exit(anyInvariantFail || skippedInvariants.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("[audit-epic-100] uncaught error:", err);
  process.exit(1);
});
