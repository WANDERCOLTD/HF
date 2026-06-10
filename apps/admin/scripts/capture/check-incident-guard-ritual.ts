/**
 * check-incident-guard-ritual.ts — enforce the incident → invariant → guard ritual.
 *
 * Triggers ONLY on PRs that close an issue labelled `incident` (no-op for
 * normal feature/chore PRs). For those PRs, require the changeset to touch at
 * least one of the four "lesson-locking" paths:
 *
 *     - docs/kb/invariants.md
 *     - docs/kb/guard-registry.md
 *     - apps/admin/eslint-rules/
 *     - apps/admin/scripts/check-*
 *
 * False-positive mitigation: an issue manually labelled `incident` without a
 * post-mortem comment (no `## KB additions (draft` marker) does NOT trip the
 * gate — surfaces the ritual only when the post-mortem agent has actually
 * surfaced KB drafts.
 *
 * Explicit bypass: if the incident issue ALSO carries the `ritual-exception`
 * label, skip. Audit trail lives on the issue.
 *
 * Run locally:
 *   PR_NUMBER=1234 npx tsx scripts/capture/check-incident-guard-ritual.ts
 *
 * CI: invoked from .github/workflows/test.yml Lint & Type Check job. Reads
 *     the PR number from $GITHUB_REF_NAME or $PR_NUMBER. On a non-PR push
 *     (eg. main), exits 0 immediately.
 */
import { execSync } from "node:child_process";

const PATHS_THAT_SATISFY = [
  "docs/kb/invariants.md",
  "docs/kb/guard-registry.md",
  "apps/admin/eslint-rules/",
  "apps/admin/scripts/check-",
];

const KB_DRAFT_MARKER = "## KB additions (draft";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function getPrNumber(): number | null {
  const fromEnv = process.env.PR_NUMBER || "";
  if (/^\d+$/.test(fromEnv)) return Number(fromEnv);
  // GH Actions PR ref: refs/pull/<num>/merge
  const ref = process.env.GITHUB_REF || "";
  const m = ref.match(/^refs\/pull\/(\d+)\//);
  if (m) return Number(m[1]);
  // Local: try to derive from the current branch
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  if (branch && branch !== "main" && branch !== "master") {
    const j = sh(`gh pr list --head ${branch} --limit 1 --json number --jq '.[0].number'`);
    if (/^\d+$/.test(j)) return Number(j);
  }
  return null;
}

function getClosedIssueNumbers(prNumber: number): number[] {
  // Two sources: commit messages on the PR, and the PR body. The PR body's
  // "Closes #N" / "Fixes #N" / "Resolves #N" is canonical; commits are extra.
  const body = sh(`gh pr view ${prNumber} --json body --jq .body`);
  const commits = sh(`gh pr view ${prNumber} --json commits --jq '[.commits[].messageHeadline,.commits[].messageBody] | flatten | join("\\n")'`);
  const text = `${body}\n${commits}`;
  const re = /\b(?:closes|fixes|resolves)\s+#(\d+)/gi;
  const out = new Set<number>();
  for (const m of text.matchAll(re)) out.add(Number(m[1]));
  return [...out];
}

function getIssueLabels(issue: number): string[] {
  const j = sh(`gh issue view ${issue} --json labels --jq '[.labels[].name]'`);
  try { return JSON.parse(j); } catch { return []; }
}

function issueHasKbDraftComment(issue: number): boolean {
  const j = sh(`gh issue view ${issue} --json comments --jq '[.comments[].body] | join("\\n")'`);
  return j.includes(KB_DRAFT_MARKER);
}

function getChangedFiles(prNumber: number): string[] {
  const raw = sh(`gh pr view ${prNumber} --json files --jq '[.files[].path] | join("\\n")'`);
  return raw ? raw.split("\n").filter(Boolean) : [];
}

function changedFilesSatisfyRitual(files: string[]): boolean {
  return files.some((f) => PATHS_THAT_SATISFY.some((p) => f.startsWith(p) || f.includes(p)));
}

function main() {
  const pr = getPrNumber();
  if (!pr) {
    console.log("[ritual] No PR context (likely a push to main); skipping.");
    process.exit(0);
  }
  console.log(`[ritual] checking PR #${pr}`);

  const closed = getClosedIssueNumbers(pr);
  if (closed.length === 0) {
    console.log(`[ritual] PR #${pr} closes no issues; skipping.`);
    process.exit(0);
  }
  console.log(`[ritual] PR closes: ${closed.map((n) => `#${n}`).join(", ")}`);

  const triggerIssues: number[] = [];
  for (const n of closed) {
    const labels = getIssueLabels(n);
    if (labels.includes("ritual-exception")) {
      console.log(`[ritual] #${n} has ritual-exception → skipping ritual for this issue.`);
      continue;
    }
    if (!labels.includes("incident")) {
      console.log(`[ritual] #${n} is not labelled 'incident' → no-op.`);
      continue;
    }
    if (!issueHasKbDraftComment(n)) {
      console.log(`[ritual] #${n} is 'incident' but has no post-mortem KB-draft comment → no-op (manual tag).`);
      continue;
    }
    triggerIssues.push(n);
  }

  if (triggerIssues.length === 0) {
    console.log(`[ritual] ✓ no incident-with-post-mortem closures on this PR.`);
    process.exit(0);
  }

  console.log(`[ritual] triggering issues: ${triggerIssues.map((n) => `#${n}`).join(", ")}`);
  const files = getChangedFiles(pr);
  if (changedFilesSatisfyRitual(files)) {
    console.log(`[ritual] ✓ PR touches at least one ritual path — incident lesson locked.`);
    process.exit(0);
  }

  console.error(
    `\n✖ ritual breach: PR #${pr} closes an incident with a drafted KB additions, ` +
      `but the changeset touches NONE of:\n` +
      PATHS_THAT_SATISFY.map((p) => `    - ${p}`).join("\n") +
      `\n\nLand the invariant + guard from the issue's "KB additions (draft)" comment\n` +
      `in this PR. To bypass for a legitimate exception, add the 'ritual-exception'\n` +
      `label to issue#${triggerIssues[0]} with a comment explaining why.`,
  );
  process.exit(1);
}

main();
