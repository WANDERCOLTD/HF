'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useResponsive } from '@/hooks/useResponsive';
import { WhatsAppHeader } from '@/components/sim/WhatsAppHeader';
import { SimChat } from '@/components/sim/SimChat';
import { deriveParameterMap } from '@/lib/agent-tuner/derive';
import type { AgentTunerPill } from '@/lib/agent-tuner/types';

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
  const communityName = searchParams.get('communityName') || undefined;
  const forceFirstCall = searchParams.get('forceFirstCall') === 'true';

  // Tuner pills from Teach/Demonstrate wizard — derive target overrides for prompt composition
  const targetOverrides = useMemo(() => {
    const raw = searchParams.get('tunerPills');
    if (!raw) return undefined;
    try {
      const pills: AgentTunerPill[] = JSON.parse(raw);
      if (!Array.isArray(pills) || pills.length === 0) return undefined;
      const map = deriveParameterMap(pills);
      return Object.keys(map).length > 0 ? map : undefined;
    } catch {
      return undefined;
    }
  }, [searchParams]);

  const [caller, setCaller] = useState<CallerInfo | null>(null);
  const [playbookName, setPlaybookName] = useState<string | undefined>(undefined);
  const [subjectDiscipline, setSubjectDiscipline] = useState<string | undefined>(undefined);
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

          // Fetch playbook name + subject discipline if scoped to a specific course
          if (playbookId) {
            fetch(`/api/playbooks/${playbookId}`)
              .then(r => r.json())
              .then(pbData => {
                if (!cancelled && pbData.ok) {
                  setPlaybookName(pbData.playbook?.name);
                  const disc = (pbData.playbook?.config as any)?.subjectDiscipline;
                  if (disc) setSubjectDiscipline(disc);
                }
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
        <div className="wa-chat-bg" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div className="hf-spinner" style={{ width: 28, height: 28 }} />
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading...</p>
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
      playbookName={communityName ?? playbookName}
      subjectDiscipline={subjectDiscipline}
      pastCalls={caller.pastCalls}
      mode="standalone"
      sessionGoal={sessionGoal}
      targetOverrides={targetOverrides}
      forceFirstCall={forceFirstCall || undefined}
      onBack={isDesktop ? undefined : () => router.push('/x/sim')}
    />
  );
}
