'use client';

/**
 * ModuleQuickSwitcher — inline modal for the learner's "Switch module" pill.
 *
 * Replaces a page navigation to `/x/student/[courseId]/modules` for the
 * common case ("pick Unit 04 instead of Unit 09"). User feedback #1248:
 * page-switching for a single decision is heavier UX than the choice
 * warrants. This dialog renders the authored module list inline, returns
 * the picked id via `onPick`, and offers a "See full picker" escape to
 * the existing dedicated page when the learner wants module details
 * (prereqs, descriptions, recommendation reasoning).
 *
 * Built on Radix Dialog (the only Radix primitive installed today —
 * `@radix-ui/react-popover` would be more visually correct but adds a
 * dependency for a small visual delta). Dialogs are keyboard-accessible
 * by default (Esc to close, focus trap, scroll lock).
 *
 * Data source: the parent passes `modules` (already fetched in the sim
 * page from /api/playbooks/[playbookId]). Status badges show only when
 * `progressByModuleId` is supplied — when absent the rows still render
 * cleanly without status pills.
 */

import { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ChevronRight } from 'lucide-react';

export interface ModuleQuickSwitcherModule {
  id: string;
  label?: string;
}

export type ModuleStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface ModuleQuickSwitcherProps {
  open: boolean;
  onClose: () => void;
  /** Authored module list (Playbook.config.modules). */
  modules: ModuleQuickSwitcherModule[];
  /** Currently-picked module id, when any. The matching row gets a focus marker. */
  currentModuleId?: string | null;
  /** Called with the picked module id. Parent updates URL / persistence. */
  onPick: (moduleId: string) => void;
  /** Optional href for "See full picker →" escape link. When omitted the link is hidden. */
  fullPickerHref?: string;
  /** Optional per-module status from CallerModuleProgress; missing keys render as no badge. */
  progressByModuleId?: Record<string, ModuleStatus>;
}

const STATUS_LABEL: Record<ModuleStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

const STATUS_PILL_CLASS: Record<ModuleStatus, string> = {
  NOT_STARTED: 'hf-badge',
  IN_PROGRESS: 'hf-badge hf-badge-info',
  COMPLETED: 'hf-badge hf-badge-success',
};

export function ModuleQuickSwitcher({
  open,
  onClose,
  modules,
  currentModuleId,
  onPick,
  fullPickerHref,
  progressByModuleId,
}: ModuleQuickSwitcherProps): React.ReactElement | null {
  const handlePick = useCallback(
    (moduleId: string) => {
      onPick(moduleId);
      onClose();
    },
    [onPick, onClose],
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="hf-drawer-overlay" />
        <Dialog.Content className="hf-module-switcher-content" aria-describedby={undefined}>
          <div className="hf-drawer-header">
            <Dialog.Title className="hf-drawer-title">Pick a module</Dialog.Title>
            <Dialog.Close asChild>
              <button className="hf-drawer-close" aria-label="Close module picker">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          {modules.length === 0 ? (
            <p className="hf-empty hf-pad-md">
              No modules authored on this course yet. Add modules from the course Tune tab to use this picker.
            </p>
          ) : (
            <ul className="hf-module-switcher-list" role="list" data-testid="module-switcher-list">
              {modules.map((m) => {
                const isCurrent = currentModuleId === m.id;
                const status = progressByModuleId?.[m.id];
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`hf-module-switcher-row${isCurrent ? ' hf-module-switcher-row-current' : ''}`}
                      onClick={() => handlePick(m.id)}
                      data-testid={`module-switcher-row-${m.id}`}
                    >
                      <span className="hf-module-switcher-label">{m.label || m.id}</span>
                      {status ? (
                        <span className={STATUS_PILL_CLASS[status]}>{STATUS_LABEL[status]}</span>
                      ) : null}
                      <ChevronRight size={14} className="hf-module-switcher-chevron" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {fullPickerHref ? (
            <a href={fullPickerHref} className="hf-module-switcher-escape">
              See full picker (with module details, prerequisites, and recommendation) →
            </a>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
