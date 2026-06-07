/**
 * Sim state breadcrumb — surfaces the call-state info that previously lived
 * only inside the composed system prompt. Renders above the chat area on
 * both the standalone sim view and the admin caller detail AI Call tab.
 *
 * Pills, in render order:
 *
 *   [ Now: Call #N (Pre-call|Active) ]  ·  [ Module: <name> | Switch module ]  ·  [ Next: Call #N+1 ]
 *
 * "Now" + "Module" go together as "what's happening right now" — module
 * pill is placed directly after Now so a learner reads them as one
 * thought. "Next" is forward-looking and rightmost.
 *
 * The raw "Next: Call #N+1" pill carries no learner-actionable
 * information (sequence number is implementation detail). We render it
 * only when its label adds meaning — today that means "show only when
 * the next call's module differs from the current one"; until that
 * signal is wired, the pill is suppressed entirely (returned null).
 * Re-enable by passing an explicit `nextLabel` once a meaningful signal
 * exists.
 *
 * Issue #357. Session / phase sub-pills are intentionally deferred — they
 * need compose-prompt response wiring that doesn't exist yet on these
 * surfaces.
 */

interface AuthoredModule {
  id: string;
  label?: string;
}

interface SimStateBreadcrumbProps {
  /** Number of past calls (with transcript). */
  pastCallCount: number;
  /** True if a call is currently active (not yet ended). */
  activeCall?: boolean;
  /** Module id chosen by the picker for this session, if any. */
  requestedModuleId?: string | null;
  /** Authored module list — used to resolve the picked id to a human label. */
  modules?: AuthoredModule[];
  /** When set, the Module pill is interactive — clicking opens the picker. */
  onPickModule?: () => void;
  /**
   * Optional override for the "Next" pill. When undefined the pill is
   * hidden (sequence number alone is not learner-meaningful). Pass a
   * concrete label like "Next: assessment" or "Next: Unit 09 —
   * Architecture" when the next-call signal is actually known.
   */
  nextLabel?: string | null;
}

export function SimStateBreadcrumb({
  pastCallCount,
  activeCall = false,
  requestedModuleId,
  modules = [],
  onPickModule,
  nextLabel,
}: SimStateBreadcrumbProps) {
  // The "current" call is the one being conducted right now (active) OR the
  // one the learner is about to start (pre-call). It's the same number in
  // either case — what differs is the state label.
  const currentCallNumber = pastCallCount + 1;
  const stateLabel = activeCall ? "Active" : "Pre-call";

  const matched = requestedModuleId ? modules.find((m) => m.id === requestedModuleId) : undefined;
  const moduleHasFocus = Boolean(requestedModuleId);
  const moduleLabel = matched?.label || requestedModuleId;

  const showNext = typeof nextLabel === "string" && nextLabel.trim().length > 0;
  const showModulePill = Boolean(onPickModule) || moduleHasFocus;

  return (
    <div className="hf-sim-breadcrumb" role="navigation" aria-label="Sim call state">
      <span className="hf-sim-breadcrumb-pill hf-sim-breadcrumb-pill-current">
        Now: Call #{currentCallNumber} ({stateLabel})
      </span>
      {showModulePill ? (
        <>
          <span className="hf-sim-breadcrumb-sep">·</span>
          {onPickModule ? (
            <button
              type="button"
              onClick={onPickModule}
              className={`hf-sim-breadcrumb-pill hf-sim-breadcrumb-pill-action${moduleHasFocus ? " hf-sim-breadcrumb-pill-focus" : ""}`}
              aria-label={moduleHasFocus ? `Switch module — currently ${moduleLabel}` : "Pick a module"}
            >
              {moduleHasFocus ? `Module: ${moduleLabel} · Switch` : "Pick a module →"}
            </button>
          ) : (
            <span className="hf-sim-breadcrumb-pill hf-sim-breadcrumb-pill-focus">
              Module: {moduleLabel}
            </span>
          )}
        </>
      ) : null}
      {showNext ? (
        <>
          <span className="hf-sim-breadcrumb-sep">·</span>
          <span className="hf-sim-breadcrumb-pill">{nextLabel}</span>
        </>
      ) : null}
    </div>
  );
}
