'use client';

import { useEffect, useState } from 'react';
import { useResponsive } from '@/hooks/useResponsive';
import { ConversationList } from '@/components/sim/ConversationList';
import { SimNavBar } from '@/components/sim/SimNavBar';
import './sim.css';

const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 600;
const SIDEBAR_DEFAULT = 360;

export default function SimLayout({ children }: { children: React.ReactNode }) {
  const { isDesktop } = useResponsive();
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // #989 — clean up any prior root-scoped registration from when sw.js was
    // registered without `scope`. Without this, existing browsers keep the
    // wide-scope SW intercepting fetches across the admin chrome (e.g. the
    // /x/courses status-bar chip ended up serving stale JS for hours).
    navigator.serviceWorker.getRegistrations()
      .then((regs) => {
        regs.forEach((reg) => {
          if (!reg.scope.includes('/x/sim/')) {
            reg.unregister().catch(() => {});
          }
        });
      })
      .catch(() => { /* non-fatal */ });
    navigator.serviceWorker.register('/sw.js', { scope: '/x/sim/' })
      .catch(() => {});
  }, []);

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(ev: MouseEvent) {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX));
      setSidebarWidth(next);
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Desktop: icon strip + conversation sidebar + main chat panel
  if (isDesktop) {
    return (
      <div className="wa-desktop-container">
        <SimNavBar />
        <div className="wa-desktop-sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}>
          <ConversationList />
        </div>
        <div className="wa-desktop-resize-handle" onMouseDown={onResizeMouseDown} role="separator" aria-orientation="vertical" />
        <div className="wa-desktop-main">
          {children}
        </div>
      </div>
    );
  }

  // Mobile/Tablet: full-screen single panel + bottom nav bar
  return (
    <div className="wa-mobile-container has-nav-bar">
      {children}
      <SimNavBar />
    </div>
  );
}
