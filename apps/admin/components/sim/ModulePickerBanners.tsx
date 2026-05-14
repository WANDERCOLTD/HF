/**
 * Module-picker banners — shared between the standalone sim view
 * (/x/sim/[callerId]) and the admin caller detail page's AI Call tab
 * (CallerDetailPage). Each surface mounts the same components so the
 * learner sees identical state regardless of the route they entered from.
 *
 * - ModulePickerSelectionBanner — renders when a module was just picked
 *   (URL carries ?requestedModuleId=). Confirms the choice and resolves
 *   the human label from the authored module config.
 * - ModulePickerInviteBanner — renders when no module is picked yet but
 *   modulesAuthored=true on the playbook. The entire row is role=button,
 *   keyboard-activatable, and routes to the picker on click. Replaces the
 *   prior pattern where the only entry was an obscure header Layers icon.
 *
 * Issue #357.
 */

interface AuthoredModule {
  id: string;
  label?: string;
}

export function ModulePickerSelectionBanner({
  moduleId,
  modules,
}: {
  moduleId: string;
  modules: AuthoredModule[];
}) {
  const matched = modules.find((m) => m.id === moduleId);
  const label = matched?.label || moduleId;
  return (
    <div
      role="status"
      aria-live="polite"
      className="hf-banner hf-banner-info hf-flex hf-items-center hf-gap-8"
    >
      <strong>Module selected:</strong>
      <span>
        This session will focus on <strong>{label}</strong>. Mastery will be tracked against this module.
      </span>
    </div>
  );
}

export function ModulePickerInviteBanner({
  moduleCount,
  onPick,
}: {
  moduleCount: number;
  onPick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      className="hf-banner hf-banner-info hf-flex hf-items-center hf-gap-8 hf-banner-clickable"
      aria-label="Pick a module to focus this session"
    >
      <strong>Pick a module →</strong>
      <span>
        Focus this session on one of {moduleCount > 0 ? `${moduleCount} ` : ""}
        authored modules so mastery is tracked. Or continue and the system will choose.
      </span>
    </div>
  );
}
