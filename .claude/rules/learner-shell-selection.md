# LearnerShell selection — declarative, course-agnostic

> Selecting WHICH learner shell to mount (chat-feed / exam / mcq-rounds
> / results-readout / intake-wizard) MUST go through the pure function
> `lib/voice/resolve-learner-shell.ts::resolveLearnerShell({session, module})`.
> Selection rules live as a declarative const data table in the same
> file — never as scattered if-else branches across UI components.
> Per-course customisation of capabilities is forbidden in code;
> course-level patches live in `Playbook.config.learnerShell` (S5/S7
> of epic #2163) and are read at compose / render time.
>
> Sibling 4th-layer typed primitives that ship the same pattern:
> [`mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md)
> (mode → runtime spec selection — SessionFocus's
> `session-focus-policy` runner is the canonical reference),
> [`mode-ui-coverage.md`](./mode-ui-coverage.md) (mode → 3-axis UI
> consumer presence),
> [`course-assessment-plan-coverage.md`](./course-assessment-plan-coverage.md)
> (CourseAssessmentPlan declarative per-course plan + sampling engine).
>
> Story: [#2197](https://github.com/WANDERCOLTD/HF/issues/2197) (S2 of
> epic [#2163](https://github.com/WANDERCOLTD/HF/issues/2163) — LearnerShell as
> typed Lattice primitive). Part of the Coverage pillar of HF Lattice.

## Rule

When you write code that decides WHICH learner shell to mount for a
given session + module:

1. **Call `resolveLearnerShell({ session, module })`** —
   pure function in `lib/voice/resolve-learner-shell.ts`. Returns
   `{ shellKind, capabilities, matchedRuleId }`.
2. **Do NOT branch on `module.mode` / `session.kind` inside shell
   components.** The mount-point (and any "should I render the
   exam shell?" gate) reads `shellKind` from the resolver result.
3. **Do NOT hand-roll a parallel selection rule** in a course-specific
   surface (e.g. a CIO/CTO-specific shell mount). If a new course needs
   a new shell variant, extend `SHELL_SELECTION_RULES` AND
   `SHELL_DEFAULTS` (in `lib/types/json-fields.ts` per PR #2173) AND
   ship the consumer component — same PR, three-file sweep.
4. **Capability overrides** live in `SHELL_CAPABILITY_OVERRIDES` keyed
   on `(shellKind, module.mode)` — never as if-else in the shell
   component. When two distinct modes mount the same shell but differ
   in one capability (e.g. examiner vs mock-exam differ in
   `modePillKey`), the difference lives in the override table.

## Why this exists

Pre-S2, shell selection looked like this:

```ts
// components/sim/ExamModeShell.tsx
export function shouldMountExamModeShell(
  module: Pick<AuthoredModule, "mode">,
  sessionTerminal: boolean,
): boolean {
  return module.mode === "examiner" && sessionTerminal === true;
}

// Every other shell branch was implicit — quiz had no consumer, the
// chat-feed shell was the silent default.
```

Three structural problems with that shape:

1. **Selection scattered across UI files.** Adding a new shell variant
   meant searching every UI surface for "where does the default-feed
   fall through?" + adding a new gate.
2. **No central question to answer.** "Given THIS (session, module),
   which shell mounts?" had no single function to call. Operators and
   bots both had to read the procedural code to know.
3. **Mode-UI coverage gaps invisible.** The 2026-06-21 audit found
   `quiz.learnerUI` and `mock-exam.learnerUI` shipped WITHOUT learner UI
   consumers — they only had compose-directive (teaching) +
   admin-badge (adminUI) wiring. Learners experienced identical
   SimChat sessions for `tutor` / `mixed` / `quiz` / `mock-exam`. Per
   `mode-ui-coverage.md`, this is the producer-only failure class.

S2 centralises into one pure function with a declarative rule table.
S3 (sibling agent's component refactor) lands the consumer side —
ExamModeShell reads `shellKind` instead of branching on `.mode`,
SimChat reads `shellKind === "mcq-rounds"` and mounts the cue-card
view, and so on.

## Selection rules (today, post-S2)

The rules table at the top of `resolve-learner-shell.ts`. Reading the
data table IS reading the policy:

| Rule ID | When | Shell |
|---|---|---|
| `enrollment-overrides-module-mode` | `session.kind === "ENROLLMENT"` | `intake-wizard` |
| `examiner-terminal-exam-shell` | `module.mode === "examiner"` AND `session.sessionTerminal === true` | `exam` |
| `mock-exam-terminal-exam-shell` | `module.mode === "mock-exam"` AND `session.sessionTerminal === true` | `exam` |
| `quiz-mcq-rounds-shell` | `module.mode === "quiz"` | `mcq-rounds` |
| (default) | no rule fires | `chat-feed` |

`ENROLLMENT` is checked FIRST because the intake flow structurally
overrides the module surface — an enrolling learner is not yet
enrolled in any course's module.

## Capability overrides (today)

| Shell | For mode | Patch |
|---|---|---|
| `exam` | `examiner` | `{ modePillKey: "examiner" }` (board-chair frame) |
| `exam` | `mock-exam` | `{ modePillKey: "mock-exam" }` (full-mock frame; matches SHELL_DEFAULTS.exam) |

`examiner` and `mock-exam` both mount the dark-themed `exam` shell;
the override table distinguishes the pill / label / icon resource
key without growing the SHELL_DEFAULTS surface.

The `mock-exam` override is declared even though its patch matches
the default — declarative completeness across the modes that share
the `exam` shell. A future refactor renaming the pill resource only
edits this table.

## When adding a new shell variant

Author checklist (same PR):

1. **Extend `LearnerShellKind`** in `lib/types/json-fields.ts` (and
   the test stub in `resolve-learner-shell.ts` until PR #2173 lands).
2. **Add a row to `SHELL_DEFAULTS`** (PR #2173 substrate) — every
   capability field MUST be set; no implicit fallback.
3. **Add a row to `SHELL_SELECTION_RULES`** in
   `resolve-learner-shell.ts` — pure predicate + shell kind.
4. **Wire the consumer** in `components/sim/**` or
   `apps/foh/components/**` — the shell component reads
   `shellKind` and renders accordingly. The mount-point at the
   page-level reads the resolver result and mounts the correct shell.
5. **Update `tests/lib/voice/resolve-learner-shell.test.ts`** — extend
   the Cartesian matrix oracle.
6. **Update `tests/lib/sim-chat/mode-ui-coverage.test.ts`** — if the
   new shell closes a learner-UI gap, drop `EXPECTED_GAP_COUNT` by 1.

## When adding capability overrides

Author checklist (same PR):

1. Add a row to `SHELL_CAPABILITY_OVERRIDES` in
   `resolve-learner-shell.ts` with `{ shell, forMode, patch }`.
2. Add a vitest case in `tests/lib/voice/resolve-learner-shell.test.ts`
   that asserts the override's patched capability is observed.
3. Document the per-mode visual / behavioural distinction in this
   rule's "Capability overrides" table above.

## Why per-course customisation is gated

Per epic #2163 locked decision 8: **capabilities are HF-canonical**,
not customer-tunable. Per-course patches live in
`Playbook.config.learnerShell` (S5/S7 of epic #2163) and can ONLY
DISABLE a default — not enable an arbitrary new affordance.

The rationale: cross-course drift on shell capabilities (a course
flipping `allowBackToHome` to true while another's exam shell stays
locked) defeats the SHELL_DEFAULTS invariant the
`learner-ui-leak-coverage.md` Coverage gate depends on. A
course-level override that DISABLES is fine (a course can opt OUT
of a default); a course-level override that ENABLES a new
affordance breaks the gate.

## Mode-UI coverage ratchet status

`mode-ui-coverage.test.ts::EXPECTED_GAP_COUNT` remains at **2**
post-S2 — the gaps (`quiz.learnerUI` + `mock-exam.learnerUI`) stay
open until S3 (sibling agent's component refactor) lands. The
gate's matcher scans literal `mode === "<value>"` patterns under
`components/sim/`, `app/x/student/`, `apps/foh/app/`,
`apps/foh/components/`. The S2 function lives in `lib/voice/` —
outside those dirs — so writing the selection function does not
itself flip the gaps to `covered`. S3 closes both gaps when
`ExamModeShell` and the SimChat shell wrapper start reading
`shellKind` against `.mode === "quiz"` / `.mode === "mock-exam"`.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `lib/voice/resolve-learner-shell.ts` (this PR) | Pure function + declarative tables | Scattered selection logic; per-course shell-mount drift |
| `tests/lib/voice/resolve-learner-shell.test.ts` (this PR) | Cartesian completeness + capability assertions | Resolver regressions; override-table drift |
| `tests/lib/sim-chat/mode-ui-coverage.test.ts` (#2144) | 3-axis mode → UI consumer ratchet | Producer-only mode literals (today: `quiz` + `mock-exam` learner UI gaps; closes when S3 wires the consumers) |
| `tests/lib/types/learner-shell-types.test.ts` (PR #2173) | Per-shell capability completeness | Missing capability fields in SHELL_DEFAULTS |
| `.claude/rules/mode-spec-selection-coverage.md` | Runtime spec-selection sibling | Mode-vs-spec-selection drift on the pipeline runtime side |
| `.claude/rules/lattice-survey.md` | Pre-coding survey | Scattered shell-mount branches reaching code review |

## When NOT to apply

- Shell components themselves (e.g. `ExamModeShell.tsx`,
  `SimChat.tsx`) DO branch on `shellKind` returned by the resolver —
  the rule applies to the SELECTION decision, not to consuming the
  selected shellKind.
- Test fixtures + storybook examples that synthesise a `shellKind`
  directly to exercise rendering — no selection happens; the rule
  doesn't apply.
- Operator-facing admin badges (`AuthoredModulesPanel`,
  `LearnerModulePicker`) that ALREADY branch on `.mode` for badge /
  pill rendering — they're the `adminUI` axis from
  `mode-ui-coverage.md`, not the `learnerUI` axis this rule covers.

## Related

- [`apps/admin/lib/voice/resolve-learner-shell.ts`](../../apps/admin/lib/voice/resolve-learner-shell.ts) — the function
- [`apps/admin/tests/lib/voice/resolve-learner-shell.test.ts`](../../apps/admin/tests/lib/voice/resolve-learner-shell.test.ts) — the Cartesian test
- [`apps/admin/lib/types/json-fields.ts`](../../apps/admin/lib/types/json-fields.ts) — `LearnerShellKind` + `LearnerShellCapabilities` + `SHELL_DEFAULTS` (PR #2173, S1 of epic #2163)
- [`.claude/rules/mode-ui-coverage.md`](./mode-ui-coverage.md) — sibling 3-axis Coverage gate
- [`.claude/rules/mode-spec-selection-coverage.md`](./mode-spec-selection-coverage.md) — sibling runtime spec-selection Coverage
- [`.claude/rules/course-assessment-plan-coverage.md`](./course-assessment-plan-coverage.md) — sibling 4th-layer primitive
- Epic [#2163](https://github.com/WANDERCOLTD/HF/issues/2163) — LearnerShell as typed Lattice primitive
- PR #2173 — S1 substrate (types + defaults)
- Story [#2197](https://github.com/WANDERCOLTD/HF/issues/2197) — this rule (S2)
