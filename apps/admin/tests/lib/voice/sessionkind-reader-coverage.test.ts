/**
 * SessionKind reader coverage — Lattice 5th-pillar Coverage test.
 *
 * **What this test pins:**
 *  Every `SessionKindString` value in
 *  `apps/admin/lib/voice/session-rules.ts` MUST have BOTH a writer
 *  (at least one code path creates a Session with that kind) AND a
 *  reader (at least one runtime / UI surface branches on that kind).
 *
 *  A kind with no writer is a `type-only ghost`: declared in the type
 *  union but unreachable from any runtime path. ASSESSMENT and
 *  TEXT_CHAT were both ghosts at this test's birth (2026-06-21) —
 *  declared on epic #1338 alongside ENROLLMENT / VOICE_CALL / SIM_CALL,
 *  but no `createSession({ kind: ... })` call ever passes them.
 *
 *  A kind with a writer but no reader is a producer-only kind: the
 *  pipeline writes it but no admin surface badge, no learner-facing
 *  copy, no analysis-spec branch ever consumes it. SIM_CALL was at
 *  this boundary in the 2026-06-21 audit (read by pipeline runners,
 *  but no admin list view distinguished it from VOICE_CALL).
 *
 * **How matching works:**
 *  For each kind, the test walks two source sets:
 *    - **Writers**: `lib/voice`, `lib/intake`, `lib/test-harness`,
 *      `app/api`, `lib/curriculum`. Match shape:
 *      `kind:\s*["']<value>["']` or `kind\s*=\s*["']<value>["']`.
 *    - **Readers**: `lib/voice`, `lib/pipeline`, `lib/curriculum`,
 *      `app/api`, `app/x`, `components`. Match shape:
 *      `kind ===|case ['"X'"]:|kind !==` against the value, OR a
 *      type-narrowing check via SessionKindString.
 *
 *  Each value gets a (writer, reader) classification. Exempt cells live
 *  in `SESSIONKIND_AXIS_EXEMPT` with a >20-char reason. Ratchet pins
 *  the incumbent count.
 *
 * **How to fix a failure:**
 *  - "Kind X has no writer / reader": either implement the missing side,
 *    OR remove the value from the SessionKindString union (the right
 *    move for ASSESSMENT / TEXT_CHAT if they remain unused).
 *  - "Ratchet drifted": consciously bump or close.
 *
 *  See `.claude/rules/sessionkind-reader-coverage.md` for the durable
 *  rule.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────
// Canonical kind set — verified at runtime against source union
// ────────────────────────────────────────────────────────────

const SESSION_KIND_VALUES = [
  "ENROLLMENT",
  "ASSESSMENT",
  "VOICE_CALL",
  "SIM_CALL",
  "TEXT_CHAT",
] as const;

type SessionKind = (typeof SESSION_KIND_VALUES)[number];

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");

const UNION_SOURCE_PATH = join(
  REPO_ADMIN,
  "lib",
  "voice",
  "session-rules.ts",
);

// ────────────────────────────────────────────────────────────
// Two axes the matrix pins
// ────────────────────────────────────────────────────────────

type KindAxis = "writer" | "reader";
const AXES: readonly KindAxis[] = ["writer", "reader"] as const;

const AXIS_DIRS: Record<KindAxis, string[]> = {
  writer: [
    "lib/voice",
    "lib/intake",
    "lib/test-harness",
    "app/api",
    "lib/curriculum",
  ],
  reader: [
    "lib/voice",
    "lib/pipeline",
    "lib/curriculum",
    "lib/prompt",
    "app/api",
    "app/x",
    "components",
  ],
};

// ────────────────────────────────────────────────────────────
// Exempt list — (kind, axis) cells where the gap is consciously
// accepted (kind reserved for future implementation, or already
// retired but kept in union for backwards compat).
// Required: one-line reason >20 chars.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  reason: string;
}

type CellKey = `${SessionKind}.${KindAxis}`;

const SESSIONKIND_AXIS_EXEMPT: Partial<Record<CellKey, ExemptEntry>> = {
  // ASSESSMENT — declared on epic #1338 alongside ENROLLMENT for
  // future formal-assessment session kinds (separate from VOICE_CALL
  // because counterFlags differ). No writer or reader today. Decision
  // pending: implement (paired with #2015 Distinction-tier rubric) or
  // remove from union.
  "ASSESSMENT.writer": {
    reason:
      "type-only ghost since epic #1338; reserved for future formal assessment session kind, decision pending #2015 Distinction-tier rubric",
  },
  "ASSESSMENT.reader": {
    reason:
      "type-only ghost since epic #1338; no admin/learner surface consumes it yet, paired with ASSESSMENT.writer exemption",
  },
  // TEXT_CHAT — declared on epic #1338 for a future in-app text-only
  // chat session kind (no voice infrastructure). No writer or reader
  // today. Same decision-pending status as ASSESSMENT.
  "TEXT_CHAT.writer": {
    reason:
      "type-only ghost since epic #1338; reserved for future text-only chat session kind without VAPI/voice infrastructure",
  },
  "TEXT_CHAT.reader": {
    reason:
      "type-only ghost since epic #1338; PROSODY explicitly no-ops on TEXT_CHAT per session-rules.ts comment, but no consumer reads it",
  },
};

/** Ratchet — exempt count. Drops as kinds get wired or removed. */
const EXPECTED_EXEMPT_COUNT = 4;

/** Ratchet — open gaps (cells with no consumer + no exemption). */
const EXPECTED_GAP_COUNT = 0;

// ────────────────────────────────────────────────────────────
// Source-walk
// ────────────────────────────────────────────────────────────

function walkSource(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "__tests__" || e === ".next") continue;
      out.push(...walkSource(full));
    } else if (
      (e.endsWith(".ts") || e.endsWith(".tsx")) &&
      !e.endsWith(".test.ts") &&
      !e.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

function concatSourceForAxis(axis: KindAxis): string {
  const files: string[] = [];
  for (const rel of AXIS_DIRS[axis]) {
    files.push(...walkSource(resolve(REPO_ADMIN, rel)));
  }
  return files
    .map((f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

const AXIS_SOURCE: Record<KindAxis, string> = {
  writer: concatSourceForAxis("writer"),
  reader: concatSourceForAxis("reader"),
};

/** Writer pattern — kind appears as an object literal field or
 *  variable assignment with the kind value as a string literal. */
function kindHasWriter(kind: SessionKind, source: string): boolean {
  const esc = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match: `kind: "X"`, `kind = "X"`, `kind:"X"`, `kind="X"`
  const re = new RegExp(`\\bkind\\s*[:=]\\s*["']${esc}["']`, "m");
  return re.test(source);
}

/** Reader pattern — kind appears either:
 *    (a) in an equality comparison against `kind` / `.kind`, OR
 *    (b) as a Prisma `where: { kind: "X" }` query field, OR
 *    (c) as a Prisma `data: { kind: "X" }` field on a write whose
 *        downstream pipeline reads it back.
 *  All three are legitimate consumer signals — the kind value carries
 *  semantic meaning that some code path acts on.
 *
 *  Excludes `case "X":` branches because the type-exhaustiveness
 *  switch at `lib/voice/session-rules.ts::initialCounterFlags`
 *  enumerates every union member by `case` — that's type plumbing,
 *  not a business-logic reader. ASSESSMENT and TEXT_CHAT have those
 *  `case` branches but no `kind: "X"` or `=== "X"` reader, which is
 *  exactly the "ghost" state this test pins. */
function kindHasReader(kind: SessionKind, source: string): boolean {
  const esc = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:\\.\\s*kind\\s*[!=]==\\s*["']${esc}["'])|(?:\\bkind\\s*[!=]==\\s*["']${esc}["'])|(?:\\bkind\\s*:\\s*["']${esc}["'])`,
    "m",
  );
  return re.test(source);
}

type Classification = "covered" | "exempt" | "gap";

interface CellResult {
  kind: SessionKind;
  axis: KindAxis;
  key: CellKey;
  classification: Classification;
  reason?: string;
}

function classifyCell(kind: SessionKind, axis: KindAxis): CellResult {
  const key: CellKey = `${kind}.${axis}`;
  const exempt = SESSIONKIND_AXIS_EXEMPT[key];
  if (exempt) {
    return { kind, axis, key, classification: "exempt", reason: exempt.reason };
  }
  const consumed =
    axis === "writer"
      ? kindHasWriter(kind, AXIS_SOURCE.writer)
      : kindHasReader(kind, AXIS_SOURCE.reader);
  if (consumed) return { kind, axis, key, classification: "covered" };
  return { kind, axis, key, classification: "gap" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("SessionKind writer + reader coverage (Lattice Coverage)", () => {
  const results: CellResult[] = SESSION_KIND_VALUES.flatMap((k) =>
    AXES.map((a) => classifyCell(k, a)),
  );

  it("test matrix matches the source-of-truth type union", () => {
    const src = readFileSync(UNION_SOURCE_PATH, "utf8");
    const m = src.match(
      /export\s+type\s+SessionKindString\s*=\s*([^;]+);/m,
    );
    expect(m, "SessionKindString export not found in session-rules.ts").toBeTruthy();
    const sourceValues = (m![1].match(/["']([^"']+)["']/g) ?? []).map((s) =>
      s.replace(/["']/g, ""),
    );
    const sorted = [...sourceValues].sort();
    const local = [...SESSION_KIND_VALUES].sort();
    expect(
      sorted,
      `Source SessionKindString diverged from test matrix. Source: ${sorted.join(", ")}; matrix: ${local.join(", ")}. Update SESSION_KIND_VALUES + add coverage rows.`,
    ).toEqual(local);
  });

  it("no (kind, axis) cell is an uncovered gap beyond the ratchet", () => {
    const gaps = results.filter((r) => r.classification === "gap");
    expect(
      gaps.length,
      `SessionKind coverage gaps (no writer / reader, no exemption):\n  ${gaps
        .map((g) => g.key)
        .join("\n  ")}\n\nFix: implement the missing side, OR remove the value from SessionKindString, OR add to SESSIONKIND_AXIS_EXEMPT with a >20-char reason.`,
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const ex = Object.keys(SESSIONKIND_AXIS_EXEMPT);
    expect(
      ex.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `Current: ${ex.join(", ")}.`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a substantive reason (>20 chars)", () => {
    for (const [k, entry] of Object.entries(SESSIONKIND_AXIS_EXEMPT)) {
      expect(
        entry!.reason.trim().length,
        `${k}: reason too short`,
      ).toBeGreaterThan(20);
    }
  });

  it("no exempt entry is contradicted by an actual consumer match", () => {
    const contradicted: string[] = [];
    for (const [k] of Object.entries(SESSIONKIND_AXIS_EXEMPT)) {
      const [kind, axis] = k.split(".") as [SessionKind, KindAxis];
      const matched =
        axis === "writer"
          ? kindHasWriter(kind, AXIS_SOURCE.writer)
          : kindHasReader(kind, AXIS_SOURCE.reader);
      if (matched) contradicted.push(k);
    }
    expect(
      contradicted,
      `Exempt entries that now have real matches — remove from SESSIONKIND_AXIS_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no exempt entry references an unknown kind (stale row)", () => {
    const known = new Set<string>(SESSION_KIND_VALUES);
    const stale: string[] = [];
    for (const k of Object.keys(SESSIONKIND_AXIS_EXEMPT)) {
      const [kind] = k.split(".");
      if (!known.has(kind)) stale.push(k);
    }
    expect(stale, `Stale exempt entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      covered: 0,
      exempt: 0,
      gap: 0,
    };
    for (const r of results) counts[r.classification]++;
    const sum = counts.covered + counts.exempt + counts.gap;
    expect(sum).toBe(SESSION_KIND_VALUES.length * AXES.length);
  });
});
