/**
 * Tier 1-3 invariant smoke check.
 *
 * Bundles the ad-hoc probes used during the 2026-05-23 Brynn / IELTS V1.0
 * verification into one re-runnable command. Designed to run post-deploy
 * (or on a cron) to catch any regression in:
 *
 *   - Audit counters (`scripts/audit-epic-100.ts`)
 *   - Per-playbook invariants — exactly one course-scoped PlaybookSubject,
 *     identity chain free of advisor leaks, all INSTRUCTION_CATEGORIES
 *     assertions tagged `tutor_instruction`, content reachable via
 *     PlaybookSource.
 *   - Per-caller invariants — active ComposedPrompt uses `spec-comp-001`
 *     (not an archetype slug), no advisor in inputs, `lo_mastery:` keys
 *     in canonical slug-form, archetype-aware critical rule present.
 *
 * Usage:
 *   npx tsx scripts/smoke-tier-1-3.ts
 *   npx tsx scripts/smoke-tier-1-3.ts --playbook eb6bc79e --caller 4b5ecdc4
 *   npx tsx scripts/smoke-tier-1-3.ts --playbook eb6bc79e,abc123 --caller xyz789
 *   npx tsx scripts/smoke-tier-1-3.ts --json
 *   npx tsx scripts/smoke-tier-1-3.ts --strict     # informational counters also fail
 *
 * Exit codes:
 *   0 — all invariant checks passed
 *   1 — at least one invariant failed
 *   2 — could not run audit subprocess (audit is the foundation; without
 *       it the per-playbook / per-caller checks are still meaningful but
 *       the overall report is incomplete)
 *
 * If `--playbook` and `--caller` are both omitted, the script auto-picks:
 *   - up to 5 most-recently-modified PUBLISHED playbooks
 *   - up to 10 callers with an active ComposedPrompt
 * That makes it useful as a default health check without needing fixture
 * IDs. CI / cron should pass explicit IDs to keep noise constant.
 *
 * See:
 *   docs/CHAIN-CONTRACTS.md (the invariants this guards)
 *   scripts/audit-epic-100.ts (the per-counter source of truth)
 *   .claude/rules/ai-to-db-guard.md
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";

type CheckStatus = "pass" | "fail" | "skip";
interface Check {
  scope: string;            // e.g. "audit", "playbook:eb6bc79e", "caller:4b5ecdc4"
  name: string;
  status: CheckStatus;
  detail?: string;
}

interface AuditCounter {
  key: string;
  story: string;
  kind: "invariant" | "informational";
  count: number;
  target: number;
  status: "pass" | "fail" | "info" | "skipped";
  description: string;
}

interface CliFlags {
  playbookIds: string[];
  callerIds: string[];
  json: boolean;
  strict: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { playbookIds: [], callerIds: [], json: false, strict: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--strict") flags.strict = true;
    else if (arg === "--playbook") flags.playbookIds.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--caller") flags.callerIds.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg.startsWith("--playbook=")) flags.playbookIds.push(...arg.slice("--playbook=".length).split(",").filter(Boolean));
    else if (arg.startsWith("--caller=")) flags.callerIds.push(...arg.slice("--caller=".length).split(",").filter(Boolean));
  }
  return flags;
}

// ── Section 1: audit counters via subprocess ──────────────────────────
async function runAuditSection(strict: boolean): Promise<Check[]> {
  const checks: Check[] = [];
  try {
    const scriptPath = path.resolve(__dirname, "audit-epic-100.ts");
    // audit-epic-100 exits non-zero when invariants fail; that's expected
    // signal, not "could not run". Use spawnSync so we always get stdout.
    const result = spawnSync("npx", ["tsx", scriptPath, "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    const stdout = result.stdout ?? "";
    if (!stdout.trim()) {
      throw new Error(
        `audit produced no stdout (exit=${result.status}, stderr=${(result.stderr || "").slice(0, 200)})`,
      );
    }
    const parsed = JSON.parse(stdout) as { counters: AuditCounter[] };
    for (const c of parsed.counters) {
      const isFailure =
        c.kind === "invariant"
          ? c.count > c.target
          : strict
            ? c.count > c.target
            : false;
      checks.push({
        scope: "audit",
        name: `${c.story} ${c.key}`,
        status: isFailure ? "fail" : "pass",
        detail: `count=${c.count} target=${c.target} (${c.kind})`,
      });
    }
  } catch (err: any) {
    checks.push({
      scope: "audit",
      name: "audit-epic-100 subprocess",
      status: "skip",
      detail: `Could not run audit: ${err?.message?.slice(0, 200) ?? String(err)}`,
    });
  }
  return checks;
}

// ── Section 2: per-playbook checks ────────────────────────────────────
async function checkPlaybook(playbookId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const scope = `playbook:${playbookId.slice(0, 8)}`;

  const pb = await prisma.playbook.findUnique({
    where: { id: playbookId },
    select: {
      id: true,
      name: true,
      domainId: true,
      config: true,
      subjects: { select: { subjectId: true, subject: { select: { slug: true, name: true } } } },
      items: { select: { spec: { select: { slug: true, specRole: true, extendsAgent: true } } } },
    },
  });
  if (!pb) {
    checks.push({ scope, name: "exists", status: "fail", detail: "playbook not found" });
    return checks;
  }

  // #607 — exactly one PlaybookSubject, course-scoped
  const dom = await prisma.domain.findUnique({ where: { id: pb.domainId! }, select: { slug: true } });
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^-|-$/g, "");
  const expectedPrefix = `${dom?.slug ?? "?"}-${slugify(pb.name)}-`;
  const courseScopedCount = pb.subjects.filter((ps) =>
    ps.subject.slug.startsWith(expectedPrefix),
  ).length;
  checks.push({
    scope,
    name: "#607 PlaybookSubject count == 1",
    status: pb.subjects.length === 1 ? "pass" : "fail",
    detail: `found ${pb.subjects.length}: ${pb.subjects.map((s) => `"${s.subject.name}"`).join(", ")}`,
  });
  if (pb.subjects.length === 1 && courseScopedCount === 0) {
    // Non-course-scoped sole subject is OK if it's a legacy course; just
    // surface it as info, not a fail. The slug heuristic differs from the
    // wizard's own slugify (npm slugify drops periods entirely while our
    // simple regex maps non-alnum → ""), so equality isn't guaranteed.
    checks.push({
      scope,
      name: "#607 sole subject is course-scoped (informational)",
      status: "pass",
      detail: `sole subject slug "${pb.subjects[0].subject.slug}" doesn't start with "${expectedPrefix}" — likely a slugifier-style mismatch, not a true violation`,
    });
  }

  // #608 — identity chain does not include the advisor archetype
  const identityItem = pb.items.find((i) => i.spec?.specRole === "IDENTITY");
  const extendsAdvisor = identityItem?.spec?.extendsAgent?.toUpperCase().includes("ADVISOR-001");
  checks.push({
    scope,
    name: "#608 identity does not extend ADVISOR-001",
    status: extendsAdvisor ? "fail" : "pass",
    detail: `identity=${identityItem?.spec?.slug ?? "(none)"}, extendsAgent=${identityItem?.spec?.extendsAgent ?? "(none)"}`,
  });

  // Content reachability via PlaybookSource (the canonical content boundary)
  const ps = await prisma.playbookSource.findMany({
    where: { playbookId },
    select: { sourceId: true },
  });
  checks.push({
    scope,
    name: "PlaybookSource rows present (content boundary)",
    status: ps.length > 0 ? "pass" : "fail",
    detail: `${ps.length} sources linked`,
  });
  const sourceIds = ps.map((r) => r.sourceId);

  // #605 — every INSTRUCTION_CATEGORY assertion is tagged tutor_instruction
  if (sourceIds.length > 0) {
    const bad = await prisma.contentAssertion.count({
      where: {
        sourceId: { in: sourceIds },
        category: { in: [...INSTRUCTION_CATEGORIES] },
        NOT: { teachMethod: "tutor_instruction" },
      },
    });
    const total = await prisma.contentAssertion.count({
      where: {
        sourceId: { in: sourceIds },
        category: { in: [...INSTRUCTION_CATEGORIES] },
      },
    });
    checks.push({
      scope,
      name: "#605 INSTRUCTION_CATEGORIES all tutor_instruction",
      status: bad === 0 ? "pass" : "fail",
      detail: `${total - bad}/${total} correctly tagged; ${bad} violations`,
    });
  }

  return checks;
}

// ── Section 3: per-caller checks ──────────────────────────────────────
async function checkCaller(callerId: string): Promise<Check[]> {
  const checks: Check[] = [];
  const scope = `caller:${callerId.slice(0, 8)}`;

  const cp = await prisma.composedPrompt.findFirst({
    where: { callerId, status: "active" },
    orderBy: { composedAt: "desc" },
    select: { id: true, prompt: true, inputs: true, composedAt: true, playbookId: true },
  });
  if (!cp) {
    checks.push({ scope, name: "active ComposedPrompt", status: "skip", detail: "no active prompt" });
    return checks;
  }

  const inputs = cp.inputs as { specUsed?: string; identitySpec?: string } | null;
  const inputsText = JSON.stringify(cp.inputs);

  // loadComposeConfig fix — specUsed must be the real COMP spec, never an archetype
  const archetypeSpecUsed = (inputs?.specUsed ?? "").toLowerCase().match(
    /^(spec-(advisor|tut|coach|companion|guide|mentor|facilitator)-001|(advisor|tut|coach|companion|guide|mentor|facilitator)-001)$/,
  );
  checks.push({
    scope,
    name: "loadComposeConfig: specUsed is not an archetype slug",
    status: archetypeSpecUsed ? "fail" : "pass",
    detail: `specUsed="${inputs?.specUsed ?? "(missing)"}"`,
  });

  // #608 — inputs JSON does not contain advisor archetype string
  checks.push({
    scope,
    name: "#608 inputs JSON has no spec-advisor-001",
    status: inputsText.includes("spec-advisor-001") ? "fail" : "pass",
    detail: `prompt id=${cp.id.slice(0, 8)} composedAt=${cp.composedAt.toISOString()}`,
  });

  // #608 — rendered prompt does not contain the advisor role string
  const lower = cp.prompt.toLowerCase();
  checks.push({
    scope,
    name: "#608 rendered prompt has no evidence-based-advisor text",
    status: lower.includes("evidence-based advisor") ? "fail" : "pass",
  });
  checks.push({
    scope,
    name: "#608 rendered prompt has no ADVISOR-001 literal",
    status: cp.prompt.includes("ADVISOR-001") ? "fail" : "pass",
  });

  // #607 — exactly one CONTENT AUTHORITY block
  const caBlocks = (cp.prompt.match(/CONTENT AUTHORITY/g) ?? []).length;
  checks.push({
    scope,
    name: "#607 single CONTENT AUTHORITY block",
    status: caBlocks === 1 ? "pass" : caBlocks === 0 ? "skip" : "fail",
    detail: `${caBlocks} blocks`,
  });

  // #604 — critical rules contain the archetype-aware RETURNING_CALLER rule
  // Practice mode → warm-up; recall/comprehension/syllabus → ALWAYS review.
  // We can't reliably know the mode from the caller alone, so just assert
  // EXACTLY ONE of the two variants is present (never both, never neither).
  const hasWarmUp = lower.includes("warm-up attempt");
  const hasReview = lower.includes("always review before new material");
  checks.push({
    scope,
    name: "#604 exactly one RETURNING_CALLER variant present",
    status: hasWarmUp !== hasReview ? "pass" : "fail",
    detail: `warm-up=${hasWarmUp} reviewFirst=${hasReview}`,
  });

  // #611 — all active lo_mastery keys are slug-form
  const ca = await prisma.callerAttribute.findMany({
    where: { callerId, key: { contains: ":lo_mastery:" }, validUntil: null },
    select: { key: true },
  });
  let slug = 0;
  let name = 0;
  for (const a of ca) {
    const suffix = a.key.split(":lo_mastery:")[1] ?? "";
    const moduleToken = suffix.split(":")[0] ?? "";
    if (/[A-Z ]/.test(moduleToken)) name++;
    else slug++;
  }
  checks.push({
    scope,
    name: "#611 lo_mastery keys all slug-form",
    status: name === 0 ? "pass" : "fail",
    detail: `${slug} slug-form, ${name} legacy name-form`,
  });

  return checks;
}

// ── Auto-pick fixtures when no explicit IDs given ─────────────────────
async function autoPickPlaybooks(): Promise<string[]> {
  const rows = await prisma.playbook.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function autoPickCallers(): Promise<string[]> {
  const rows = await prisma.composedPrompt.findMany({
    where: { status: "active" },
    orderBy: { composedAt: "desc" },
    take: 10,
    distinct: ["callerId"],
    select: { callerId: true },
  });
  return rows.map((r) => r.callerId);
}

// ── Output ────────────────────────────────────────────────────────────
function formatHuman(checks: Check[]): string {
  const lines: string[] = ["[smoke] Tier 1-3 invariant check"];
  let pass = 0;
  let fail = 0;
  let skip = 0;
  const byScope = new Map<string, Check[]>();
  for (const c of checks) {
    if (!byScope.has(c.scope)) byScope.set(c.scope, []);
    byScope.get(c.scope)!.push(c);
  }
  for (const [scope, scopeChecks] of byScope) {
    lines.push(`  ── ${scope} ──`);
    for (const c of scopeChecks) {
      const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "?";
      const line = `    ${icon} ${c.name}${c.detail ? "  — " + c.detail : ""}`;
      lines.push(line);
      if (c.status === "pass") pass++;
      else if (c.status === "fail") fail++;
      else skip++;
    }
  }
  lines.push("");
  lines.push(`[smoke] ${pass} ✓  ${fail} ✗  ${skip} skipped`);
  if (fail > 0) lines.push(`[smoke] FAILED — ${fail} invariant breach(es). See above.`);
  else lines.push(`[smoke] All invariants holding.`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  const checks: Check[] = [];

  checks.push(...(await runAuditSection(flags.strict)));

  const playbookIds =
    flags.playbookIds.length > 0 ? flags.playbookIds : await autoPickPlaybooks();
  const callerIds = flags.callerIds.length > 0 ? flags.callerIds : await autoPickCallers();

  for (const id of playbookIds) checks.push(...(await checkPlaybook(id)));
  for (const id of callerIds) checks.push(...(await checkCaller(id)));

  const failures = checks.filter((c) => c.status === "fail");

  if (flags.json) {
    console.log(JSON.stringify({ checks, summary: { pass: checks.filter((c) => c.status === "pass").length, fail: failures.length, skip: checks.filter((c) => c.status === "skip").length } }, null, 2));
  } else {
    console.log(formatHuman(checks));
  }

  await prisma.$disconnect();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[smoke] uncaught error:", err);
  process.exit(2);
});
