/**
 * CallerVoiceSurface (#1448) — single shared voice-surface component
 * mounted by both `/x/sim/[callerId]` (standalone layout) and
 * `/x/callers/[id]?tab=ai-call` (embedded layout).
 *
 * Pre-#1448 both pages hand-rolled the wrapper around `<SimChat>` with
 * divergent prop sets — Sim page passed pastCalls / playbookName /
 * subjectDiscipline / sessionGoal / targetOverrides / forceFirstCall /
 * journey / onNameChange; CallerDetailPage's ai-call section passed
 * none of those. The Call tab also forced a remount via `key={callSession}`
 * on every "New call" click — load-bearing because SimChat's internal
 * state (messages, callPhase, streaming) doesn't fully reset between
 * calls without unmount (TL brief, #1448).
 *
 * This component owns: caller fetch, playbook fetch, active-playbook
 * resolver, lastSelectedModuleId persistence, useJourneyChat,
 * isCallActive state, SimStateBreadcrumb / ModulePickerBanners /
 * QualificationContextStrip / ModuleQuickSwitcher / SimChat render,
 * post-call refresh.
 *
 * Layout switch:
 *   - `standalone` — full sim page chrome above us; we render the
 *     SimStateBreadcrumb + banners + SimChat. PIN gate decision lives
 *     in the sim page wrapper (it needs WhatsAppHeader chrome around
 *     the gate). On-error / on-loading states render a chrome-less
 *     spinner/message — caller wraps.
 *   - `embedded` — inside the CallerDetailPage ai-call tab. Same render
 *     tree; no PIN gate (admin context); accepts `onPostCallRefresh`
 *     so the parent can re-fetch its own caller data + prompts on
 *     call-end.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SimChat } from "@/components/sim/SimChat";
import { SimStateBreadcrumb } from "@/components/sim/SimStateBreadcrumb";
import { ModuleQuickSwitcher } from "@/components/sim/ModuleQuickSwitcher";
import {
  ModulePickerSelectionBanner,
  ModulePickerInviteBanner,
} from "@/components/sim/ModulePickerBanners";
import { QualificationContextStrip } from "@/components/sim/qualification/QualificationContextStrip";
import { useJourneyChat } from "@/hooks/useJourneyChat";
import { useResponsive } from "@/hooks/useResponsive";

export interface PastCall {
  transcript: string;
  createdAt: string;
}

export interface CallerInfo {
  name: string;
  role: string;
  domain?: { name?: string | null; slug?: string | null; id?: string | null } | null;
  pastCalls: PastCall[];
}

export interface CallerVoiceSurfaceProps {
  callerId: string;
  layout: "standalone" | "embedded";
  /** STANDALONE-only — passed through to SimChat. */
  sessionGoal?: string;
  /** STANDALONE-only — passed through to SimChat. */
  targetOverrides?: Record<string, number>;
  /** STANDALONE-only — passed through to SimChat. */
  forceFirstCall?: boolean;
  /** STANDALONE-only — passed through to SimChat. Routes back to /x/sim on mobile. */
  onBack?: () => void;
  /**
   * STANDALONE-only — STUDENT-session post-call redirect. Sim page passes
   * a 1.5s `router.push('/x/student')` for learners. Embedded callers
   * (admin) leave this undefined.
   */
  onCallEnd?: () => void;
  /**
   * EMBEDDED — parent's hook to refetch its own caller data + prompts
   * after the call ends, so the broader caller-detail view stays in sync.
   * Called AFTER our internal post-call refresh; no return value matters.
   */
  onPostCallRefresh?: () => void;
  /**
   * Both layouts — community / cohort name override for SimChat header.
   * Sim page reads this from the URL `?communityName=` param; embedded
   * caller leaves it undefined and SimChat falls back to the playbook name.
   */
  communityName?: string;
  /**
   * EMBEDDED — when the embedding page has its own playbook scoping
   * (CallerDetailPage's `selectedPlaybookId` dropdown), pass it here.
   * Overrides our enrollment-resolver fallback. Standalone reads
   * `?playbookId=` from the URL itself.
   */
  playbookIdOverride?: string;
  /** Initial expected-domain assertion (sim page only). */
  expectedDomainId?: string;
  /** Standalone passes a notifier so the sidebar reflects renames. */
  onNameChange?: (next: string) => void;
}

export function CallerVoiceSurface({
  callerId,
  layout,
  sessionGoal,
  targetOverrides,
  forceFirstCall,
  onBack,
  onCallEnd,
  onPostCallRefresh,
  communityName,
  playbookIdOverride,
  expectedDomainId,
  onNameChange,
}: CallerVoiceSurfaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDesktop } = useResponsive();

  // URL → enrollment → override resolution for playbookId.
  // EMBEDDED layout: parent dictates via `playbookIdOverride`; the URL
  // param is ignored because the parent's dropdown is the source of
  // truth. STANDALONE layout: `?playbookId=` first, then the active-
  // enrollment resolver.
  const urlPlaybookId = searchParams.get("playbookId") || undefined;
  const [enrollmentPlaybookId, setEnrollmentPlaybookId] = useState<string | undefined>(undefined);
  const playbookId =
    layout === "embedded"
      ? playbookIdOverride
      : urlPlaybookId ?? enrollmentPlaybookId;

  const urlRequestedModuleId = searchParams.get("requestedModuleId") || undefined;
  const [lastSelectedModuleId, setLastSelectedModuleId] = useState<string | undefined>(undefined);
  const requestedModuleId = urlRequestedModuleId ?? lastSelectedModuleId;

  const [caller, setCaller] = useState<CallerInfo | null>(null);
  const [playbookName, setPlaybookName] = useState<string | undefined>(undefined);
  const [subjectDiscipline, setSubjectDiscipline] = useState<string | undefined>(undefined);
  const [modulesAuthored, setModulesAuthored] = useState<boolean>(false);
  const [authoredModules, setAuthoredModules] = useState<Array<{ id: string; label?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);

  // Load-bearing remount key (#1448 TL brief): incremented when the
  // operator clicks "New call" to ensure SimChat's internal state
  // (messages array, callPhase, streaming) fully resets. Both layouts
  // get this — Sim page previously didn't have it because navigation
  // naturally unmounted, but mid-call → end → new call → mid-call on
  // the SAME page session needs the same hygiene.
  const [callSession, setCallSession] = useState(0);

  // #948 — active-playbook resolver fallback (STANDALONE only).
  useEffect(() => {
    if (layout === "embedded") return;
    if (urlPlaybookId) return;
    let cancelled = false;
    fetch(`/api/callers/${callerId}/active-playbook`)
      .then((r) => r.json())
      .then((result) => {
        if (cancelled || !result?.ok) return;
        if (result.playbookId) setEnrollmentPlaybookId(result.playbookId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [callerId, urlPlaybookId, layout]);

  // #1245 — persist picker round-trip (both layouts).
  useEffect(() => {
    if (!urlRequestedModuleId) return;
    if (urlRequestedModuleId === lastSelectedModuleId) return;
    let cancelled = false;
    fetch(`/api/callers/${callerId}/last-selected-module`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moduleId: urlRequestedModuleId }),
    })
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        if (result?.ok) setLastSelectedModuleId(urlRequestedModuleId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [callerId, urlRequestedModuleId, lastSelectedModuleId]);

  // Caller + past-calls + playbook metadata fetch.
  useEffect(() => {
    let cancelled = false;
    async function fetchCallerOnce(noCache: boolean) {
      return fetch(`/api/callers/${callerId}`, noCache ? { cache: "no-store" } : undefined);
    }
    async function load() {
      try {
        let res = await fetchCallerOnce(false);
        if ((res.status === 403 || res.status === 404) && !cancelled) {
          // #1247 defensive retry — covers the post-enrol /intake/done → /x/sim race.
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
          if (!cancelled) setError("Caller not found");
          return;
        }
        if (cancelled) return;

        const callerDomainId = data.caller.domain?.id || data.caller.domainId;
        if (layout === "standalone" && expectedDomainId && callerDomainId && expectedDomainId !== callerDomainId) {
          setError("Caller is no longer in the expected institution. Please re-select from the wizard.");
          return;
        }
        if (layout === "standalone" && !callerDomainId) {
          setError("Caller has no institution assigned. Please assign one before simulating.");
          return;
        }

        const calls = (data.calls || [])
          .filter((c: { transcript?: string | null }) => c.transcript?.trim())
          .map((c: { transcript: string; createdAt: string }) => ({
            transcript: c.transcript,
            createdAt: c.createdAt,
          }))
          .sort(
            (a: PastCall, b: PastCall) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
        setCaller({
          name: data.caller.name || "Unknown",
          role: data.caller.role || "SIM",
          domain: data.caller.domain,
          pastCalls: calls,
        });
        if (typeof data.caller.lastSelectedModuleId === "string") {
          setLastSelectedModuleId(data.caller.lastSelectedModuleId);
        }

        if (playbookId) {
          fetch(`/api/playbooks/${playbookId}`)
            .then((r) => r.json())
            .then((pbData) => {
              if (cancelled || !pbData.ok) return;
              setPlaybookName(pbData.playbook?.name);
              const cfg = (pbData.playbook?.config as Record<string, unknown>) || {};
              if (typeof cfg.subjectDiscipline === "string") {
                setSubjectDiscipline(cfg.subjectDiscipline);
              }
              setModulesAuthored(cfg.modulesAuthored === true);
              if (Array.isArray(cfg.modules)) {
                setAuthoredModules(cfg.modules as Array<{ id: string; label?: string }>);
              }
            })
            .catch(() => {});
        }
      } catch {
        if (!cancelled) setError("Failed to load caller");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [callerId, expectedDomainId, layout, playbookId, router]);

  // Journey chat — only meaningful for learner callers; the hook itself
  // gates on callerRole internally. Hook is expensive (#1448 TL brief)
  // so we still call it here (single mount point) and pass through.
  const journey = useJourneyChat({
    callerId,
    forceFirstCall,
    callerRole: caller?.role,
  });

  // #1248 — inline ModuleQuickSwitcher modal on both surfaces.
  const [moduleSwitcherOpen, setModuleSwitcherOpen] = useState(false);
  const handlePickModule = useCallback(() => {
    if (!playbookId) return;
    setModuleSwitcherOpen(true);
  }, [playbookId]);

  const handleModuleSwitcherPick = useCallback(
    (moduleId: string) => {
      const carryParams = new URLSearchParams(searchParams.toString());
      carryParams.set("requestedModuleId", moduleId);
      const path = layout === "standalone" ? `/x/sim/${callerId}` : window.location.pathname;
      router.replace(`${path}?${carryParams.toString()}`);
    },
    [callerId, layout, router, searchParams],
  );

  const fullPickerHref = useMemo(() => {
    if (!playbookId) return undefined;
    const sp = new URLSearchParams();
    const carryParams = new URLSearchParams(searchParams.toString());
    carryParams.delete("requestedModuleId");
    const returnTo =
      layout === "standalone"
        ? `/x/sim/${callerId}${carryParams.toString() ? `?${carryParams.toString()}` : ""}`
        : window.location.pathname + (carryParams.toString() ? `?${carryParams.toString()}` : "");
    sp.set("returnTo", returnTo);
    sp.set("callerId", callerId);
    return `/x/student/${playbookId}/modules?${sp.toString()}`;
  }, [callerId, layout, playbookId, searchParams]);

  const handleNameChange = useCallback(
    (next: string) => {
      setCaller((prev) => (prev ? { ...prev, name: next } : prev));
      onNameChange?.(next);
    },
    [onNameChange],
  );

  const handleNewCall = useCallback(() => {
    setCallSession((prev) => prev + 1);
  }, []);

  const handleCallEnd = useCallback(() => {
    onCallEnd?.();
    onPostCallRefresh?.();
  }, [onCallEnd, onPostCallRefresh]);

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <p style={{ color: "var(--text-muted)", textAlign: "center" }}>{error}</p>
      </div>
    );
  }
  if (!caller) {
    return (
      <div className="wa-chat-bg" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <div className="hf-spinner" style={{ width: 28, height: 28 }} />
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading...</p>
      </div>
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
        key={callSession}
        callerId={callerId}
        callerName={caller.name}
        domainName={caller.domain?.name ?? undefined}
        playbookId={playbookId}
        playbookName={communityName ?? playbookName}
        subjectDiscipline={subjectDiscipline}
        pastCalls={caller.pastCalls}
        mode={layout}
        sessionGoal={sessionGoal}
        targetOverrides={targetOverrides}
        forceFirstCall={forceFirstCall || undefined}
        onBack={layout === "standalone" && !isDesktop ? onBack : undefined}
        onCallEnd={handleCallEnd}
        onCallStateChange={setIsCallActive}
        onNewCall={handleNewCall}
        requestedModuleId={requestedModuleId}
        journey={journey}
        onNameChange={handleNameChange}
      />
    </>
  );
}
