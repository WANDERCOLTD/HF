'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useResponsive } from '@/hooks/useResponsive';
import { WhatsAppHeader } from '@/components/sim/WhatsAppHeader';
import { SimChat } from '@/components/sim/SimChat';

interface PastCall {
  transcript: string;
  createdAt: string;
}

interface CallerInfo {
  name: string;
  domain?: { name: string; slug: string } | null;
  pastCalls: PastCall[];
}

export default function SimConversationPage() {
  const router = useRouter();
  const { callerId } = useParams<{ callerId: string }>();
  const searchParams = useSearchParams();
  const { isDesktop } = useResponsive();
  const sessionGoal = searchParams.get('goal') || undefined;
  const expectedDomainId = searchParams.get('domainId') || undefined;
  const playbookId = searchParams.get('playbookId') || undefined;

  const [caller, setCaller] = useState<CallerInfo | null>(null);
  const [playbookName, setPlaybookName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCaller() {
      try {
        const res = await fetch(`/api/callers/${callerId}`);
        const data = await res.json();
        if (!res.ok || !data.ok) {
          if (!cancelled) setError('Caller not found');
          return;
        }
        if (!cancelled) {
          // Validate domain matches expected (from wizard navigation)
          const callerDomainId = data.caller.domain?.id || data.caller.domainId;
          if (expectedDomainId && callerDomainId && expectedDomainId !== callerDomainId) {
            setError('Caller is no longer in the expected institution. Please re-select from the wizard.');
            return;
          }
          if (!callerDomainId) {
            setError('Caller has no institution assigned. Please assign one before simulating.');
            return;
          }

          const calls = (data.calls || [])
            .filter((c: any) => c.transcript?.trim())
            .map((c: any) => ({ transcript: c.transcript, createdAt: c.createdAt }))
            .sort((a: PastCall, b: PastCall) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          setCaller({
            name: data.caller.name || 'Unknown',
            domain: data.caller.domain,
            pastCalls: calls,
          });

          // Fetch playbook name if scoped to a specific course
          if (playbookId) {
            fetch(`/api/playbooks/${playbookId}`)
              .then(r => r.json())
              .then(pbData => {
                if (!cancelled && pbData.ok) setPlaybookName(pbData.playbook?.name);
              })
              .catch(() => {}); // Non-critical — falls back to domainName
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load caller');
      }
    }

    fetchCaller();
    return () => { cancelled = true; };
  }, [callerId, expectedDomainId, playbookId]);

  if (error) {
    return (
      <>
        <WhatsAppHeader title="Error" onBack={isDesktop ? undefined : () => router.push('/x/sim')} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{error}</p>
        </div>
      </>
    );
  }

  if (!caller) {
    return (
      <>
        <WhatsAppHeader title="Loading..." />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>Starting conversation...</p>
        </div>
      </>
    );
  }

  return (
    <SimChat
      callerId={callerId}
      callerName={caller.name}
      domainName={caller.domain?.name}
      playbookId={playbookId}
      playbookName={playbookName}
      pastCalls={caller.pastCalls}
      mode="standalone"
      sessionGoal={sessionGoal}
      onBack={isDesktop ? undefined : () => router.push('/x/sim')}
    />
  );
}
