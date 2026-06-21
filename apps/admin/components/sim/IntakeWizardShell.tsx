"use client";

/**
 * IntakeWizardShell — typed shell for the ENROLLMENT learner surface.
 *
 * W7 of `memory/handoff_lattice_all_settings_to_ui_2026_06_21.md`
 * (story #2185 U13 — last gap in shell-coverage). Closes the
 * `intake-wizard` LearnerShellKind row to `covered` per
 * `.claude/rules/shell-coverage.md`.
 *
 * **What this shell IS.** A capability-driven structural frame around
 * the enrolment intake experience. The `resolveLearnerShell({session,
 * module})` resolver returns `shellKind = "intake-wizard"` whenever
 * `session.kind === "ENROLLMENT"` (highest-priority selection rule per
 * `lib/voice/resolve-learner-shell.ts::SHELL_SELECTION_RULES`). The
 * shell renders the canonical capability frame (`SHELL_DEFAULTS["intake-wizard"]`)
 * and exposes a `children` slot for the host page to mount the actual
 * intake content (goal-setting / about-you / AI-intro / knowledge-check
 * stops per `JourneyStop[]` config).
 *
 * **What this shell IS NOT.** It is not a re-implementation of the
 * full FOH intake flow. The production intake lives in the FOH
 * workspace under `apps/foh/app/join/[token]/...` and the existing
 * intake bootstrap under `apps/admin/app/intake/...`. This shell is
 * the typed Lattice primitive that wraps either surface so the host
 * can mount it through the canonical resolver result rather than
 * branching on `session.kind === "ENROLLMENT"` in every consumer.
 *
 * **Why a typed shell at all.** Pre-W7 the intake surface was the
 * implicit chat-feed fallback in `SimChat.tsx`'s dispatch switch:
 * the `intake-wizard` branch fired `learner_shell.fallback_unwired`
 * AppLog. After W7 the resolver result has a real consumer and the
 * fallback path is no longer load-bearing. New host surfaces that
 * need to mount the intake flow look up the shell via the resolver
 * AND wrap their intake content with this shell — they don't need to
 * understand "intake = chat-feed default" any more.
 *
 * **Capabilities consumed.** `SHELL_DEFAULTS["intake-wizard"]` (frozen
 * per `lib/types/json-fields.ts`):
 *   - `allowModuleSwitch: false`     — intake is its own flow; no
 *     module-picker overlay.
 *   - `allowBackToHome: true`        — learner can dismiss back to the
 *     entry point at any time.
 *   - `showTimer: "none"`            — no countdown.
 *   - `showProgressBar: "none"`      — wizard owns its own progress UX.
 *   - `chatFeedVisibility: "full"`   — chat-style stops render their
 *     full feed.
 *   - `colourTheme: "default"`       — light theme.
 *   - `modePillKey: null`            — no mode pill (intake is not a
 *     module-mode surface).
 *   - `dismissOnEnd: "home"`         — completed enrolment routes the
 *     learner home.
 *   - `stallChipBehaviour: "none"`   — wizard owns its own stall UX.
 *
 * **Internal-name discipline.** Per `.claude/rules/learner-ui-leak-coverage.md`
 * the shell-kind literal `"intake-wizard"` is INTERNAL — it never
 * reaches the learner UI as a static string. The learner experiences
 * the capability EFFECTS (no timer, no mode pill, dismiss-on-end
 * routing) — never reads "intake-wizard" anywhere on screen.
 *
 * **Coverage.** Paired vitest
 * `tests/components/sim/IntakeWizardShell.test.tsx` asserts every
 * capability flag in `SHELL_DEFAULTS["intake-wizard"]` flows through
 * to a `data-*` attribute (capability override regression),
 * `learner-shells.test.tsx` covers the cross-shell capability matrix,
 * and `shell-coverage.test.ts::EXPECTED_GAP_COUNT` drops from 1 → 0.
 */

import {
  SHELL_DEFAULTS,
  type LearnerShellCapabilities,
} from "@/lib/types/json-fields";
import "./learner-shells.css";

interface IntakeWizardShellProps {
  /** Capability frame. Defaults to `SHELL_DEFAULTS["intake-wizard"]` so
   *  the shell renders the canonical intake frame out of the box. A
   *  course-level Playbook patch (epic #2163 S5/S7) can DISABLE a
   *  default (e.g. flip `allowBackToHome` to false for a strict-intake
   *  flow); enabling new affordances is forbidden per the
   *  `.claude/rules/learner-shell-selection.md` policy. */
  capabilities?: LearnerShellCapabilities;
  /** Banner-level message rendered at the top of the wizard frame.
   *  Optional — typically the host page renders its own wizard chrome
   *  and leaves this null. Pass a string when the host wants the
   *  shell to display a top-banner welcome / disclaimer / consent
   *  acknowledgement. Sourced from props (operator-supplied prose),
   *  never from an internal label per the learner-ui-leak rule. */
  banner?: string | null;
  /** Optional dismiss handler. When supplied AND
   *  `capabilities.allowBackToHome === true`, the shell renders an
   *  ARIA-labelled close affordance the learner can use to exit the
   *  intake flow. */
  onDismiss?: () => void;
  /** The actual intake content — typically a wizard stop list
   *  (`JourneyStop[]`) rendered by the host page, or the existing
   *  IntakeCoCPanel / EnrollmentChat surface. */
  children?: React.ReactNode;
}

export function IntakeWizardShell({
  capabilities = SHELL_DEFAULTS["intake-wizard"],
  banner = null,
  onDismiss,
  children,
}: IntakeWizardShellProps) {
  const showDismiss = capabilities.allowBackToHome && Boolean(onDismiss);
  return (
    <section
      className="hf-intake-wizard-shell"
      data-testid="hf-intake-wizard-shell"
      data-shell-kind="intake-wizard"
      data-colour-theme={capabilities.colourTheme}
      data-mode-pill={capabilities.modePillKey ?? ""}
      data-chat-feed-visibility={capabilities.chatFeedVisibility}
      data-show-timer={capabilities.showTimer}
      data-show-progress-bar={capabilities.showProgressBar}
      data-allow-module-switch={String(capabilities.allowModuleSwitch)}
      data-allow-back-to-home={String(capabilities.allowBackToHome)}
      data-dismiss-on-end={capabilities.dismissOnEnd}
      data-stall-chip-behaviour={capabilities.stallChipBehaviour}
      aria-label="Enrolment intake"
      role="region"
    >
      {banner ? (
        <div
          className="hf-intake-shell-banner"
          data-testid="hf-intake-shell-banner"
          role="status"
        >
          {banner}
        </div>
      ) : null}
      {showDismiss ? (
        <button
          type="button"
          className="hf-intake-shell-dismiss"
          data-testid="hf-intake-shell-dismiss"
          onClick={onDismiss}
          aria-label="Exit intake and return home"
        >
          Exit
        </button>
      ) : null}
      <div className="hf-intake-shell-body" data-testid="hf-intake-shell-body">
        {children}
      </div>
    </section>
  );
}
