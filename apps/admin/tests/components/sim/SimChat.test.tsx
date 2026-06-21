/**
 * SimChat dispatch tests (#2206 — W1+W2+W3 of epic #2163 LearnerShell).
 *
 * Pins the canonical shell-dispatch wiring SimChat ships:
 *
 *   1. SimChat calls `resolveLearnerShell({ session, module })` instead
 *      of hand-rolling `module.mode === "X"` branches. The resolver IS
 *      the policy per `.claude/rules/learner-shell-selection.md` —
 *      sibling rule pins this discipline.
 *   2. SimChat dispatches on the resolver's `shellKind` to mount
 *      ChatFeedShell / ExamModeShell / MCQRoundsShell.
 *   3. Unwired shell kinds (`results-readout`, `intake-wizard` —
 *      epic #2163 S4-S7) fall back to ChatFeedShell AND fire the
 *      `learner_shell.fallback_unwired` AppLog so the silent-degrade
 *      trap doesn't catch the regression. Per the parent rule
 *      `.claude/rules/data-presence-coverage.md`: NO SILENT FALLBACKS.
 *
 * Why pure-source assertions over render-tests:
 *   SimChat is a 2300-line client component with deeply-stateful hooks
 *   (`useSession`, `useVoiceMode`, `useProviderCall`, `useJourneyChat`,
 *   `useStallDetector`, SSE EventSource handlers, …). Wiring a full
 *   render harness for THIS test would dwarf the test's actual purpose,
 *   which is to pin the dispatch decision IS in place. The resolver's
 *   own Cartesian tests at
 *   `tests/lib/voice/resolve-learner-shell.test.ts` exhaustively pin
 *   `{session, module} → shellKind`. This test asserts SimChat consumes
 *   that resolution correctly, not that the resolver works.
 *
 * Per the parent rule `.claude/rules/learner-shell-selection.md`:
 *   The SELECTION is the resolver's job; SimChat is a CONSUMER. The
 *   structural pin here is "SimChat consumes via the canonical resolver
 *   and dispatches on its returned shellKind". That's exactly what the
 *   source-shape assertions below verify.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ADMIN = resolve(__dirname, "..", "..", "..");
const SIMCHAT_SOURCE_PATH = resolve(
  REPO_ADMIN,
  "components",
  "sim",
  "SimChat.tsx",
);

const SIMCHAT_SOURCE = readFileSync(SIMCHAT_SOURCE_PATH, "utf8");

describe("SimChat canonical shell dispatch (story #2206)", () => {
  it("imports the canonical resolveLearnerShell from lib/voice", () => {
    expect(
      SIMCHAT_SOURCE,
      "SimChat must import resolveLearnerShell from the canonical resolver " +
        "(`@/lib/voice/resolve-learner-shell`) — selection is the resolver's job " +
        "(see `.claude/rules/learner-shell-selection.md`).",
    ).toMatch(
      /import\s*\{[^}]*resolveLearnerShell[^}]*\}\s*from\s*['"]@\/lib\/voice\/resolve-learner-shell['"]/,
    );
  });

  it("imports each consumer shell (ChatFeedShell / ExamModeShell / MCQRoundsShell)", () => {
    // ChatFeedShell — the default.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must import ChatFeedShell — the default consumer.",
    ).toMatch(
      /import\s*\{\s*ChatFeedShell\s*\}\s*from\s*['"]\.\/ChatFeedShell['"]/,
    );
    // ExamModeShell — existing #1745 import preserved.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must import ExamModeShell — the exam/mock-exam consumer.",
    ).toMatch(
      /import\s*\{\s*ExamModeShell\s*\}\s*from\s*['"]\.\/ExamModeShell['"]/,
    );
    // MCQRoundsShell — the quiz consumer.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must import MCQRoundsShell — the quiz consumer.",
    ).toMatch(
      /import\s*\{\s*MCQRoundsShell\s*\}\s*from\s*['"]\.\/MCQRoundsShell['"]/,
    );
  });

  it("calls resolveLearnerShell with the {session, module} shape the resolver expects", () => {
    // The call site MUST pass `session: { kind, sessionTerminal }` and a
    // `module` argument so the resolver can fire its declarative rule table.
    // The exact whitespace doesn't matter; the structural fields do.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must call resolveLearnerShell({session, module}) — the canonical signature.",
    ).toMatch(/resolveLearnerShell\s*\(\s*\{[\s\S]*?session\s*:[\s\S]*?module\s*:/m);
  });

  it("does NOT hand-roll module.mode === 'X' branches at the dispatch site", () => {
    // The dispatch site is the bottom of the component (after `if (isEmbedded)`).
    // Per the rule, SimChat consumes `shellKind` — never branches on .mode at
    // selection time. Hand-rolled `module?.mode === "quiz"` / `=== "examiner"`
    // / `=== "mock-exam"` literals at the dispatch site are forbidden.
    //
    // We DO allow `.mode === "X"` reads in other places (e.g. a future
    // capability override that legitimately reads the mode) — but the
    // resolved shellKind drives the mount decision. To avoid false-
    // positives on unrelated mode literals (audience IDs, etc. — see
    // `mode-ui-coverage.test.ts` for the same exemption shape), this
    // assertion scopes to the dispatch switch by looking for "switch
    // (resolvedShellKind)" — the canonical idiom.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must dispatch via `switch (resolvedShellKind)` (or equivalent " +
        "shellKind-keyed switch) — not via per-mode .mode === 'X' branches.",
    ).toMatch(/switch\s*\(\s*resolvedShellKind\s*\)/);
  });

  it("dispatches to ExamModeShell on shellKind === 'exam'", () => {
    // The 'exam' case wraps the chat-feed content in a ChatFeedShell so
    // the underlying lifecycle (transcript, pipeline, voice) keeps running
    // beneath the position-fixed exam overlay. The structural pin: the
    // ExamModeShell IS mounted inside the 'exam' case (via examShellOverlay).
    // We look for the ExamModeShell mount AND the examShellOverlay reference
    // — the case body composes both.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must mount <ExamModeShell .../> on the 'exam' shellKind path " +
        "(via examShellOverlay or direct mount).",
    ).toMatch(/<ExamModeShell\b[\s\S]*?capabilities/);
    // And the dispatch switch must have an 'exam' case.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must declare a `case 'exam':` branch in the dispatch switch.",
    ).toMatch(/case\s*['"]exam['"]\s*:/);
  });

  it("dispatches to MCQRoundsShell on shellKind === 'mcq-rounds'", () => {
    expect(
      SIMCHAT_SOURCE,
      "SimChat must mount <MCQRoundsShell .../> in the 'mcq-rounds' branch.",
    ).toMatch(/case\s*['"]mcq-rounds['"]\s*:[\s\S]{0,400}<MCQRoundsShell/);
  });

  it("dispatches to ChatFeedShell on shellKind === 'chat-feed' (the default)", () => {
    expect(
      SIMCHAT_SOURCE,
      "SimChat must mount <ChatFeedShell .../> in the 'chat-feed' branch.",
    ).toMatch(/case\s*['"]chat-feed['"]\s*:[\s\S]{0,400}<ChatFeedShell/);
  });

  it("passes capabilities (from resolveLearnerShell result) into the mounted shell", () => {
    // Every mounted shell consumes the capability frame the resolver returns —
    // never re-derives it. This is the structural guarantee that per-mode
    // capability overrides (e.g. examiner vs mock-exam modePillKey) reach
    // the rendered surface.
    expect(
      SIMCHAT_SOURCE,
      "Mounted shells must receive `capabilities={resolvedCapabilities}` " +
        "(or equivalent) from the resolver result.",
    ).toMatch(/capabilities\s*=\s*\{\s*resolvedCapabilities\s*\}/);
  });

  it("has a default branch that falls back to ChatFeedShell for unwired kinds", () => {
    // Defensive default — when the resolver returns `results-readout` /
    // `intake-wizard` (epic #2163 S4-S7) or any future kind, fall back to
    // ChatFeedShell so the learner doesn't see a blank screen.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must have a `default:` case that falls back to ChatFeedShell.",
    ).toMatch(/default\s*:[\s\S]{0,400}<ChatFeedShell/);
  });

  it("fires the `learner_shell.fallback_unwired` AppLog for unwired kinds (NO SILENT FALLBACKS)", () => {
    // Per `.claude/rules/data-presence-coverage.md` — fallbacks MUST be
    // operator-visible. The structural pin: the subject string
    // `learner_shell.fallback_unwired` MUST appear in SimChat source as
    // the fallback signal.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must fire the canonical AppLog subject " +
        "`learner_shell.fallback_unwired` when the resolved shellKind has no " +
        "consumer wired (per NO SILENT FALLBACKS).",
    ).toMatch(/learner_shell\.fallback_unwired/);
  });

  it("does NOT branch on shouldMountExamModeShell as the primary dispatch", () => {
    // The legacy `shouldMountExamModeShell` predicate stays available as a
    // pure helper for the legacy ExamModeShell overlay, but it MUST NOT be
    // the selection mechanism for SimChat. The resolver replaces it.
    //
    // We allow ExamModeShell.tsx itself to still export the function (it
    // does — for back-compat with other call sites). We just check SimChat
    // doesn't call it as the dispatch gate.
    expect(
      SIMCHAT_SOURCE,
      "SimChat must not call `shouldMountExamModeShell(...)` as the dispatch " +
        "decision — selection is the resolver's job.",
    ).not.toMatch(/shouldMountExamModeShell\s*\(/);
  });
});
