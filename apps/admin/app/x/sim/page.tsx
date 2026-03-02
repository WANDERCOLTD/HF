'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { useResponsive } from '@/hooks/useResponsive';
import { ConversationList } from '@/components/sim/ConversationList';

export default function SimChatListPage() {
  const { isDesktop } = useResponsive();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  // Desktop: auto-redirect to the most recent caller so a call starts immediately
  useEffect(() => {
    if (!isDesktop) return;
    fetch('/api/sim/conversations')
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.conversations?.length > 0) {
          const sorted = [...data.conversations].sort((a: any, b: any) => {
            const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
            const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
            if (aTime || bTime) return bTime - aTime;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
          router.replace(`/x/sim/${sorted[0].callerId}`);
        } else {
          setChecked(true);
        }
      })
      .catch(() => setChecked(true));
  }, [isDesktop, router]);

  // Desktop: loading while checking for callers to auto-select
  if (isDesktop && !checked) {
    return (
      <div className="wa-desktop-empty">
        <div className="hf-spinner" style={{ width: 28, height: 28 }} />
        <p style={{ fontSize: 14, color: 'var(--wa-text-muted)', marginTop: 16 }}>
          Loading...
        </p>
      </div>
    );
  }

  // Desktop: no callers found — show empty state
  if (isDesktop) {
    return (
      <div className="wa-desktop-empty">
        <div style={{ color: 'var(--wa-border)' }}>
          <MessageCircle size={72} strokeWidth={1} />
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 300, color: 'var(--wa-text-secondary)', margin: '24px 0 12px' }}>
          HF Simulator
        </h2>
        <p style={{ fontSize: 14, color: 'var(--wa-text-muted)', maxWidth: 460, lineHeight: 1.5 }}>
          No callers yet. Create one from Get Started or Quick Launch.
        </p>
      </div>
    );
  }

  // Mobile/Tablet: show conversation list
  return <ConversationList />;
}
