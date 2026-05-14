/**
 * Sim state breadcrumb — surfaces the call-state info that previously lived
 * only inside the composed system prompt (call number, module focus). Renders
 * above the chat area on both the standalone sim view and the admin caller
 * detail AI Call tab so the user always knows which call they are in and
 * which module is in focus.
 *
 * Issue #357. Session / phase pills are intentionally deferred — they need
 * compose-prompt response wiring that doesn't exist yet on these surfaces.
 */

interface AuthoredModule {
  id: string;
  label?: string;
}

interface SimStateBreadcrumbProps {
  /** Number of past calls (with transcript). The next call is this + 1. */
  pastCallCount: number;
  /** True if a call is currently active (POST /calls returned, not ended). */
  activeCall?: boolean;
  /** Module id chosen by the picker for this session, if any. */
  requestedModuleId?: string | null;
  /** Authored module list — used to resolve the picked id to a human label. */
  modules?: AuthoredModule[];
  /** When set, the Module pill is interactive — clicking opens the picker. */
  onPickModule?: () => void;
}

export function SimStateBreadcrumb({
  pastCallCount,
  activeCall = false,
  requestedModuleId,
  modules = [],
  onPickModule,
}: SimStateBreadcrumbProps) {
  const callLabel = activeCall
    ? `Call #${pastCallCount + 1} (active)`
    : pastCallCount === 0
      ? "Call #1 (next)"
      : `Call #${pastCallCount + 1} (next)`;

  const stateLabel = activeCall ? "Active" : pastCallCount === 0 ? "Pre-call" : "Between calls";

  const matched = requestedModuleId ? modules.find((m) => m.id === requestedModuleId) : undefined;
  const moduleLabel = matched?.label || requestedModuleId || "Pick a module →";
  const moduleHasFocus = Boolean(requestedModuleId);

  return (
    <div className="hf-sim-breadcrumb" role="navigation" aria-label="Sim call state">
      <span className="hf-sim-breadcrumb-pill">{callLabel}</span>
      <span className="hf-sim-breadcrumb-sep">·</span>
      <span className="hf-sim-breadcrumb-pill">{stateLabel}</span>
      <span className="hf-sim-breadcrumb-sep">·</span>
      {onPickModule ? (
        <button
          type="button"
          onClick={onPickModule}
          className={`hf-sim-breadcrumb-pill hf-sim-breadcrumb-pill-action${moduleHasFocus ? " hf-sim-breadcrumb-pill-focus" : ""}`}
          aria-label={moduleHasFocus ? `Change module — currently ${moduleLabel}` : "Pick a module"}
        >
          Module: {moduleLabel}
        </button>
      ) : (
        <span className="hf-sim-breadcrumb-pill">Module: {moduleLabel}</span>
      )}
    </div>
  );
}
