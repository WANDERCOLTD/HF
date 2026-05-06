'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useResponsive } from '@/hooks/useResponsive';
import { WhatsAppHeader } from '@/components/sim/WhatsAppHeader';
import { SimChat } from '@/components/sim/SimChat';
import { useJourneyChat } from '@/hooks/useJourneyChat';
import { deriveParameterMap } from '@/lib/agent-tuner/derive';
import type { AgentTunerPill } from '@/lib/agent-tuner/types';

interface PastCall {
  transcript: string;
  createdAt: string;
}

interface CallerInfo {
  name: string;
  role: string;
  domain?: { name: string; slug: string } | null;
  pastCalls: PastCall[];
}

export default function SimConversationPage() {
  const router = useRouter();
  const { callerId } = useParams<{ callerId: string }>();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { isDesktop } = useResponsive();
  const isStudent = session?.user?.role === 'STUDENT';
  const sessionGoal = searchParams.get('goal') || undefined;
  const expectedDomainId = searchParams.get('domainId') || undefined;
  const playbookId = searchParams.get('playbookId') || undefined;
  const communityName = searchParams.get('communityName') || undefined;
  const forceFirstCall = searchParams.get('forceFirstCall') === 'true';
  // #242 Slice 2 placeholder: surface the moduleId chosen in the picker.
  // No real VAPI dial wiring yet — the banner just confirms the round-trip.
  const requestedModuleId = searchParams.get('requestedModuleId') || undefined;

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
  const [modulesAuthored, setModulesAuthored] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Journey chat — unified WhatsApp-style survey/onboarding/teaching flow
  // Only runs for LEARNER callers; waits for caller data before deciding.
  const journey = useJourneyChat({ callerId, forceFirstCall, callerRole: caller?.role });

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
            role: data.caller.role || 'SIM',
            domain: data.caller.domain,
            pastCalls: calls,
          });

          if (playbookId) {
            fetch(`/api/playbooks/${playbookId}`)
              .then(r => r.json())
              .then(pbData => {
                if (!cancelled && pbData.ok) {
                  setPlaybookName(pbData.playbook?.name);
                  const cfg = (pbData.playbook?.config as any) || {};
                  if (cfg.subjectDiscipline) setSubjectDiscipline(cfg.subjectDiscipline);
                  // Issue #242: gate the "Pick module" header button on authored modules.
                  // Treat both `null` (never imported) and `false` (opted out) as off.
                  setModulesAuthored(cfg.modulesAuthored === true);
                }
              })
              .catch(() => {});
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load caller');
      }
    }

    fetchCaller();
    return () => { cancelled = true; };
  }, [callerId, expectedDomainId, playbookId]);

  const handleStudentCallEnd = useCallback(() => {
    if (isStudent) {
      setTimeout(() => router.push('/x/student'), 1500);
    }
    // Journey onCallEnd is now called directly inside SimChat
  }, [router, isStudent]);

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

  const handlePickModule = useCallback(() => {
    if (!playbookId) return;
    const sp = new URLSearchParams();
    // Strip requestedModuleId so the banner doesn't keep firing on re-pick.
    const carryParams = new URLSearchParams(searchParams.toString());
    carryParams.delete('requestedModuleId');
    sp.set('returnTo', `/x/sim/${callerId}${carryParams.toString() ? `?${carryParams.toString()}` : ''}`);
    router.push(`/x/student/${playbookId}/modules?${sp.toString()}`);
  }, [callerId, playbookId, router, searchParams]);

  return (
    <>
      {requestedModuleId && (
        <ModulePickerPlaceholderBanner moduleId={requestedModuleId} />
      )}
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
        onCallEnd={isStudent ? handleStudentCallEnd : undefined}
        onPickModule={modulesAuthored && playbookId ? handlePickModule : undefined}
        journey={journey}
      />
    </>
  );
}

/**
 * Placeholder banner — Slice 2 of #242. Renders when the SIM is hit with
 * `?requestedModuleId=<id>` (from the picker → SIM round-trip). The real
 * VAPI dial wiring happens once the call-init path is identified by recon
 * (see TODO in launchSelected at /x/student/[courseId]/modules/page.tsx).
 */
function ModulePickerPlaceholderBanner({ moduleId }: { moduleId: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-default)',
        background: 'color-mix(in srgb, var(--accent-primary) 8%, var(--surface-primary))',
        fontSize: 13,
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <strong>Placeholder:</strong>
      <span>
        VAPI call would now start with module{' '}
        <code
          style={{
            padding: '2px 6px',
            borderRadius: 4,
            background: 'var(--surface-secondary)',
            fontSize: 12,
          }}
        >
          {moduleId}
        </code>
        {' '}— wiring pending recon (#242 Slice 2).
      </span>
    </div>
  );
}
