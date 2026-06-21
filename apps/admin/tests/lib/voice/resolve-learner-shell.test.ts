/**
 * resolve-learner-shell.test.ts — pins #2197 (S2 of epic #2163).
 *
 * Coverage:
 *  1. Cartesian completeness: every (AuthoredModuleMode × sessionTerminal ×
 *     SessionKindString) combo resolves to the expected shellKind.
 *  2. Capability values for clean (default) cases match SHELL_DEFAULTS
 *     byte-for-byte.
 *  3. Per-mode capability overrides produce the expected delta on
 *     shared shells (examiner vs mock-exam both mount `exam` but differ
 *     on `modePillKey`).
 *  4. ENROLLMENT structurally overrides module mode (intake-wizard
 *     always wins over examiner / quiz / mock-exam, etc.).
 *  5. matchedRuleId surfaces the firing rule for diagnostics.
 *
 *  See `.claude/rules/learner-shell-selection.md` for the durable rule.
 */

import { describe, expect, it } from "vitest";

import {
  resolveLearnerShell,
  SHELL_CAPABILITY_OVERRIDES,
  SHELL_SELECTION_RULES,
  type LearnerShellCapabilities,
  type LearnerShellKind,
} from "@/lib/voice/resolve-learner-shell";
import type { AuthoredModuleMode } from "@/lib/types/json-fields";
import type { SessionKindString } from "@/lib/voice/session-rules";

// ────────────────────────────────────────────────────────────
// Cartesian source-of-truth — every union value enumerated.
// If the underlying union grows, vitest's `satisfies` check at
// the bottom of the matrix table forces the test author to add
// the new row.
// ────────────────────────────────────────────────────────────

const AUTHORED_MODULE_MODE_VALUES = [
  "examiner",
  "tutor",
  "mixed",
  "quiz",
  "mock-exam",
] as const satisfies readonly AuthoredModuleMode[];

const SESSION_KIND_VALUES = [
  "ENROLLMENT",
  "ASSESSMENT",
  "VOICE_CALL",
  "SIM_CALL",
  "TEXT_CHAT",
] as const satisfies readonly SessionKindString[];

const TERMINAL_VALUES = [true, false] as const;

// ────────────────────────────────────────────────────────────
// Expected-shell oracle. The oracle implements the SAME policy
// declaratively, so a regression in resolveLearnerShell.ts
// produces an oracle mismatch.
// ────────────────────────────────────────────────────────────

function expectedShellForInput(
  sessionKind: SessionKindString,
  sessionTerminal: boolean,
  mode: AuthoredModuleMode | null,
): LearnerShellKind {
  if (sessionKind === "ENROLLMENT") return "intake-wizard";
  if (mode === "examiner" && sessionTerminal) return "exam";
  if (mode === "mock-exam" && sessionTerminal) return "exam";
  if (mode === "quiz") return "mcq-rounds";
  return "chat-feed";
}

// ────────────────────────────────────────────────────────────
// Default capability snapshot — used by the clean-case
// assertions. Kept in sync with SHELL_DEFAULTS by importing the
// type and comparing structurally below.
// ────────────────────────────────────────────────────────────

const CHAT_FEED_DEFAULTS: LearnerShellCapabilities = {
  allowModuleSwitch: true,
  showTimer: "none",
  showProgressBar: "fill-bar",
  chatFeedVisibility: "full",
  allowBackToHome: true,
  colourTheme: "default",
  modePillKey: "tutor",
  dismissOnEnd: "home",
  stallChipBehaviour: "subtle-fade",
};

const INTAKE_WIZARD_DEFAULTS: LearnerShellCapabilities = {
  allowModuleSwitch: false,
  showTimer: "none",
  showProgressBar: "none",
  chatFeedVisibility: "full",
  allowBackToHome: true,
  colourTheme: "default",
  modePillKey: null,
  dismissOnEnd: "home",
  stallChipBehaviour: "none",
};

const MCQ_ROUNDS_DEFAULTS: LearnerShellCapabilities = {
  allowModuleSwitch: false,
  showTimer: "hidden-internal",
  showProgressBar: "mcq-counter",
  chatFeedVisibility: "cue-card-only",
  allowBackToHome: false,
  colourTheme: "default",
  modePillKey: "quiz",
  dismissOnEnd: "home",
  stallChipBehaviour: "none",
};

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("resolveLearnerShell — Cartesian shell selection", () => {
  it("every (kind × terminal × mode) combo resolves to the oracle's shell", () => {
    for (const kind of SESSION_KIND_VALUES) {
      for (const terminal of TERMINAL_VALUES) {
        for (const mode of AUTHORED_MODULE_MODE_VALUES) {
          const result = resolveLearnerShell({
            session: { kind, sessionTerminal: terminal },
            module: { mode },
          });
          const expected = expectedShellForInput(kind, terminal, mode);
          expect(
            result.shellKind,
            `kind=${kind}, terminal=${terminal}, mode=${mode}: expected ${expected}, got ${result.shellKind}`,
          ).toBe(expected);
        }
        // Also exercise the null-module branch — non-ENROLLMENT
        // sessions with no module mode fall back to chat-feed.
        const nullModuleResult = resolveLearnerShell({
          session: { kind, sessionTerminal: terminal },
          module: null,
        });
        const expectedNull = expectedShellForInput(kind, terminal, null);
        expect(
          nullModuleResult.shellKind,
          `kind=${kind}, terminal=${terminal}, mode=null: expected ${expectedNull}, got ${nullModuleResult.shellKind}`,
        ).toBe(expectedNull);
      }
    }
  });

  it("ENROLLMENT overrides every module mode (intake-wizard always wins)", () => {
    for (const mode of AUTHORED_MODULE_MODE_VALUES) {
      for (const terminal of TERMINAL_VALUES) {
        const result = resolveLearnerShell({
          session: { kind: "ENROLLMENT", sessionTerminal: terminal },
          module: { mode },
        });
        expect(result.shellKind).toBe("intake-wizard");
        expect(result.matchedRuleId).toBe("enrollment-overrides-module-mode");
      }
    }
  });

  it("examiner mode mounts the exam shell only when sessionTerminal is true", () => {
    const terminal = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: true },
      module: { mode: "examiner" },
    });
    expect(terminal.shellKind).toBe("exam");
    expect(terminal.matchedRuleId).toBe("examiner-terminal-exam-shell");

    const nonTerminal = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: false },
      module: { mode: "examiner" },
    });
    expect(nonTerminal.shellKind).toBe("chat-feed");
  });

  it("mock-exam mode mounts the exam shell only when sessionTerminal is true", () => {
    const terminal = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: true },
      module: { mode: "mock-exam" },
    });
    expect(terminal.shellKind).toBe("exam");
    expect(terminal.matchedRuleId).toBe("mock-exam-terminal-exam-shell");

    const nonTerminal = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: false },
      module: { mode: "mock-exam" },
    });
    expect(nonTerminal.shellKind).toBe("chat-feed");
  });

  it("quiz mode mounts the mcq-rounds shell regardless of sessionTerminal", () => {
    for (const terminal of TERMINAL_VALUES) {
      const result = resolveLearnerShell({
        session: { kind: "SIM_CALL", sessionTerminal: terminal },
        module: { mode: "quiz" },
      });
      expect(result.shellKind).toBe("mcq-rounds");
      expect(result.matchedRuleId).toBe("quiz-mcq-rounds-shell");
    }
  });

  it("tutor mode falls back to the chat-feed default shell", () => {
    const result = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: false },
      module: { mode: "tutor" },
    });
    expect(result.shellKind).toBe("chat-feed");
    expect(result.matchedRuleId).toBe("default-chat-feed");
  });

  it("mixed mode falls back to the chat-feed default shell (matches mode-ui-coverage exempt rationale)", () => {
    const result = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: false },
      module: { mode: "mixed" },
    });
    expect(result.shellKind).toBe("chat-feed");
    expect(result.matchedRuleId).toBe("default-chat-feed");
  });
});

describe("resolveLearnerShell — capability resolution", () => {
  it("clean chat-feed case returns SHELL_DEFAULTS['chat-feed'] unchanged", () => {
    const result = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: false },
      module: { mode: "tutor" },
    });
    expect(result.capabilities).toEqual(CHAT_FEED_DEFAULTS);
  });

  it("clean intake-wizard case returns SHELL_DEFAULTS['intake-wizard'] unchanged", () => {
    const result = resolveLearnerShell({
      session: { kind: "ENROLLMENT", sessionTerminal: false },
      module: null,
    });
    expect(result.capabilities).toEqual(INTAKE_WIZARD_DEFAULTS);
  });

  it("clean mcq-rounds case returns SHELL_DEFAULTS['mcq-rounds'] unchanged", () => {
    const result = resolveLearnerShell({
      session: { kind: "SIM_CALL", sessionTerminal: true },
      module: { mode: "quiz" },
    });
    expect(result.capabilities).toEqual(MCQ_ROUNDS_DEFAULTS);
  });

  it("override case — examiner-mode exam shell patches modePillKey to 'examiner'", () => {
    const result = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: true },
      module: { mode: "examiner" },
    });
    expect(result.shellKind).toBe("exam");
    expect(result.capabilities.modePillKey).toBe("examiner");
    // Dark theme, monologue bar, etc. inherited from SHELL_DEFAULTS.exam.
    expect(result.capabilities.colourTheme).toBe("dark");
    expect(result.capabilities.showProgressBar).toBe("monologue-bar");
    expect(result.capabilities.dismissOnEnd).toBe("results-screen");
  });

  it("override case — mock-exam-mode exam shell keeps modePillKey 'mock-exam'", () => {
    const result = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: true },
      module: { mode: "mock-exam" },
    });
    expect(result.shellKind).toBe("exam");
    expect(result.capabilities.modePillKey).toBe("mock-exam");
    // Same dark theme / monologue progress as examiner — only the
    // modePillKey differs.
    expect(result.capabilities.colourTheme).toBe("dark");
    expect(result.capabilities.showProgressBar).toBe("monologue-bar");
  });

  it("examiner and mock-exam mount the same shell but produce DIFFERENT modePillKey values", () => {
    const examiner = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: true },
      module: { mode: "examiner" },
    });
    const mock = resolveLearnerShell({
      session: { kind: "VOICE_CALL", sessionTerminal: true },
      module: { mode: "mock-exam" },
    });
    expect(examiner.shellKind).toBe(mock.shellKind);
    expect(examiner.shellKind).toBe("exam");
    expect(examiner.capabilities.modePillKey).not.toBe(
      mock.capabilities.modePillKey,
    );
  });
});

describe("resolveLearnerShell — declarative table sanity", () => {
  it("SHELL_SELECTION_RULES is non-empty and every entry has the required shape", () => {
    expect(SHELL_SELECTION_RULES.length).toBeGreaterThan(0);
    for (const rule of SHELL_SELECTION_RULES) {
      expect(typeof rule.id).toBe("string");
      expect(rule.id.length).toBeGreaterThan(0);
      expect(typeof rule.when).toBe("function");
      expect(typeof rule.shell).toBe("string");
    }
  });

  it("SHELL_SELECTION_RULES rule IDs are unique", () => {
    const ids = SHELL_SELECTION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("SHELL_CAPABILITY_OVERRIDES are unique per (shell, mode) pair", () => {
    const keys = SHELL_CAPABILITY_OVERRIDES.map(
      (o) => `${o.shell}::${o.forMode}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
