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
import { ModulePickerSelectionBanner, ModulePickerInviteBanner } from '@/components/sim/ModulePickerBanners';
import { SimStateBreadcrumb } from '@/components/sim/SimStateBreadcrumb';
import { ModuleQuickSwitcher } from '@/components/sim/ModuleQuickSwitcher';
import { QualificationContextStrip } from '@/components/sim/qualification/QualificationContextStrip';
import { FirstCallPinGate } from '@/components/identity/FirstCallPinGate';

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
  const { data: session, status: sessionStatus } = useSession();
  const { isDesktop } = useResponsive();
  const isStudent = session?.user?.role === 'STUDENT';
  // Admin "preview as learner" — `?as=learner` flips the PIN gate on for an
  // OPERATOR+ session so the auth surface can be demo'd without signing out.
  // Server-side scope (resolveCallerScopeForReading) still treats the request
  // as OPERATOR+ (passes the supplied callerId through), so the challenge
  // status / verify-pin endpoints answer for the requested caller.
  const previewAsLearner = searchParams.get('as') === 'learner';
  const gateAsStudent = isStudent || previewAsLearner;
  const sessionGoal = searchParams.get('goal') || undefined;
  const expectedDomainId = searchParams.get('domainId') || undefined;
  // #948 — `playbookId` may be missing from the URL when a learner lands
  // directly on /x/sim/[callerId]. Without it the playbook fetch below
  // never fires, so `modulesAuthored` stays false and the module-picker
  // banner never renders even for a caller enrolled on a course with an
  // authored module catalogue. Resolve it from enrollments instead — same
  // logic as `CallerDetailPage:386-398`: single active enrollment → that
  // playbook; multiple → most-recently enrolled.
  //
  // URL wins (deep-link from elsewhere); enrollment-resolved fallback only
  // applies when URL has nothing. Derived sync, so no setState-in-effect.
  const urlPlaybookId = searchParams.get('playbookId') || undefined;
  const [enrollmentPlaybookId, setEnrollmentPlaybookId] = useState<string | undefined>(undefined);
  const playbookId = urlPlaybookId ?? enrollmentPlaybookId;
  const communityName = searchParams.get('communityName') || undefined;
  const forceFirstCall = searchParams.get('forceFirstCall') === 'true';
  // #242 Slice 2 placeholder: surface the moduleId chosen in the picker.
  // No real voice dial wiring yet — the banner just confirms the round-trip.
  const urlRequestedModuleId = searchParams.get('requestedModuleId') || undefined;
  // #1245 — per-Caller "last picked module" persistence. Populated from
  // GET /api/callers/[callerId]; used to back-fill the picker state when
  // the learner returns to /x/sim without a URL param so they don't
  // have to re-pick every visit.
  const [lastSelectedModuleId, setLastSelectedModuleId] = useState<string | undefined>(undefined);
  const requestedModuleId = urlRequestedModuleId ?? lastSelectedModuleId;

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
  // #1101 — first-call PIN gate. Only STUDENT sessions are gated; OPERATOR+
  // admin browsing of a learner's sim page is unaffected. 'loading' until the
  // challenge-status fetch returns; 'verified' once the gate posts ok.
  const [pinGateStatus, setPinGateStatus] = useState<
    'loading' | 'needsPin' | 'verified'
  >('loading');
  const [pinGateRecipient, setPinGateRecipient] = useState<string | null>(null);
  const [playbookName, setPlaybookName] = useState<string | undefined>(undefined);
  const [subjectDiscipline, setSubjectDiscipline] = useState<string | undefined>(undefined);
  const [modulesAuthored, setModulesAuthored] = useState<boolean>(false);
  // #274 Slice C: hold the authored module list so the picker-selection
  // banner can display a human label instead of the raw id.
  const [authoredModules, setAuthoredModules] = useState<Array<{ id: string; label?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  // #396: parent-owned "is a call live?" flag so the SimStateBreadcrumb pill
  // reads "(Active)" while the user is mid-call instead of always "(Pre-call)".
  const [isCallActive, setIsCallActive] = useState(false);

  // Journey chat — unified WhatsApp-style survey/onboarding/teaching flow
  // Only runs for LEARNER callers; waits for caller data before deciding.
  const journey = useJourneyChat({ callerId, forceFirstCall, callerRole: caller?.role });

  // #948 — auto-resolve playbookId from the caller's active enrollments
  // when the URL didn't pass one explicitly. Delegates to the shared L9
  // resolver via `/api/callers/[id]/active-playbook` so the pick rule lives
  // in one place. See docs/CHAIN-CONTRACTS.md Link L9 + the helper at
  // lib/caller/resolve-active-playbook.ts.
  useEffect(() => {
    if (urlPlaybookId) return; // URL already provided it — playbookId derives from it directly
    let cancelled = false;
    fetch(`/api/callers/${callerId}/active-playbook`)
      .then((r) => r.json())
      .then((result) => {
        if (cancelled || !result?.ok) return;
        if (result.playbookId) {
          setEnrollmentPlaybookId(result.playbookId);
        }
      })
      .catch(() => { /* non-fatal: page still renders, just without module picker */ });
    return () => { cancelled = true; };
  }, [callerId, urlPlaybookId]);

  // #1245 — persist the picker round-trip. When the URL carries a
  // `?requestedModuleId=` the learner just picked (or re-picked via
  // "Switch module"), write it to `Caller.lastSelectedModuleId` so the
  // next visit (no URL param) restores the choice. Fire-and-forget —
  // a persistence failure must not break the sim. Skipped when the URL
  // value matches what's already persisted (avoids the no-op POST on
  // every render after the page hydrates).
  useEffect(() => {
    if (!urlRequestedModuleId) return;
    if (urlRequestedModuleId === lastSelectedModuleId) return;
    let cancelled = false;
    fetch(`/api/callers/${callerId}/last-selected-module`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ moduleId: urlRequestedModuleId }),
    })
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        if (result?.ok) {
          setLastSelectedModuleId(urlRequestedModuleId);
        }
      })
      .catch(() => { /* non-fatal — sim still works from URL param */ });
    return () => { cancelled = true; };
  }, [callerId, urlRequestedModuleId, lastSelectedModuleId]);

  useEffect(() => {
    let cancelled = false;

    // #1247 — post-enrol /intake/done → /x/sim race. First fetch can
    // surface "Caller not found" while the sidebar's separate fetch
    // (which fires fractionally later) sees the newly-created caller.
    // Hard refresh fixes it permanently. Defensive retry: on the first
    // 403/404, wait 300ms and try once more with `cache: 'no-store'`.
    // If the row really doesn't exist the second 404 surfaces the
    // error as before; if it's the race, the second hit lands clean.
    // Console breadcrumb so we can detect any recurring window in dev
    // / staging logs.
    async function fetchCallerOnce(noCache: boolean) {
      return fetch(`/api/callers/${callerId}`, noCache ? { cache: 'no-store' } : undefined);
    }

    async function fetchCaller() {
      try {
        let res = await fetchCallerOnce(false);
        if ((res.status === 403 || res.status === 404) && !cancelled) {
          console.warn(
            `[sim/page] caller fetch returned ${res.status} on first try (callerId=${callerId}) — retrying after 300ms (#1247 defensive retry)`,
          );
          await new Promise((r) => setTimeout(r, 300));
          if (cancelled) return;
          res = await fetchCallerOnce(true);
        }
        if (res.status === 401) {
          if (!cancelled) {
            router.push(`/login?callbackUrl=${encodeURIComponent(`/x/sim/${callerId}`)}`);
          }
          return;
        }
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
          // #1245 — restore the picker state from the persisted pick.
          // No URL param? Use Caller.lastSelectedModuleId (set on the
          // previous picker round-trip via POST below). When both are
          // present the URL param wins (acts as an explicit override).
          if (typeof data.caller.lastSelectedModuleId === 'string') {
            setLastSelectedModuleId(data.caller.lastSelectedModuleId);
          }

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
                  // #274 Slice C: capture authored modules so the banner can
                  // resolve the picked module's label (not just the id).
                  if (Array.isArray(cfg.modules)) {
                    setAuthoredModules(cfg.modules);
                  }
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
  }, [callerId, expectedDomainId, playbookId, router]);

  // #1101 — fetch challenge status once we know the session role. Skip for
  // OPERATOR+ so admin browsing of a learner's sim page is unaffected.
  // HOTFIX: previously gated on `isStudent` while session was still loading,
  // which set pinGateStatus='verified' eagerly. Now wait for the session to
  // RESOLVE before deciding (status === 'loading' → stay in 'loading'); also
  // fail CLOSED on non-JSON / non-ok responses (was: silently treat as
  // verified, which masked auth middleware 307 redirects).
  useEffect(() => {
    if (sessionStatus === 'loading') return; // wait — don't pre-decide
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
          // Server replied but not in the expected shape — gate fail-closed
          // so we never silently let a real learner skip the PIN.
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
        // Network/redirect/parse failure — fail CLOSED. Better to show a PIN
        // gate the learner can't bypass than silently let them past.
        console.warn('[pin-gate] challenge-status fetch failed:', err);
        setPinGateRecipient(null);
        setPinGateStatus('needsPin');
      });
    return () => {
      cancelled = true;
    };
  }, [callerId, gateAsStudent, sessionStatus]);

  const handleStudentCallEnd = useCallback(() => {
    if (isStudent) {
      setTimeout(() => router.push('/x/student'), 1500);
    }
    // Journey onCallEnd is now called directly inside SimChat
  }, [router, isStudent]);

  // #242 Slice 2: must live ABOVE the early returns or React's hook order
  // changes between renders (Rules of Hooks violation).
  // #1248 — module picker is now an inline modal on the sim page.
  // Pre-fix, the rail's "Pick a module" button navigated to
  // /x/student/[playbookId]/modules and back — heavy for a single
  // decision ("pick Unit 04 vs Unit 09"). The dedicated picker page
  // remains available as a deep link via the dialog's "See full
  // picker →" escape (full prereqs, recommendation reasoning, etc.).
  const [moduleSwitcherOpen, setModuleSwitcherOpen] = useState(false);
  const handlePickModule = useCallback(() => {
    if (!playbookId) return;
    setModuleSwitcherOpen(true);
  }, [playbookId]);

  const handleModuleSwitcherPick = useCallback(
    (moduleId: string) => {
      // Replace `?requestedModuleId=` in the URL. The sim page already
      // handles the param-driven recompose + #1245 persistence write.
      const carryParams = new URLSearchParams(searchParams.toString());
      carryParams.set('requestedModuleId', moduleId);
      router.replace(`/x/sim/${callerId}?${carryParams.toString()}`);
    },
    [callerId, router, searchParams],
  );

  const fullPickerHref = useMemo(() => {
    if (!playbookId) return undefined;
    const sp = new URLSearchParams();
    const carryParams = new URLSearchParams(searchParams.toString());
    carryParams.delete('requestedModuleId');
    sp.set('returnTo', `/x/sim/${callerId}${carryParams.toString() ? `?${carryParams.toString()}` : ''}`);
    sp.set('callerId', callerId);
    return `/x/student/${playbookId}/modules?${sp.toString()}`;
  }, [callerId, playbookId, searchParams]);

  // #357 NOTE: an earlier slice auto-routed to the picker on first entry
  // when modulesAuthored=true. That created a trap — user couldn't get
  // back to the sim without picking, even to test an undirected call.
  // Reverted: the banner CTA below is the non-blocking entry instead.

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

  if (!caller || pinGateStatus === 'loading') {
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

  // #1101 — gate first-call STUDENT sessions on PIN verification before the
  // chat renders. OPERATOR+ skip this branch (pinGateStatus pre-set to verified).
  if (pinGateStatus === 'needsPin') {
    const callerFirstName = caller.name?.trim().split(/\s+/)[0];
    return (
      <>
        <WhatsAppHeader title="Verify your code" />
        <FirstCallPinGate
          callerId={callerId}
          recipient={pinGateRecipient}
          callerFirstName={callerFirstName}
          onVerified={() => setPinGateStatus('verified')}
        />
      </>
    );
  }

  return (
    <>
      <SimStateBreadcrumb
        pastCallCount={caller.pastCalls.length}
        activeCall={isCallActive}
        requestedModuleId={requestedModuleId ?? null}
        modules={authoredModules}
        onPickModule={modulesAuthored && playbookId ? handlePickModule : undefined}
      />
      <ModuleQuickSwitcher
        open={moduleSwitcherOpen}
        onClose={() => setModuleSwitcherOpen(false)}
        modules={authoredModules}
        currentModuleId={requestedModuleId ?? null}
        onPick={handleModuleSwitcherPick}
        fullPickerHref={fullPickerHref}
      />
      {/* #1098 Slice C — Qualification context strip (renders only when the
          learner's active Curriculum has a qualificationAnchor). */}
      <QualificationContextStrip requestedModuleId={requestedModuleId ?? null} />
      {requestedModuleId ? (
        <ModulePickerSelectionBanner
          moduleId={requestedModuleId}
          modules={authoredModules}
        />
      ) : modulesAuthored && playbookId ? (
        <ModulePickerInviteBanner
          moduleCount={authoredModules.length}
          onPick={handlePickModule}
        />
      ) : null}
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
        onCallStateChange={setIsCallActive}
        requestedModuleId={requestedModuleId}
        journey={journey}
        onNameChange={(next) => setCaller((prev) => (prev ? { ...prev, name: next } : prev))}
      />
    </>
  );
}

// Banner components moved to components/sim/ModulePickerBanners.tsx (#357)
// so the admin caller-detail surface can reuse them.
