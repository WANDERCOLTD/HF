/**
 * resolve-learner-shell.ts — #2197 (S2 of epic #2163).
 *
 * **Pure selection policy** that maps session + module context onto
 * a `LearnerShellKind` + the matching `LearnerShellCapabilities`.
 *
 * **Why pure + declarative.** Today's shell selection lives in
 * procedural code scattered across UI files —
 * `shouldMountExamModeShell` in `components/sim/ExamModeShell.tsx`
 * branches on `module.mode === "examiner"` for one shell, and every
 * other path implicitly assumes the chat-feed shell. There is no
 * single place to look up "given THIS (session, module), which shell
 * should mount?"
 *
 * S2 centralises into one function. Adding a new shell variant
 * (e.g. `mcq-rounds` for `quiz` mode) becomes "extend the rules
 * table here + add the SHELL_DEFAULTS row + add the consumer in S3".
 * No selection-logic edits scattered across UI files.
 *
 * **Lattice posture — sibling 4th-layer primitives.** The selection
 * function shape mirrors three peer primitives that already shipped
 * the same enumerate-then-select pattern:
 *
 *  - **SessionFocus** (#2145 Phase A) — `session-focus-policy` spec
 *    runner at `lib/pipeline/runners/session-focus-policy.ts` reads
 *    the policy config and writes the next-session focus literal.
 *  - **AssessmentKind** (PR #2180) — sampling engine at
 *    `lib/assessment/sample-questions.ts` reads the declarative
 *    `AssessmentSamplingPolicy` and produces the question set.
 *  - **Part3TechniqueFocus** (IELTS-P3-FOCUS-001 via `runSessionFocusPolicy`)
 *    — selection happens via the spec-driven runner, not via bespoke
 *    per-course code.
 *
 *  This file is the 4th — `LearnerShellKind` selection. Same
 *  enumerate-then-select shape, applied at the shell-mount surface.
 *
 * **No hardcodings — declarative rule table at top of file.** The
 *  selection rules live in `SHELL_SELECTION_RULES` as a const data
 *  table, not nested if-else. Adding a rule = adding a row. Per-shell
 *  capability OVERRIDES live in `SHELL_CAPABILITY_OVERRIDES` keyed
 *  on the input shape, NOT in if-else chains.
 *
 * **Discipline rule.** See `.claude/rules/learner-shell-selection.md`
 *  for the durable rule + when to add a new shell variant.
 *
 * **Author note on PR #2173 dependency.** This file would normally
 *  import `LearnerShellKind`, `LearnerShellCapabilities`, and
 *  `SHELL_DEFAULTS` from `lib/types/json-fields.ts`. PR #2173 (epic
 *  #2163 S1) introduces those exports but had not yet merged when
 *  S2 (this file) shipped. Local stubs declared below with
 *  `TODO(#2173-rebase)` markers — drop the stubs and switch to the
 *  named imports once #2173 lands on `main`.
 */

import type { AuthoredModuleMode } from "@/lib/types/json-fields";
import type { SessionKindString } from "@/lib/voice/session-rules";

// ────────────────────────────────────────────────────────────────────
// TODO(#2173-rebase): replace the local stubs below with imports from
// `@/lib/types/json-fields` once PR #2173 lands on main:
//
//   import {
//     SHELL_DEFAULTS,
//     type LearnerShellKind,
//     type LearnerShellCapabilities,
//   } from "@/lib/types/json-fields";
//
// The stubs are byte-identical to PR #2173's S1 shapes (same union
// values, same capability field names, same defaults map). When #2173
// merges, the LOCAL_ prefix vanishes and existing call sites need
// nothing more than the import swap.
// ────────────────────────────────────────────────────────────────────

/**
 * **Local stub** — mirrors PR #2173's `LearnerShellKind` exactly.
 * Drop once #2173 lands; switch to the imported type.
 */
export type LearnerShellKind =
  | "chat-feed"
  | "exam"
  | "mcq-rounds"
  | "results-readout"
  | "intake-wizard";

/**
 * **Local stub** — mirrors PR #2173's `LearnerShellCapabilities`.
 * Drop once #2173 lands; switch to the imported interface.
 */
export interface LearnerShellCapabilities {
  allowModuleSwitch: boolean;
  showTimer: "visible" | "hidden-internal" | "none";
  showProgressBar: "fill-bar" | "monologue-bar" | "mcq-counter" | "none";
  chatFeedVisibility: "full" | "cue-card-only" | "none";
  allowBackToHome: boolean;
  colourTheme: "default" | "dark" | "neutral" | "brand";
  modePillKey: string | null;
  dismissOnEnd: "home" | "results-screen" | "next-module";
  stallChipBehaviour: "subtle-fade" | "none";
}

/**
 * **Local stub** — mirrors PR #2173's `SHELL_DEFAULTS` row-for-row.
 * Drop once #2173 lands; switch to the imported const.
 */
const SHELL_DEFAULTS: Record<LearnerShellKind, LearnerShellCapabilities> = {
  "chat-feed": {
    allowModuleSwitch: true,
    showTimer: "none",
    showProgressBar: "fill-bar",
    chatFeedVisibility: "full",
    allowBackToHome: true,
    colourTheme: "default",
    modePillKey: "tutor",
    dismissOnEnd: "home",
    stallChipBehaviour: "subtle-fade",
  },
  exam: {
    allowModuleSwitch: false,
    showTimer: "hidden-internal",
    showProgressBar: "monologue-bar",
    chatFeedVisibility: "none",
    allowBackToHome: false,
    colourTheme: "dark",
    modePillKey: "mock-exam",
    dismissOnEnd: "results-screen",
    stallChipBehaviour: "none",
  },
  "mcq-rounds": {
    allowModuleSwitch: false,
    showTimer: "hidden-internal",
    showProgressBar: "mcq-counter",
    chatFeedVisibility: "cue-card-only",
    allowBackToHome: false,
    colourTheme: "default",
    modePillKey: "quiz",
    dismissOnEnd: "home",
    stallChipBehaviour: "none",
  },
  "results-readout": {
    allowModuleSwitch: false,
    showTimer: "none",
    showProgressBar: "none",
    chatFeedVisibility: "none",
    allowBackToHome: false,
    colourTheme: "brand",
    modePillKey: null,
    dismissOnEnd: "next-module",
    stallChipBehaviour: "none",
  },
  "intake-wizard": {
    allowModuleSwitch: false,
    showTimer: "none",
    showProgressBar: "none",
    chatFeedVisibility: "full",
    allowBackToHome: true,
    colourTheme: "default",
    modePillKey: null,
    dismissOnEnd: "home",
    stallChipBehaviour: "none",
  },
};

// ────────────────────────────────────────────────────────────────────
// Selection rules — declarative data table.
//
// Each rule is checked in array order; the FIRST `match` that returns
// true wins. The default (no rule matches) is `chat-feed`. Rules ARE
// the policy — no nested if-else, no scattered branching. When the
// rules change, you change this table; when a new shell variant lands,
// you add a row.
//
// Rule shape:
//   - `id`     — diagnostic / debug stamp returned in the result.
//   - `when`   — pure predicate over the input shape.
//   - `shell`  — which `LearnerShellKind` to mount on a hit.
//
// Rule ORDER matters. `intake-wizard` is checked FIRST because the
// ENROLLMENT session kind structurally overrides any module mode —
// an enrolling learner is in the intake flow, not in an exam shell.
// ────────────────────────────────────────────────────────────────────

interface SelectionInput {
  session: { kind: SessionKindString; sessionTerminal: boolean };
  module: { mode: AuthoredModuleMode } | null;
}

interface SelectionRule {
  /** Stable ID for debug + telemetry. */
  id: string;
  /** Pure predicate over the resolver input. */
  when: (input: SelectionInput) => boolean;
  /** Shell kind to mount when the predicate holds. */
  shell: LearnerShellKind;
}

export const SHELL_SELECTION_RULES: readonly SelectionRule[] = [
  {
    // ENROLLMENT session is the intake flow; module mode is ignored
    // because the learner isn't yet enrolled in a course (the intake
    // wizard captures the enrolment). Per epic #2163 locked decision.
    id: "enrollment-overrides-module-mode",
    when: ({ session }) => session.kind === "ENROLLMENT",
    shell: "intake-wizard",
  },
  {
    // Examiner-mode TERMINAL session — the in-flight assessment runs
    // to completion under the exam shell. Mirrors the existing
    // `shouldMountExamModeShell` gate at components/sim/ExamModeShell.tsx.
    id: "examiner-terminal-exam-shell",
    when: ({ session, module }) =>
      module?.mode === "examiner" && session.sessionTerminal === true,
    shell: "exam",
  },
  {
    // Mock-exam TERMINAL session — same SHELL FRAME as examiner with
    // a different capability theme (modePillKey = "mock-exam" vs
    // "mock-exam" via override below). Both modes mount the `exam`
    // shell; the capabilities map carries the per-mode visual
    // distinction.
    id: "mock-exam-terminal-exam-shell",
    when: ({ session, module }) =>
      module?.mode === "mock-exam" && session.sessionTerminal === true,
    shell: "exam",
  },
  {
    // Quiz mode — MCQ rounds shell. Sessions are short and per-round;
    // terminal flag isn't load-bearing because every round is
    // self-contained.
    id: "quiz-mcq-rounds-shell",
    when: ({ module }) => module?.mode === "quiz",
    shell: "mcq-rounds",
  },
];

/** Default shell when no rule matches — the chat-feed baseline. */
const DEFAULT_SHELL: LearnerShellKind = "chat-feed";

// ────────────────────────────────────────────────────────────────────
// Capability overrides — keyed declaratively, not via if-else.
//
// When two distinct inputs SHARE a `shellKind` but should differ in
// some capability (e.g. exam-shell rendering for `examiner` vs
// `mock-exam`), declare the override here. The shape is intentionally
// narrow: each override row identifies (a) the module.mode trigger,
// (b) the partial capability patch.
//
// Today's only override: the `exam` shell's `modePillKey` differs
// between `examiner` (board-chair frame) and `mock-exam` (full-mock
// frame). Both still mount the dark-themed exam shell; only the pill
// label / icon resource differs.
// ────────────────────────────────────────────────────────────────────

type CapabilityOverride = {
  shell: LearnerShellKind;
  forMode: AuthoredModuleMode;
  patch: Partial<LearnerShellCapabilities>;
};

export const SHELL_CAPABILITY_OVERRIDES: readonly CapabilityOverride[] = [
  // examiner-mode exam shell — keep SHELL_DEFAULTS.exam.modePillKey
  // explicit (it already declares "mock-exam"; override patches it to
  // "examiner" for the board-chair / single-examiner frame).
  {
    shell: "exam",
    forMode: "examiner",
    patch: { modePillKey: "examiner" },
  },
  // mock-exam-mode exam shell — uses SHELL_DEFAULTS.exam unchanged.
  // Declared explicitly so the table is exhaustive across the modes
  // that share the `exam` shell. A future refactor renaming the
  // resource key only edits this table, not the resolver body.
  {
    shell: "exam",
    forMode: "mock-exam",
    patch: { modePillKey: "mock-exam" },
  },
];

// ────────────────────────────────────────────────────────────────────
// Resolver
// ────────────────────────────────────────────────────────────────────

export interface ResolveLearnerShellArgs {
  /**
   * The active session's kind + terminality. `sessionTerminal === true`
   * for the FINAL session of a sequence (e.g. the closing exam in a
   * curriculum); the exam shell only mounts on terminal examiner /
   * mock-exam sessions.
   */
  session: { kind: SessionKindString; sessionTerminal: boolean };
  /**
   * The module the session is currently against. `null` when no
   * module is bound (e.g. intake-wizard sessions, results-readout
   * sessions that ride above the module surface).
   */
  module: { mode: AuthoredModuleMode } | null;
}

export interface ResolveLearnerShellResult {
  /** Which shell variant to mount. */
  shellKind: LearnerShellKind;
  /** Frozen capability map for the chosen shell — SHELL_DEFAULTS merged with any input-specific override. */
  capabilities: LearnerShellCapabilities;
  /** Diagnostic — which rule fired (or `"default-chat-feed"`). */
  matchedRuleId: string;
}

/**
 * Pure selection function. Given a session + module shape, return
 * the shell to mount + its resolved capability map.
 *
 * No DB access. No side effects. Safe to call at render time, at
 * session-start time, in tests, and in tooling.
 */
export function resolveLearnerShell(
  args: ResolveLearnerShellArgs,
): ResolveLearnerShellResult {
  // Walk the rules table; first hit wins.
  let matched: SelectionRule | null = null;
  for (const rule of SHELL_SELECTION_RULES) {
    if (rule.when(args)) {
      matched = rule;
      break;
    }
  }
  const shellKind = matched?.shell ?? DEFAULT_SHELL;
  const matchedRuleId = matched?.id ?? "default-chat-feed";

  // Start from canonical SHELL_DEFAULTS for the chosen kind.
  const baseDefaults = SHELL_DEFAULTS[shellKind];

  // Apply the matching capability override (if any) — keyed on
  // (shellKind, module.mode) so the override table can declare
  // per-mode capability variants without growing the SHELL_DEFAULTS
  // surface.
  const modeForOverride: AuthoredModuleMode | null = args.module?.mode ?? null;
  const override =
    modeForOverride === null
      ? null
      : (SHELL_CAPABILITY_OVERRIDES.find(
          (o) => o.shell === shellKind && o.forMode === modeForOverride,
        ) ?? null);

  const capabilities: LearnerShellCapabilities = override
    ? { ...baseDefaults, ...override.patch }
    : { ...baseDefaults };

  return { shellKind, capabilities, matchedRuleId };
}
