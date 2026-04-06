'use client';

/**
 * HFDrawer — reusable side panel built on Radix Dialog.
 *
 * Slides in from the right (desktop) or up from the bottom (mobile).
 * Radix provides: focus trap, Escape to close, scroll lock, aria-modal, portal.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export interface HFDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function HFDrawer({
  open,
  onClose,
  title,
  description,
  width,
  children,
  footer,
}: HFDrawerProps): React.ReactElement | null {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="hf-drawer-overlay" />
        <Dialog.Content
          className="hf-drawer-content"
          style={width ? { '--hf-drawer-width': `${width}px` } as React.CSSProperties : undefined}
        >
          <div className="hf-drawer-header">
            <Dialog.Title className="hf-drawer-title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="hf-drawer-close" aria-label="Close drawer">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {description
            ? <Dialog.Description className="hf-visually-hidden">{description}</Dialog.Description>
            : <Dialog.Description className="hf-visually-hidden">Detail panel</Dialog.Description>
          }

          <div className="hf-drawer-body">{children}</div>

          {footer && <div className="hf-drawer-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
