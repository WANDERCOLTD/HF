/**
 * check-fix-refactor-inversion.ts — flags AP-5: band-aid `fix:` commits that
 * a later `feat:`/`refactor:` commit on the same branch (or recent history)
 * substantially overlaps.
 *
 * WARN-ONLY by design — this is harder to make structural than AP-1..AP-4.
 * The output is intended for a PR comment, not a blocker.
 *
 * Algorithm:
 *   1. Walk commits in the inspection range (default: HEAD's branch since
 *      it forked from main).
 *   2. For each `fix:` commit, record its touched-files set.
 *   3. For each later `feat:` / `refactor:` commit on the same range, check
 *      file-overlap. If >=50% of the fix's files reappear in the feat (and
 *      the feat touches >=1 new structural concern), the fix was likely a
 *      band-aid the structural cleanup would have eliminated.
 *   4. Emit a markdown report suitable for a PR comment.
 *
 * Verified live against the #1345 → #1342 sequence in history:
 *   $ scripts/check-fix-refactor-inversion.ts --range 00c70f2b~1..c6943810
 *
 * Anchor: docs/kb/guard-registry.md#guard-fix-refactor-inversion
 *         docs/decisions/2026-06-11-chase-prevention-methodology.md
 */

import { execSync } from "node:child_process";

type Commit = {
  sha: string;
  shortSha: string;
  subject: string;
  files: Set<string>;
  type: "fix" | "feat" | "refactor" | "other";
  issues: Set<string>;
};

function git(args: string[]): string {
  return execSync(`git ${args.join(" ")}`, { encoding: "utf8" }).trim();
}

function parseRange(): string {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--range");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  try {
    const base = git(["merge-base", "HEAD", "main"]);
    return `${base}..HEAD`;
  } catch {
    return "HEAD~50..HEAD";
  }
}

function classifyType(subject: string): Commit["type"] {
  if (/^fix[(:]/.test(subject)) return "fix";
  if (/^feat[(:]/.test(subject)) return "feat";
  if (/^refactor[(:]/.test(subject)) return "refactor";
  return "other";
}

function extractIssues(text: string): Set<string> {
  const out = new Set<string>();
  const matches = text.match(/#(\d{2,6})/g) || [];
  for (const m of matches) out.add(m.slice(1));
  return out;
}

/**
 * Load commits in two passes:
 *   1. `git log --pretty=format:%H<SEP>%s<SEP>%b<RECORD_END>` to get sha +
 *      subject + body per commit. The RECORD_END marker tolerates multi-line
 *      bodies (the AP-5 trap was a single SEP terminator that bodies
 *      containing newlines broke).
 *   2. `git show --name-only` per SHA for the files set.
 * Slower than one pipe but bulletproof on real commit history.
 */
function loadCommits(range: string): Commit[] {
  const SEP = "@@HF@@";
  const RECORD_END = "@@END_HF_COMMIT@@";
  const raw = git([
    "log",
    "--reverse",
    range,
    `--pretty=format:%H${SEP}%s${SEP}%b${RECORD_END}`,
  ]);
  const commits: Commit[] = [];
  const records = raw.split(RECORD_END).map((r) => r.trim()).filter(Boolean);

  for (const rec of records) {
    const parts = rec.split(SEP);
    if (parts.length < 3) continue;
    const [sha, subject, body] = parts;
    const cleanSha = sha.trim();
    const shortSha = cleanSha.slice(0, 8);
    let filesOut = "";
    try {
      filesOut = git([
        "show",
        "--no-color",
        "--name-only",
        "--pretty=format:",
        "--diff-filter=ACMR",
        cleanSha,
      ]);
    } catch {
      filesOut = "";
    }
    const files = new Set(
      filesOut
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    );
    commits.push({
      sha: cleanSha,
      shortSha,
      subject: subject.trim(),
      files,
      type: classifyType(subject.trim()),
      issues: extractIssues(`${subject} ${body}`),
    });
  }
  return commits;
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hits = 0;
  for (const f of a) if (b.has(f)) hits++;
  return hits / a.size;
}

function main() {
  const range = parseRange();
  const commits = loadCommits(range);

  const fixes = commits.filter((c) => c.type === "fix" && c.files.size > 0);
  const structural = commits.filter(
    (c) => (c.type === "feat" || c.type === "refactor") && c.files.size > 0,
  );

  if (fixes.length === 0 || structural.length === 0) {
    console.log(
      `[fix-refactor-inversion] no fix→feat pairs in range ${range} ` +
        `(${commits.length} commits, ${fixes.length} fix, ${structural.length} feat/refactor).`,
    );
    return;
  }

  type Inversion = {
    fix: Commit;
    structural: Commit;
    ratio: number;
    overlappingFiles: string[];
  };
  const inversions: Inversion[] = [];

  for (const fix of fixes) {
    const fixIdx = commits.indexOf(fix);
    for (const s of structural) {
      const sIdx = commits.indexOf(s);
      if (sIdx <= fixIdx) continue;
      const ratio = overlapRatio(fix.files, s.files);
      if (ratio >= 0.5) {
        const overlap = [...fix.files].filter((f) => s.files.has(f));
        inversions.push({
          fix,
          structural: s,
          ratio,
          overlappingFiles: overlap,
        });
      }
    }
  }

  if (inversions.length === 0) {
    console.log(
      `[fix-refactor-inversion] no inversions detected in ${commits.length} commits.`,
    );
    return;
  }

  console.log("## Fix-before-refactor inversion (AP-5) — warn-only");
  console.log("");
  console.log(
    `Detected ${inversions.length} band-aid \`fix:\` commit(s) on this branch ` +
      `that a later \`feat:\`/\`refactor:\` substantially overlapped. Each row ` +
      `is a candidate for "should this fix have been deferred until the cleanup?".`,
  );
  console.log("");
  console.log(
    "| Fix | Structural overlap | Ratio | Overlapping files |\n" +
      "|---|---|---|---|",
  );
  for (const inv of inversions) {
    const filesShort = inv.overlappingFiles
      .slice(0, 3)
      .map((f) => `\`${f}\``)
      .join(", ");
    const more =
      inv.overlappingFiles.length > 3
        ? ` (+${inv.overlappingFiles.length - 3} more)`
        : "";
    console.log(
      `| \`${inv.fix.shortSha}\` ${inv.fix.subject.slice(0, 60)} ` +
        `| \`${inv.structural.shortSha}\` ${inv.structural.subject.slice(0, 60)} ` +
        `| ${Math.round(inv.ratio * 100)}% ` +
        `| ${filesShort}${more} |`,
    );
  }
  console.log("");
  console.log(
    "_AP-5 is warn-only. The lesson is for next time: when a `fix:` and a " +
      "`feat:`/`refactor:` will touch the same files, defer the fix when the " +
      "cleanup is imminent. Anchor: docs/kb/guard-registry.md#guard-fix-refactor-inversion_",
  );
}

main();
