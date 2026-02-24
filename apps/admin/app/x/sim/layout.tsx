'use client';

import { useEffect } from 'react';
import { useResponsive } from '@/hooks/useResponsive';
import { ConversationList } from '@/components/sim/ConversationList';
import { SimNavBar } from '@/components/sim/SimNavBar';
import './sim.css';

export default function SimLayout({ children }: { children: React.ReactNode }) {
  const { isDesktop } = useResponsive();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Desktop: icon strip + conversation sidebar + main chat panel
  if (isDesktop) {
    return (
      <div className="wa-desktop-container">
        <SimNavBar />
        <div className="wa-desktop-sidebar">
          <ConversationList />
        </div>
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
