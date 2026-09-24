'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useResponsive } from '@/hooks/useResponsive';
import { WhatsAppHeader } from '@/components/sim/WhatsAppHeader';
import { CallerVoiceSurface } from '@/components/callers/CallerVoiceSurface';
import { FirstCallPinGate } from '@/components/identity/FirstCallPinGate';
import { useEmbeddedMode } from '@/hooks/useEmbeddedMode';
import { deriveParameterMap } from '@/lib/agent-tuner/derive';
import type { AgentTunerPill } from '@/lib/agent-tuner/types';

/**
 * Epic #1700 missing-surface sweep — Mock learner post-call redirect.
 *
 * Resolves the target URL for a STUDENT learner returning from a call.
 * For Mock-style calls (bound module declares `coversModules.length > 0`
 * — the canonical "multi-part Mock" discriminator established in
 * #1702/#1785), routes to the Mock Results screen at
 * `/x/student/<playbookId>/results/<sessionId>`. Falls back to
 * `/x/student` for anything else (regular tutor calls, errors, missing
 * data).
 *
 * Network-best-effort: on any fetch or parse failure, return the
 * fallback URL. Never throws.
 */
async function resolvePostCallRedirect(callId: string | undefined): Promise<string> {
  const fallback = '/x/student';
  if (!callId) return fallback;
  try {
    const res = await fetch(`/api/calls/${callId}/post-call-redirect`);
    if (!res.ok) return fallback;
    const body = (await res.json()) as { ok?: boolean; target?: string };
    return body?.ok && typeof body.target === 'string' ? body.target : fallback;
  } catch {
    return fallback;
  }
}

/**
 * /x/sim/[callerId] — standalone simulator page (#1448).
 *
 * Page-level responsibilities:
 *   - URL param parsing (`?goal=`, `?tunerPills=`, `?forceFirstCall=`, `?as=`)
 *   - WhatsAppHeader chrome
 *   - FirstCallPinGate for STUDENT / preview-as-learner
 *   - Mobile back-button routing
 *
 * Everything else (caller fetch, playbook fetch, journey integration,
 * SimStateBreadcrumb, ModulePickerBanners, QualificationContextStrip,
 * ModuleQuickSwitcher, SimChat mount) is owned by `<CallerVoiceSurface
 * layout="standalone">` — shared with `/x/callers/<id>?tab=ai-call`.
 */
export default function SimConversationPage() {
  const router = useRouter();
  const { callerId } = useParams<{ callerId: string }>();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const { isDesktop } = useResponsive();
  const isStudent = session?.user?.role === 'STUDENT';
  // #2277 — MT-embedded mode: when the operator-supervised URL carries
  // `?embedded=1`, the root layout already strips sidebar/topnav. We
  // ALSO flip `<CallerVoiceSurface layout="embedded">` so SimChat
  // renders its clean `sim-embedded` shell (no exam-shell overlay, no
  // results overlay, no transcript-review return) — prospects see a
  // pure chat surface.
  const isMtEmbedded = useEmbeddedMode();
  // Admin "preview as learner" — `?as=learner` flips the PIN gate on
  // for an OPERATOR+ session so the auth surface can be demo'd without
  // signing out.
  const previewAsLearner = searchParams.get('as') === 'learner';
  const gateAsStudent = isStudent || previewAsLearner;

  const sessionGoal = searchParams.get('goal') || undefined;
  const expectedDomainId = searchParams.get('domainId') || undefined;
  const communityName = searchParams.get('communityName') || undefined;
  const forceFirstCall = searchParams.get('forceFirstCall') === 'true';

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

  // #1101 — PIN gate state machine (loading | needsPin | verified).
  // Lives at the page level because the gate replaces the entire surface,
  // not just the chat panel — so it sits above CallerVoiceSurface.
  const [pinGateStatus, setPinGateStatus] = useState<'loading' | 'needsPin' | 'verified'>('loading');
  const [pinGateRecipient, setPinGateRecipient] = useState<string | null>(null);
  // Hold the caller's first name for the PIN gate copy — fetched once,
  // independent of CallerVoiceSurface's own caller fetch (which only
  // mounts after the gate clears).
  const [callerFirstName, setCallerFirstName] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (!gateAsStudent) {
      setPinGateStatus('verified');
      return;
    }
    let cancelled = false;
    fetch(`/api/identity/challenge-status?callerId=${encodeURIComponent(callerId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        const ct = r.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) throw new Error(`non-JSON: ${ct}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data?.ok) {
          setPinGateRecipient(null);
          setPinGateStatus('needsPin');
          return;
        }
        if (data.needsPin) {
          setPinGateRecipient(data.recipient ?? null);
          setPinGateStatus('needsPin');
        } else {
          setPinGateStatus('verified');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[pin-gate] challenge-status fetch failed:', err);
        setPinGateRecipient(null);
        setPinGateStatus('needsPin');
      });
    return () => {
      cancelled = true;
    };
  }, [callerId, gateAsStudent, sessionStatus]);

  // Fetch caller's first name once for the PIN gate copy. Cheap; no error
  // handling because the gate copy degrades gracefully without it.
  useEffect(() => {
    if (pinGateStatus !== 'needsPin') return;
    if (callerFirstName) return;
    let cancelled = false;
    fetch(`/api/callers/${callerId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.ok) return;
        const name = data.caller?.name?.trim().split(/\s+/)[0] ?? null;
        setCallerFirstName(name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [callerId, pinGateStatus, callerFirstName]);

  if (pinGateStatus === 'loading') {
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
  if (pinGateStatus === 'needsPin') {
    return (
      <>
        <WhatsAppHeader title="Verify your code" />
        <FirstCallPinGate
          callerId={callerId}
          recipient={pinGateRecipient}
          callerFirstName={callerFirstName ?? undefined}
          onVerified={() => setPinGateStatus('verified')}
        />
      </>
    );
  }

  return (
    <CallerVoiceSurface
      callerId={callerId}
      layout={isMtEmbedded ? 'embedded' : 'standalone'}
      sessionGoal={sessionGoal}
      targetOverrides={targetOverrides}
      forceFirstCall={forceFirstCall}
      onBack={isDesktop || isMtEmbedded ? undefined : () => router.push('/x/sim')}
      onCallEnd={
        isStudent
          ? (info) => {
              // Epic #1700 missing-surface sweep — Mock learners should
              // land on the Mock Results screen (Theme 13a / #1751)
              // instead of the generic /x/student home. Fetches the
              // just-ended call's session + playbook + bound module
              // mode/terminal flags and routes accordingly. Falls back
              // to /x/student on any error or for non-Mock modules.
              setTimeout(() => {
                void resolvePostCallRedirect(info?.callId).then((target) => {
                  router.push(target);
                });
              }, 1500);
            }
          : undefined
      }
      communityName={communityName}
      expectedDomainId={expectedDomainId}
    />
  );
}
