"use client";

/**
 * ChatFeedShell — typed shell instance wrapping the default chat-feed
 * experience (the implicit "no shell" that today is unnamed).
 *
 * S3 of epic #2163 (#2198). Per epic decision 1 — every learner-facing
 * session frame is a typed `LearnerShell`. Before this refactor, the
 * chat-feed surface was the implicit default — no name, no capability
 * frame, no Coverage gate. After: the default IS a named shell whose
 * capability map happens to be `SHELL_DEFAULTS["chat-feed"]`.
 *
 * The shell is intentionally render-thin — it does not own the
 * `SimChat` mounting or lifecycle (the operator continues to mount
 * `SimChat` directly from `app/x/student/**` or sim host pages). The
 * shell wraps it as a typed Lattice primitive so the Coverage tests
 * can assert every `LearnerShellKind` has a consumer.
 *
 * Capabilities are mostly no-ops for chat-feed since chat-feed = the
 * default. The `data-*` attributes the shell stamps onto the wrapper
 * div are how a future runtime SUPERVISE scan can assert the right
 * capability frame was rendered.
 *
 * **Coverage**: paired vitest `tests/components/sim/learner-shells.test.tsx`
 * asserts SHELL_DEFAULTS["chat-feed"] → expected DOM.
 *
 * **Future**: when PR #2197 lands `resolveLearnerShell(session, module)`,
 * sim host pages pick the shell via the resolver instead of mounting
 * `<SimChat />` directly. Today's `children` prop is the migration
 * pathway: the host renders SimChat as the child and the shell adds
 * the typed frame around it.
 */

import { SHELL_DEFAULTS, type LearnerShellCapabilities } from "@/lib/types/json-fields";
import "./learner-shells.css";

interface ChatFeedShellProps {
  /** Capability frame. Defaults to `SHELL_DEFAULTS["chat-feed"]` so the
   *  shell is a pure no-op wrapper around `<SimChat />` in its default
   *  configuration — preserves byte-identical behaviour at the
   *  ChatFeedShell entry point. */
  capabilities?: LearnerShellCapabilities;
  /** The actual chat-feed surface (typically `<SimChat />`). */
  children?: React.ReactNode;
}

export function ChatFeedShell({
  capabilities = SHELL_DEFAULTS["chat-feed"],
  children,
}: ChatFeedShellProps) {
  return (
    <div
      className="hf-chat-feed-shell"
      data-testid="hf-chat-feed-shell"
      data-shell-kind="chat-feed"
      data-colour-theme={capabilities.colourTheme}
      data-mode-pill={capabilities.modePillKey ?? ""}
      data-chat-feed-visibility={capabilities.chatFeedVisibility}
      data-show-timer={capabilities.showTimer}
      data-show-progress-bar={capabilities.showProgressBar}
      data-allow-module-switch={String(capabilities.allowModuleSwitch)}
      data-allow-back-to-home={String(capabilities.allowBackToHome)}
      data-dismiss-on-end={capabilities.dismissOnEnd}
      data-stall-chip-behaviour={capabilities.stallChipBehaviour}
    >
      {children}
    </div>
  );
}
