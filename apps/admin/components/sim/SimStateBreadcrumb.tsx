/**
 * Sim state breadcrumb — surfaces the call-state info that previously lived
 * only inside the composed system prompt. Renders above the chat area on
 * both the standalone sim view and the admin caller detail AI Call tab.
 *
 * Three pills:
 *
 *   [ Now: Call #N (Pre-call|Active) ]  ·  [ Next: Call #N+1 ]  ·  [ Module: <name> | Pick a module → ]
 *
 * "Now" answers "which call am I in, and what's its state right now". "Next"
 * tells the user what call is queued after this one. The Module pill is
 * interactive when modulesAuthored=true.
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
}

export function SimStateBreadcrumb({
  pastCallCount,
  activeCall = false,
  requestedModuleId,
  modules = [],
  onPickModule,
}: SimStateBreadcrumbProps) {
  // The "current" call is the one being conducted right now (active) OR the
  // one the learner is about to start (pre-call). It's the same number in
  // either case — what differs is the state label.
  const currentCallNumber = pastCallCount + 1;
  const nextCallNumber = currentCallNumber + 1;
  const stateLabel = activeCall ? "Active" : "Pre-call";

  const matched = requestedModuleId ? modules.find((m) => m.id === requestedModuleId) : undefined;
  const moduleHasFocus = Boolean(requestedModuleId);
  const moduleLabel = matched?.label || requestedModuleId;

  return (
    <div className="hf-sim-breadcrumb" role="navigation" aria-label="Sim call state">
      <span className="hf-sim-breadcrumb-pill hf-sim-breadcrumb-pill-current">
        Now: Call #{currentCallNumber} ({stateLabel})
      </span>
      <span className="hf-sim-breadcrumb-sep">·</span>
      <span className="hf-sim-breadcrumb-pill">Next: Call #{nextCallNumber}</span>
      <span className="hf-sim-breadcrumb-sep">·</span>
      {onPickModule ? (
        <button
          type="button"
          onClick={onPickModule}
          className={`hf-sim-breadcrumb-pill hf-sim-breadcrumb-pill-action${moduleHasFocus ? " hf-sim-breadcrumb-pill-focus" : ""}`}
          aria-label={moduleHasFocus ? `Change module — currently ${moduleLabel}` : "Pick a module"}
        >
          {moduleHasFocus ? `Module: ${moduleLabel}` : "Pick a module →"}
        </button>
      ) : moduleHasFocus ? (
        <span className="hf-sim-breadcrumb-pill hf-sim-breadcrumb-pill-focus">
          Module: {moduleLabel}
        </span>
      ) : null}
    </div>
  );
}
