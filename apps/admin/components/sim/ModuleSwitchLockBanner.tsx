"use client";

/**
 * ModuleSwitchLockBanner — UX-B B1 (learner affordances pass).
 *
 * Surfaces a learner-readable explanation when the active shell's
 * capability map declares `allowModuleSwitch: false`. Pre-UX-B the
 * picker was silently hidden — operators observed learners losing the
 * affordance with no signal explaining WHY.
 *
 * Capability-driven by design (per `.claude/rules/learner-shell-selection.md`
 * and `.claude/rules/learner-ui-leak-coverage.md`):
 *
 *  - Reads `allowModuleSwitch` + `modePillKey` from the typed frame.
 *  - NO `.mode === "X"` branching. Every per-mode copy difference is
 *    keyed off `modePillKey` (which is itself sourced from the
 *    `SHELL_DEFAULTS` / `SHELL_CAPABILITY_OVERRIDES` tables).
 *  - Copy is learner-safe — uses "assessment" / "mock exam" / "round"
 *    / "session", never criterion names or internal slugs.
 *
 * Dismissable per-mount (local state). Persistence across navigation
 * is a P2 polish — first ship gets local dismiss only.
 *
 * Surface lives ABOVE the dispatched shell in `SimChat.tsx::content`
 * — it's a learner-facing affordance, not a per-shell variant.
 */

import { useState } from "react";
import type { LearnerShellCapabilities } from "@/lib/types/json-fields";

export interface ModuleSwitchLockBannerProps {
  /** Frozen capability map from `resolveLearnerShell(...)`. */
  capabilities: LearnerShellCapabilities;
  /**
   * Resolved shell kind. Used to pick learner-safe copy for shells
   * whose `modePillKey` is null (e.g. results-readout) but still lock
   * module switch — those fall through to the generic copy.
   */
  shellKind: string;
}

interface BannerCopy {
  message: string;
  /** Stable test/diagnostic id — never user-facing. */
  variantId: string;
}

/**
 * Pick learner-safe copy keyed on the typed capability frame. NO
 * `.mode === "X"` branching — we read `modePillKey` + `shellKind`,
 * both of which are HF-canonical capability-side identifiers, not
 * mode-shape literals.
 *
 * Pure for test-ability — exported so the paired vitest can assert
 * the matrix per cell without spinning up render harness.
 */
export function pickBannerCopy(
  capabilities: LearnerShellCapabilities,
  shellKind: string,
): BannerCopy | null {
  if (capabilities.allowModuleSwitch) return null;

  // Per-shell + per-mode-pill copy. The pill key is the canonical
  // capability-side identifier for the visual variant of the shell;
  // SHELL_CAPABILITY_OVERRIDES drives it (exam-shell carries
  // "examiner" for board-chair frame, "mock-exam" for full-mock).
  if (shellKind === "exam" && capabilities.modePillKey === "examiner") {
    return {
      message: "Finish this assessment before switching modules.",
      variantId: "exam-examiner",
    };
  }
  if (shellKind === "exam" && capabilities.modePillKey === "mock-exam") {
    return {
      message: "Complete the mock exam to switch modules.",
      variantId: "exam-mock-exam",
    };
  }
  if (shellKind === "mcq-rounds") {
    return {
      message: "Complete this round before switching modules.",
      variantId: "mcq-rounds",
    };
  }
  // Generic fallback — any other shell whose capabilities lock the
  // switch (today: results-readout sits in this bucket, plus any
  // future shell variant).
  return {
    message: "This session must be completed before switching modules.",
    variantId: "generic",
  };
}

export function ModuleSwitchLockBanner({
  capabilities,
  shellKind,
}: ModuleSwitchLockBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const copy = pickBannerCopy(capabilities, shellKind);

  if (!copy || dismissed) return null;

  return (
    <div
      className="hf-banner hf-banner-info"
      role="status"
      data-testid="module-switch-lock-banner"
      data-variant={copy.variantId}
    >
      <span>{copy.message}</span>
      <button
        type="button"
        className="hf-btn hf-btn-secondary"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        data-testid="module-switch-lock-banner-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
