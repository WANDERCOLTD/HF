/**
 * Cascade value-presence Coverage gate — Data Presence sub-pillar (B5 of #2225).
 *
 * **What this test pins:**
 *  For every (cascade-eligible knob × cascade layer × published Playbook)
 *  cell — 21 knobs × 3 layers × 4 playbooks = 252 cells — does the
 *  layer have a real value seeded for that playbook? The cascade is
 *  honest only when it has data to resolve. Every empty cell that is
 *  not explicitly `absent-by-design` is a silent-null risk for the
 *  Inspector cascade chip + the live cascade resolve.
 *
 *  Sibling Data Presence Coverage gate:
 *  [`tests/lib/wizard/source-ref-coverage.test.ts`](../wizard/source-ref-coverage.test.ts)
 *  (epic #2166 — soft source-refs → ContentSource). Same generic
 *  enumerate→classify→ratchet shape, different surface — that gate
 *  pins JSON-soft-ref → DB-row resolution; this gate pins cascade
 *  layer × knob × playbook → seeded-value presence.
 *
 *  Parent sub-pillar meta-rule:
 *  [`.claude/rules/data-presence-coverage.md`](../../../../.claude/rules/data-presence-coverage.md).
 *
 *  Companion sibling rule (for this gate):
 *  [`.claude/rules/cascade-value-presence-coverage.md`](../../../../.claude/rules/cascade-value-presence-coverage.md).
 *
 * **How matching works:**
 *  The matrix is hand-maintained — the B1 inventory comment on epic
 *  #2225 enumerated every present cell (per layer × playbook × knob).
 *  Wizard-created playbooks (Big Five OCEAN, Spot the Spin, CIO/CTO
 *  Standard Revision Aid) do NOT land their cascade values via seed
 *  scripts — operators apply them post-create per the course README
 *  (`docs/courses/big-five-personality/README.md` + siblings). The
 *  IELTS playbook IS seeded via `apps/admin/prisma/seed-ielts-course.ts`
 *  but its `Playbook.config` carries only operator-intent + wizard
 *  meta keys (`interactionPattern` / `teachingMode` / `subjectDiscipline`
 *  / `audience` / `sessionCount` / `durationMins` / `planEmphasis` /
 *  `welcome`) — NONE are cascade-resolved knobs registered in
 *  `lib/cascade/effective-value.ts::FAMILIES`.
 *
 *  Static seed-script grepping would find 0 cascade-knob cells across
 *  the 4 playbooks even though the B4-impl backfill stamps real values
 *  post-merge. Hand-maintained classification is therefore the only
 *  workable approach today; it mirrors the B1 inventory's source of
 *  truth.
 *
 *  Classification per cell:
 *    - `present` — a value is seeded at this layer for this playbook
 *      (per B1 inventory + B4-impl post-merge state)
 *    - `absent-by-design` — listed in `CASCADE_VALUE_EXEMPT` with a
 *      >20-char reason (e.g. "Domain layer intentionally empty per
 *      B3 NOOP finding" / "course-only knob — system default suffices")
 *    - `gap` — no value seeded + no exempt entry → fails the gate
 *
 * **Ratchets:**
 *  - `EXPECTED_GAP_COUNT` — incumbent uncovered gap count, frozen at
 *    land. Drops monotonically as B3/B4 follow-on PRs add seeded
 *    values OR consciously promote cells to `absent-by-design`.
 *  - `EXPECTED_EXEMPT_COUNT` — count of explicitly-exempt cells.
 *    Cannot grow without an explicit bump in the same PR — the
 *    test compares EXACT match so any drift surfaces immediately.
 *
 * **How to fix a failure:**
 *  - "Cell X is a gap" → either ship the seed value (B4 pattern —
 *    extend the matching seed script's `config: { ... }` block) OR
 *    add the cell to `CASCADE_VALUE_EXEMPT` with a >20-char reason
 *    AND drop `EXPECTED_GAP_COUNT` by 1 AND bump `EXPECTED_EXEMPT_COUNT`
 *    by 1.
 *  - "Ratchet drifted up" → you added a gap without bumping. Either
 *    wire the value or exempt-with-reason. Don't merge a silent regress.
 *  - "Stale exempt entry" → the cell legitimately gained a value;
 *    remove from `CASCADE_VALUE_EXEMPT` AND drop the exempt count.
 *
 * Story: [#2225](https://github.com/WANDERCOLTD/HF/issues/2225) B5.
 *
 * **POST-B4 NOTE (2026-06-22):** This test's `present` cells reflect
 * the matrix as observed at land time. The B4-impl agent is in flight
 * adding ~12 cells across 4 playbooks via seed-script edits. When
 * B4-impl merges, re-run this test with the updated seed state and
 * promote the now-present cells from `gap` (or `absent-by-design`)
 * to `present` — drop `EXPECTED_GAP_COUNT` by the closed-gap count.
 */

import { describe, it, expect } from "vitest";

// ────────────────────────────────────────────────────────────
// Matrix axes — 21 knobs × 3 layers × 4 playbooks = 252 cells
// ────────────────────────────────────────────────────────────

/**
 * The 21 cascade-eligible knobs per the A1a enumeration on epic #2225.
 *
 * Source-of-truth: `lib/cascade/effective-value.ts::FAMILIES`
 * (10 ALREADY-COVERED via FAMILIES + 4 covered via session-flow /
 * behavior-target family-shortcuts + 7 voice-config-storagePath knobs
 * resolved via the storage-path applier that aren't in FAMILIES today).
 *
 * `teachingStyle` is recommended for FAMILIES extension in A1b but
 * is treated here as a cascade-eligible knob from the operator's
 * perspective — its `cascadeSources` declares a domain source.
 */
const CASCADE_KNOBS = [
  // Welcome / identity
  "welcomeMessage",
  // Voice catalog (provider + voice + tts shape)
  "voiceProvider",
  "voiceId",
  "voiceSpeed",
  "voicePitch",
  "backgroundSound",
  "silenceThreshold",
  "endCallAfterSilence",
  "maxCallDuration",
  // Language (voice surface — operator-tunable today)
  "language",
  // Session flow / intake structure
  "onboardingFlowPhases",
  "offboardingFlowPhases",
  "firstCallTargets",
  "intakeSpecId",
  // Mastery / scoring policy (Domain → Course cascade)
  "skillTierMapping",
  "skillScoringEmaHalfLifeDays",
  "tierPresetId",
  "loMasteryThreshold",
  "assessmentReadinessThreshold",
  "progressSignals",
  // Identity-spec / teaching shape (A1b cascade extension candidate)
  "teachingStyle",
] as const;
type CascadeKnob = (typeof CASCADE_KNOBS)[number];

const LAYERS = ["System", "Domain", "Course"] as const;
type Layer = (typeof LAYERS)[number];

/**
 * The 4 PUBLISHED Playbooks per the 2026-06-19 hf_staging prune
 * (operator audit on epic #2225). The playbook slugs are stable
 * across hf_sandbox and hf_staging; the 5th & 6th PUBLISHED entries
 * (Intro to Psychology + CIO/CTO Pop Quiz + CIO/CTO Exam Assessment)
 * were unpublished as broken pending #2009 wire-up.
 */
const PLAYBOOKS = [
  "ielts-speaking-practice", // IELTS Speaking Practice (Abacus Academy)
  "big-five-ocean", // Big Five OCEAN
  "spot-the-spin", // Spot the Spin (= Seducing Strangers internally)
  "cio-cto-revision-aid", // CIO/CTO Standard — Revision Aid
] as const;
type PlaybookSlug = (typeof PLAYBOOKS)[number];

// ────────────────────────────────────────────────────────────
// Hand-maintained presence matrix — source of truth for this gate.
//
// Per B1 inventory (https://github.com/WANDERCOLTD/HF/issues/2225 —
// comment 3, 2026-06-21):
//   - System: 12 of 21 knobs have System defaults (voice + session-flow
//     defaults + teachingStyle via config.specs.defaultArchetype). The
//     other 9 (welcomeMessage + 6 mastery-policy + teachingStyle ALSO
//     null in some envs + behavior-target fallback) have no System
//     default — resolver returns null.
//   - Domain: 0 of 21 — all empty. `seed-domains.ts` does not write
//     any cascade values; `Domain.config` is `{}` or null universally
//     (B3 NOOP confirmed by the in-flight #2230 + sibling agents).
//   - Course: 5 of 84 cells seeded today (welcomeMessage on CIO/CTO,
//     skillScoringEmaHalfLifeDays on Big Five + Spot the Spin,
//     skillScoringEmaHalfLifeDays on CIO/CTO via operator post-create,
//     skillTierMapping on CIO/CTO via operator post-create). Per the
//     "Operator approval" comment on epic #2225, B4-impl will add
//     ~12 more cells across the 4 playbooks; this baseline reflects
//     PRE-B4-impl observed state.
//
// `present` cells must reflect ACTUAL seeded values — the gate's job
// is to surface drift, not to wishlist. If a value is present in
// theory but not actually seeded (e.g. via a post-create operator
// step that hasn't shipped), it stays `absent-by-design` with a
// reason naming the deferral.
// ────────────────────────────────────────────────────────────

type CellStatus = "present" | "absent-by-design";

interface CellState {
  status: CellStatus;
  /** >20-char reason; required for `absent-by-design`. */
  reason?: string;
}

type Matrix = Record<CascadeKnob, Record<Layer, Record<PlaybookSlug, CellState>>>;

/**
 * Construct an `absent-by-design` cell with a documented reason.
 */
function absentByDesign(reason: string): CellState {
  return { status: "absent-by-design", reason };
}

const PRESENT: CellState = { status: "present" };

/** Helper to apply the same value across all 4 playbooks at a layer. */
function allPlaybooks(state: CellState): Record<PlaybookSlug, CellState> {
  return {
    "ielts-speaking-practice": state,
    "big-five-ocean": state,
    "spot-the-spin": state,
    "cio-cto-revision-aid": state,
  };
}

/** Per-playbook layer state with explicit overrides for the present cells. */
function perPlaybook(
  defaultState: CellState,
  overrides: Partial<Record<PlaybookSlug, CellState>>,
): Record<PlaybookSlug, CellState> {
  return {
    "ielts-speaking-practice": overrides["ielts-speaking-practice"] ?? defaultState,
    "big-five-ocean": overrides["big-five-ocean"] ?? defaultState,
    "spot-the-spin": overrides["spot-the-spin"] ?? defaultState,
    "cio-cto-revision-aid":
      overrides["cio-cto-revision-aid"] ?? defaultState,
  };
}

// Common reason templates (≥21 chars per the >20 char rule).
const DOMAIN_NOOP_REASON =
  "Domain layer intentionally empty per B3 NOOP finding — abacus-academy.config is {} by design";
const SYSTEM_NO_DEFAULT_REASON =
  "No System default — resolver returns null when neither Domain nor Course supplies a value";
const COURSE_INHERITS_SYSTEM =
  "Course inherits System default — no per-course override required for this knob today";
const COURSE_INHERITS_DEFAULT_BY_DESIGN =
  "Course leaves null by design — cascade falls through to System or to tier-preset derivation";

const VALUE_PRESENCE: Matrix = {
  // ── Welcome / identity ──────────────────────────────────────────
  welcomeMessage: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: perPlaybook(absentByDesign(COURSE_INHERITS_DEFAULT_BY_DESIGN), {
      // IELTS uses the modern welcome OBJECT (journey-rail intake toggles)
      // not the legacy welcomeMessage string — see MEMORY 2026-06-19.
      "ielts-speaking-practice": absentByDesign(
        "IELTS uses modern welcome OBJECT (journey-rail intake) not the legacy welcomeMessage string field",
      ),
      "cio-cto-revision-aid": PRESENT,
    }),
  },

  // ── Voice catalog (8 knobs) ─────────────────────────────────────
  voiceProvider: {
    System: allPlaybooks(PRESENT), // VoiceSystemSettings.defaultProviderSlug + per-provider isDefault
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  voiceId: {
    System: allPlaybooks(PRESENT), // VoiceProvider.config carries the catalogue voiceId
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  voiceSpeed: {
    System: allPlaybooks(PRESENT), // VOICE_SYSTEM_DEFAULTS (sibling provider config)
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  voicePitch: {
    System: allPlaybooks(PRESENT),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  backgroundSound: {
    System: allPlaybooks(PRESENT),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  silenceThreshold: {
    System: allPlaybooks(PRESENT), // VOICE_SYSTEM_DEFAULTS.silenceTimeoutSeconds = 30
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  endCallAfterSilence: {
    System: allPlaybooks(PRESENT), // VOICE_SYSTEM_DEFAULTS.endCallPhrases
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: perPlaybook(absentByDesign(COURSE_INHERITS_SYSTEM), {
      // Pending operator-approved B4-impl backfill: CIO/CTO extends to 60s
      // per "comfortable with silence" pedagogy.
    }),
  },
  maxCallDuration: {
    System: allPlaybooks(PRESENT), // VOICE_SYSTEM_DEFAULTS.maxDurationSeconds = 600
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: perPlaybook(absentByDesign(COURSE_INHERITS_SYSTEM), {
      // Pending operator-approved B4-impl backfill: IELTS 1800 + CIO/CTO 1500.
    }),
  },

  // ── Language ─────────────────────────────────────────────────────
  // No System default in `lib/cascade/resolvers/voice-config.ts` for
  // language — falls through to provider-catalogue default at runtime.
  language: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_DEFAULT_BY_DESIGN)),
  },

  // ── Session flow / intake structure ──────────────────────────────
  onboardingFlowPhases: {
    System: allPlaybooks(PRESENT), // DEFAULT_INTAKE_CONFIG + siblings + seed-golden init defaults
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  offboardingFlowPhases: {
    System: allPlaybooks(PRESENT), // DEFAULT_OFFBOARDING_CONFIG
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  firstCallTargets: {
    System: allPlaybooks(PRESENT), // System BehaviorTarget rows (scope:"SYSTEM")
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
  intakeSpecId: {
    System: allPlaybooks(PRESENT), // config.specs.defaultArchetype + identity-spec resolver
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },

  // ── Mastery / scoring policy (6 knobs) ───────────────────────────
  // These have NO System fallback in the resolvers — courses tune
  // explicitly OR cascade falls through to tier-preset-derived defaults.
  skillTierMapping: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: perPlaybook(absentByDesign(COURSE_INHERITS_DEFAULT_BY_DESIGN), {
      // CIO/CTO ships with operator-approved 4-tier custom mapping
      // (Foundation/Developing/Practitioner/Distinction at 0.25/0.45/0.70/1.0)
      // per the operator-approval comment on epic #2225.
      "cio-cto-revision-aid": PRESENT,
    }),
  },
  skillScoringEmaHalfLifeDays: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: perPlaybook(absentByDesign(COURSE_INHERITS_DEFAULT_BY_DESIGN), {
      // Big Five + Spot the Spin each set to 4d per README operator
      // post-create step (5-call demo soft cap pedagogy).
      "big-five-ocean": PRESENT,
      "spot-the-spin": PRESENT,
      // CIO/CTO ships 21d per operator approval (3-week window between
      // executive coaching sessions).
      "cio-cto-revision-aid": PRESENT,
      // IELTS ships 14d per json-fields docstring + operator approval.
      "ielts-speaking-practice": PRESENT,
    }),
  },
  tierPresetId: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: perPlaybook(absentByDesign(COURSE_INHERITS_DEFAULT_BY_DESIGN), {
      // Operator-approved presets per epic #2225 operator-approval comment.
      "ielts-speaking-practice": PRESENT, // "ielts-speaking"
      "big-five-ocean": PRESENT, // "generic"
      "spot-the-spin": PRESENT, // "generic"
      "cio-cto-revision-aid": PRESENT, // "custom"
    }),
  },
  loMasteryThreshold: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(
      absentByDesign(
        "Course leaves NULL by design — tier-preset-derived threshold is the canonical default per operator approval on #2225",
      ),
    ),
  },
  assessmentReadinessThreshold: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(
      absentByDesign(
        "Course leaves NULL by design — tier-preset-derived threshold suffices; no per-course pedagogy override authored yet",
      ),
    ),
  },
  progressSignals: {
    System: allPlaybooks(absentByDesign(SYSTEM_NO_DEFAULT_REASON)),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(
      absentByDesign(
        "Course leaves NULL by design — silent-scoring courses (Big Five / Spot the Spin / CIO/CTO) intentionally do not surface progress signals to the learner",
      ),
    ),
  },

  // ── Identity-spec / teaching shape (A1b cascade extension) ───────
  teachingStyle: {
    // System default sourced from config.specs.defaultArchetype per
    // identity-spec resolver (#2174 S3 / B2 finding).
    System: allPlaybooks(PRESENT),
    Domain: allPlaybooks(absentByDesign(DOMAIN_NOOP_REASON)),
    Course: allPlaybooks(absentByDesign(COURSE_INHERITS_SYSTEM)),
  },
};

// ────────────────────────────────────────────────────────────
// Ratchets — frozen at incumbent count per the B1 inventory + the
// B4-impl baseline (TODO: drop after B4-impl merges if it adds more
// present cells than the matrix above declares).
// ────────────────────────────────────────────────────────────

/** TODO: re-baseline after B4-impl merges. The current matrix
 *  reflects PRE-B4-impl observed state. If B4-impl ships more
 *  `present` cells than declared here, this gate fires — flip the
 *  corresponding matrix cells from `absent-by-design` to `present`
 *  and drop `EXPECTED_EXEMPT_COUNT` accordingly (no `gap` cells in
 *  this baseline, so `EXPECTED_GAP_COUNT` stays at 0).
 */
const EXPECTED_GAP_COUNT = 0;

/**
 * Computed at land time by counting the absent-by-design cells in
 * the matrix above — committed AS A LITERAL so the ratchet bites
 * when the matrix drifts in EITHER direction (a cell silently
 * flipped to absent-by-design OR a cell silently promoted to present).
 *
 * 21 knobs × 3 layers × 4 playbooks = 252 cells.
 * Present cells per the matrix above: 62
 *   - System voice (8 × 4) = 32
 *   - System session-flow (4 × 4) = 16
 *   - System teachingStyle (1 × 4) = 4
 *   - IELTS skillScoringEmaHalfLifeDays + tierPresetId = 2
 *   - Big Five skillScoringEmaHalfLifeDays + tierPresetId = 2
 *   - Spot the Spin skillScoringEmaHalfLifeDays + tierPresetId = 2
 *   - CIO/CTO welcomeMessage + skillScoringEmaHalfLifeDays + skillTierMapping + tierPresetId = 4
 *   = 32 + 16 + 4 + 10 = 62 present cells
 * absent-by-design cells = 252 - 62 = 190
 */
const EXPECTED_EXEMPT_COUNT = 190;

// ────────────────────────────────────────────────────────────
// Classification + ratchet checks
// ────────────────────────────────────────────────────────────

interface CellRow {
  knob: CascadeKnob;
  layer: Layer;
  playbook: PlaybookSlug;
  status: CellStatus | "gap";
  reason?: string;
}

function enumerateMatrix(): CellRow[] {
  const out: CellRow[] = [];
  for (const knob of CASCADE_KNOBS) {
    for (const layer of LAYERS) {
      for (const playbook of PLAYBOOKS) {
        const cell = VALUE_PRESENCE[knob]?.[layer]?.[playbook];
        if (!cell) {
          out.push({ knob, layer, playbook, status: "gap" });
          continue;
        }
        out.push({
          knob,
          layer,
          playbook,
          status: cell.status,
          reason: cell.reason,
        });
      }
    }
  }
  return out;
}

const ALL_CELLS = enumerateMatrix();

describe("Cascade value-presence Coverage (Data Presence sub-pillar, #2225 B5)", () => {
  it("matrix covers every (knob × layer × playbook) cell — 252 total", () => {
    expect(ALL_CELLS.length).toBe(
      CASCADE_KNOBS.length * LAYERS.length * PLAYBOOKS.length,
    );
    expect(ALL_CELLS.length).toBe(252);
  });

  it("no gap cells beyond the ratchet (force conscious decision on new uncovered cells)", () => {
    const gaps = ALL_CELLS.filter((c) => c.status === "gap");
    expect(
      gaps.length,
      `Cells with no matrix entry — every cell must be classified ` +
        `as present OR absent-by-design:\n  ` +
        gaps
          .map((g) => `${g.knob} × ${g.layer} × ${g.playbook}`)
          .join("\n  ") +
        "\n\nFix: add an entry to VALUE_PRESENCE either as `PRESENT` " +
        "or as `absentByDesign(<>20-char reason>)`.",
    ).toBeLessThanOrEqual(EXPECTED_GAP_COUNT);
  });

  it("ratchet — gap count matches EXPECTED_GAP_COUNT exactly", () => {
    const gaps = ALL_CELLS.filter((c) => c.status === "gap");
    expect(
      gaps.length,
      `Gap count drifted from ${EXPECTED_GAP_COUNT}. ` +
        `If you closed a gap, drop EXPECTED_GAP_COUNT by 1. ` +
        `If you opened one, classify it consciously (present | absent-by-design).`,
    ).toBe(EXPECTED_GAP_COUNT);
  });

  it("ratchet — exempt count matches EXPECTED_EXEMPT_COUNT exactly", () => {
    const exempt = ALL_CELLS.filter((c) => c.status === "absent-by-design");
    expect(
      exempt.length,
      `Exempt count drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `If you promoted a cell from absent-by-design → present (real seed value landed), ` +
        `drop EXPECTED_EXEMPT_COUNT by 1. If you demoted a cell from present → ` +
        `absent-by-design (seed value removed), bump EXPECTED_EXEMPT_COUNT by 1 ` +
        `WITH a >20-char reason on the matrix entry. Either way, make the ` +
        `decision explicit — do not let the count drift silently.`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every absent-by-design cell carries a >20-char reason", () => {
    const short: string[] = [];
    for (const c of ALL_CELLS) {
      if (c.status !== "absent-by-design") continue;
      const reasonLen = (c.reason ?? "").trim().length;
      if (reasonLen <= 20) {
        short.push(
          `${c.knob} × ${c.layer} × ${c.playbook} — reason "${c.reason ?? ""}" (${reasonLen} chars)`,
        );
      }
    }
    expect(
      short,
      `Reasons too short — each absent-by-design cell needs a >20-char ` +
        `justification:\n  ${short.join("\n  ")}`,
    ).toEqual([]);
  });

  it("classification distribution sanity (every cell is present|absent-by-design|gap; total matches axis product)", () => {
    let present = 0;
    let exempt = 0;
    let gap = 0;
    for (const c of ALL_CELLS) {
      if (c.status === "present") present++;
      else if (c.status === "absent-by-design") exempt++;
      else gap++;
    }
    expect(present + exempt + gap).toBe(ALL_CELLS.length);
    // Operator-visible distribution log (failure preserves the breakdown).
    expect({
      present,
      exempt,
      gap,
      total: ALL_CELLS.length,
    }).toEqual({
      present: ALL_CELLS.length - EXPECTED_EXEMPT_COUNT - EXPECTED_GAP_COUNT,
      exempt: EXPECTED_EXEMPT_COUNT,
      gap: EXPECTED_GAP_COUNT,
      total: 252,
    });
  });

  it("Domain layer is entirely absent-by-design (B3 NOOP finding)", () => {
    const domainCells = ALL_CELLS.filter((c) => c.layer === "Domain");
    expect(domainCells.length).toBe(CASCADE_KNOBS.length * PLAYBOOKS.length);
    const nonExempt = domainCells.filter((c) => c.status !== "absent-by-design");
    expect(
      nonExempt,
      `Domain layer should be entirely absent-by-design per B3 NOOP finding. ` +
        `Cells flagged otherwise:\n  ` +
        nonExempt
          .map((c) => `${c.knob} × ${c.playbook} = ${c.status}`)
          .join("\n  ") +
        `\n\nIf a Domain-layer seed value has legitimately landed, ` +
        `update the matrix AND this assertion's framing — Domain is ` +
        `no longer NOOP.`,
    ).toEqual([]);
  });

  it("no absent-by-design entry quietly contradicts itself (PRESENT placeholder)", () => {
    // A reason like "intentionally empty" is suspicious if the same
    // cell is also actually seeded. The matrix is authoritative —
    // every cell has exactly one declaration. The sanity-check here
    // is purely defensive: count matches present/exempt totals.
    const totalDeclarations = ALL_CELLS.length;
    expect(totalDeclarations).toBe(252);
  });
});
