'use client';

/**
 * StatusBar — persistent bottom bar consolidating all status indicators.
 *
 * Normal mode:
 *   Left:  [Institution] [ENV badge] [Health RAG] [Calls] [Jobs]
 *   Right: [Spend] [Logs] [Bug] [User] [Version]
 *
 * Masquerade mode (entire bar turns purple):
 *   Left:  [Mask icon + user info + EXIT]
 *   Right: [Bug trigger] [Version]
 *
 * All items are clickable — navigation, popups, or toggles.
 * Hidden on auth/sim/embed pages.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Building2, VenetianMask, X, Bug, Cog, Phone, User, FileText } from 'lucide-react';
import { useBranding } from '@/contexts/BrandingContext';
import { useMasquerade } from '@/contexts/MasqueradeContext';
import { useErrorCapture } from '@/contexts/ErrorCaptureContext';
import { envLabel, envSidebarColor, envTextColor, showEnvBanner, isLocalhost } from './EnvironmentBanner';
import { JobsPopup } from './JobsPopup';
import { HealthPopup } from './HealthPopup';
import type { IniResult } from './HealthPopup';
import { CallsPopup } from './CallsPopup';
import type { ActivityData } from './CallsPopup';
import { VersionPopup } from './VersionPopup';
import { LogViewer } from './LogViewer';

/** Height of the status bar in pixels — use for layout calculations */
export const STATUS_BAR_HEIGHT = 32;

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  EDUCATOR: 'Educator',
  SUPER_TESTER: 'Super Tester',
  TESTER: 'Tester',
  VIEWER: 'Viewer',
  DEMO: 'Demo',
};

const ROLE_LEVEL: Record<string, number> = {
  SUPERADMIN: 5,
  ADMIN: 4,
  OPERATOR: 3,
  SUPER_TESTER: 2,
  TESTER: 1,
  VIEWER: 1,
  DEMO: 0,
};

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

// ── Bug Report bridge ──
// BugReportButton registers its open callback here so StatusBar can trigger it.
type BugReportOpener = () => void;
let bugReportOpener: BugReportOpener | null = null;

export function registerBugReportOpener(fn: BugReportOpener) {
  bugReportOpener = fn;
}
export function unregisterBugReportOpener() {
  bugReportOpener = null;
}

interface SpendData {
  todayCostDollars: number;
  mtdCostDollars: number;
}

export function StatusBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { branding, loading: brandingLoading } = useBranding();
  const { isMasquerading, masquerade, stopMasquerade } = useMasquerade();
  const { errorCount } = useErrorCapture();

  const router = useRouter();

  // ── Refs for popup anchoring ──
  const healthChipRef = useRef<HTMLSpanElement>(null);
  const callsChipRef = useRef<HTMLSpanElement>(null);
  const jobsChipRef = useRef<HTMLSpanElement>(null);
  const logsChipRef = useRef<HTMLSpanElement>(null);
  const versionChipRef = useRef<HTMLSpanElement>(null);

  // ── Popup open states ──
  const [healthPopupOpen, setHealthPopupOpen] = useState(false);
  const [callsPopupOpen, setCallsPopupOpen] = useState(false);
  const [jobsPopupOpen, setJobsPopupOpen] = useState(false);
  const [logsPopupOpen, setLogsPopupOpen] = useState(false);
  const [logsOverlayOpen, setLogsOverlayOpen] = useState(false);
  const [versionPopupOpen, setVersionPopupOpen] = useState(false);

  // ── Data states ──
  // System health — full result for HealthPopup (ADMIN+ only, polls every 120s)
  const [healthData, setHealthData] = useState<IniResult | null>(null);
  const healthRag = healthData?.status ?? null;
  // Deep logging toggle (ADMIN+ only)
  const [deepLogging, setDeepLogging] = useState(false);
  // Active jobs count (OPERATOR+, polls every 20s)
  const [jobsCount, setJobsCount] = useState(0);
  // Status bar data — activity + spend (polls every 60s)
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [spendData, setSpendData] = useState<SpendData | null>(null);

  const userRole = (session?.user?.role as string) || '';
  const roleLevel = ROLE_LEVEL[userRole] ?? 0;
  const isAdmin = roleLevel >= 4;
  const isOperator = roleLevel >= 3;

  // ── Close all popups (only one open at a time) ──
  const closeAllPopups = useCallback(() => {
    setHealthPopupOpen(false);
    setCallsPopupOpen(false);
    setJobsPopupOpen(false);
    setLogsPopupOpen(false);
    setVersionPopupOpen(false);
  }, []);

  // ── System health poll (ADMIN+, every 120s) — stores full IniResult ──
  useEffect(() => {
    if (!isAdmin || !session?.user) return;

    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/system/ini');
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok) setHealthData(data as IniResult);
      } catch {
        // Silent fail
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 120000);
    return () => clearInterval(interval);
  }, [isAdmin, session?.user]);

  // ── Deep logging poll (ADMIN+, every 30s) ──
  useEffect(() => {
    if (!isAdmin || !session?.user) return;

    const fetchDeepLogging = async () => {
      try {
        const res = await fetch('/api/admin/deep-logging');
        if (res.ok) {
          const data = await res.json();
          setDeepLogging(data.enabled);
        }
      } catch {
        // Silent fail
      }
    };

    fetchDeepLogging();
    const interval = setInterval(fetchDeepLogging, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, session?.user]);

  // ── Jobs count poll (OPERATOR+, every 20s) ──
  useEffect(() => {
    if (!isOperator || !session?.user) return;

    const fetchJobsCount = async () => {
      try {
        const res = await fetch('/api/tasks/counts');
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok) setJobsCount(data.counts?.processing ?? 0);
      } catch {
        // Silent fail
      }
    };

    fetchJobsCount();
    const interval = setInterval(fetchJobsCount, 20000);
    return () => clearInterval(interval);
  }, [isOperator, session?.user]);

  // ── Status bar data poll (activity + spend, every 60s) ──
  useEffect(() => {
    if (!session?.user) return;

    const fetchBarData = async () => {
      try {
        const res = await fetch('/api/status/bar');
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok) {
          if (data.activity) setActivityData(data.activity as ActivityData);
          if (data.spend) setSpendData(data.spend as SpendData);
        }
      } catch {
        // Silent fail
      }
    };

    fetchBarData();
    const interval = setInterval(fetchBarData, 60000);
    return () => clearInterval(interval);
  }, [session?.user]);

  // ── Handlers ──
  const handleToggleDeepLogging = useCallback(async () => {
    const newValue = !deepLogging;
    setDeepLogging(newValue); // Optimistic update
    try {
      const res = await fetch('/api/admin/deep-logging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newValue }),
      });
      if (!res.ok) setDeepLogging(!newValue); // Revert on failure
    } catch {
      setDeepLogging(!newValue); // Revert on failure
    }
  }, [deepLogging]);

  const handleBugClick = useCallback(() => {
    bugReportOpener?.();
  }, []);

  // ── Visibility rules — same as sidebar ──
  const isAuthPage = pathname?.startsWith('/login');
  const isSimPage = pathname?.startsWith('/x/sim');
  const isEmbed = searchParams.get('embed') === '1';

  if (isAuthPage || isSimPage || isEmbed || !session?.user) return null;

  const isMasq = isMasquerading && masquerade;
  const hasInstitution = !brandingLoading && branding.name !== 'HumanFirst Foundation';

  // ── Derived display values ──
  const roleLabel = ROLE_LABELS[userRole] || userRole;
  const userDisplayName =
    session.user.name || session.user.email?.split('@')[0] || 'User';

  const callsLabel = activityData
    ? `${activityData.callsToday} today · ${activityData.activeCallers7d} active`
    : '–';

  const spendLabel = spendData
    ? `$${spendData.todayCostDollars.toFixed(2)}`
    : '$–';

  return (
    <div
      className={`hf-status-bar${isMasq ? ' hf-status-bar-masquerade' : ''}`}
      role="status"
      aria-label="Status bar"
    >
      {/* ── Left cluster ── */}
      <div className="hf-status-cluster">
        {isMasq ? (
          <>
            <span className="hf-status-item">
              <VenetianMask size={13} />
              <span className="hf-status-bold">STEPPED IN:</span>
              <span>{masquerade.name || masquerade.email || 'Unknown'}</span>
              <span className="hf-status-separator">&middot;</span>
              <span>{ROLE_LABELS[masquerade.role] || masquerade.role}</span>
              {masquerade.institutionName && (
                <>
                  <span className="hf-status-separator">&middot;</span>
                  <span>{masquerade.institutionName}</span>
                </>
              )}
            </span>
            <button
              className="hf-status-exit-btn"
              onClick={(e) => {
                e.preventDefault();
                stopMasquerade();
              }}
            >
              <X size={11} /> EXIT
            </button>
          </>
        ) : (
          <>
            {/* Institution chip → /x/domains */}
            {hasInstitution && (
              <span
                className="hf-status-item hf-status-clickable"
                onClick={() => router.push('/x/domains')}
                title="View domains"
              >
                <Building2 size={13} />
                <span className="hf-status-bold hf-status-institution-name">
                  {branding.name}
                </span>
                {branding.typeName && (
                  <>
                    <span className="hf-status-separator">&middot;</span>
                    <span>{branding.typeName}</span>
                  </>
                )}
              </span>
            )}

            {/* Environment badge → /x/settings */}
            {showEnvBanner && envLabel && envSidebarColor && (
              <span
                className="hf-status-env-badge hf-status-clickable"
                style={{
                  background: envSidebarColor,
                  ...(envTextColor ? { color: envTextColor } : {}),
                }}
                onClick={() => router.push('/x/settings')}
                title="View settings"
              >
                {isLocalhost() && envLabel === 'DEV' ? 'VM' : envLabel}
              </span>
            )}

            {/* Health RAG → HealthPopup */}
            {isAdmin && healthRag && (
              <span
                ref={healthChipRef}
                className="hf-status-item hf-status-clickable"
                title={`System: ${healthRag} — click for details`}
                onClick={() => {
                  closeAllPopups();
                  setHealthPopupOpen((v) => !v);
                }}
              >
                <span
                  className="hf-status-health-dot"
                  style={{
                    background:
                      healthRag === 'green'
                        ? 'var(--status-success-text)'
                        : healthRag === 'amber'
                          ? 'var(--status-warning-text)'
                          : 'var(--status-error-text)',
                  }}
                />
                <span>
                  {healthRag === 'green'
                    ? 'Healthy'
                    : healthRag === 'amber'
                      ? 'Degraded'
                      : 'Unhealthy'}
                </span>
              </span>
            )}

            {/* Calls chip → CallsPopup (OPERATOR+) */}
            {isOperator && (
              <span
                ref={callsChipRef}
                className="hf-status-item hf-status-clickable"
                onClick={() => {
                  closeAllPopups();
                  setCallsPopupOpen((v) => !v);
                }}
                title="Call activity"
              >
                <Phone size={12} />
                <span>{callsLabel}</span>
              </span>
            )}

            {/* Jobs indicator (OPERATOR+) → JobsPopup */}
            {isOperator && (
              <span
                ref={jobsChipRef}
                className={jobsCount > 0 ? 'hf-status-jobs-chip' : 'hf-status-jobs-chip-idle'}
                onClick={() => {
                  closeAllPopups();
                  setJobsPopupOpen((v) => !v);
                }}
                title={
                  jobsCount > 0
                    ? `${jobsCount} active job${jobsCount !== 1 ? 's' : ''}`
                    : 'Jobs'
                }
              >
                <Cog size={12} className={jobsCount > 0 ? 'hf-status-jobs-spin' : ''} />
                {jobsCount > 0 ? (
                  <span className="hf-status-jobs-badge">
                    {jobsCount > 9 ? '9+' : jobsCount}
                  </span>
                ) : (
                  <span>Jobs</span>
                )}
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Right cluster ── */}
      <div className="hf-status-cluster-right">
        {/* AI Spend → /x/metering (ADMIN+) */}
        {isAdmin && (
          <span
            className="hf-status-item hf-status-clickable"
            onClick={() => router.push('/x/metering')}
            title={spendData ? `Month to date: $${spendData.mtdCostDollars.toFixed(2)}` : 'AI spend'}
          >
            <span>{spendLabel}</span>
          </span>
        )}

        {/* Logs → LogViewer popup (ADMIN+) */}
        {isAdmin && (
          <span
            ref={logsChipRef}
            className={`hf-status-item hf-status-clickable${deepLogging ? ' hf-status-deep-logging-active' : ''}`}
            onClick={() => {
              closeAllPopups();
              setLogsPopupOpen((v) => !v);
            }}
            title={
              deepLogging
                ? 'Logs — deep logging ON (click to peek)'
                : 'Logs (click to peek)'
            }
          >
            <FileText size={12} />
            {deepLogging && (
              <span
                className="hf-status-deep-dot hf-status-deep-dot-active"
              />
            )}
            <span>Logs</span>
          </span>
        )}

        {/* Bug Report trigger (OPERATOR+) */}
        {isOperator && (
          <span
            className="hf-status-item hf-status-clickable"
            onClick={handleBugClick}
            title="Report a bug"
          >
            <Bug size={13} />
            {errorCount > 0 && (
              <span className="hf-status-bug-badge">
                {errorCount > 9 ? '9+' : errorCount}
              </span>
            )}
          </span>
        )}

        {/* User chip → /x/account */}
        {session?.user && (
          <span
            className="hf-status-item hf-status-clickable"
            onClick={() => router.push('/x/account')}
            title="View account"
          >
            <User size={12} />
            <span>
              {userDisplayName}
              <span className="hf-status-separator">&middot;</span>
              {roleLabel}
            </span>
          </span>
        )}

        {/* Version → VersionPopup */}
        {APP_VERSION && (
          <span
            ref={versionChipRef}
            className="hf-status-version hf-status-clickable"
            onClick={() => {
              closeAllPopups();
              setVersionPopupOpen((v) => !v);
            }}
            title="About"
          >
            v{APP_VERSION}
          </span>
        )}
      </div>

      {/* ── Popups (rendered outside clusters, position: fixed, z-index: 100) ── */}
      {isAdmin && (
        <HealthPopup
          open={healthPopupOpen}
          onClose={() => setHealthPopupOpen(false)}
          anchorRef={healthChipRef}
          healthData={healthData}
          ragStatus={healthRag}
        />
      )}

      {isOperator && (
        <CallsPopup
          open={callsPopupOpen}
          onClose={() => setCallsPopupOpen(false)}
          anchorRef={callsChipRef}
          activityData={activityData}
        />
      )}

      {isOperator && (
        <JobsPopup
          open={jobsPopupOpen}
          onClose={() => setJobsPopupOpen(false)}
          anchorRef={jobsChipRef}
        />
      )}

      {isAdmin && (
        <LogViewer
          mode="popup"
          open={logsPopupOpen}
          onClose={() => setLogsPopupOpen(false)}
          anchorRef={logsChipRef}
          deepLogging={deepLogging}
          onToggleDeepLogging={handleToggleDeepLogging}
          onExpand={() => {
            setLogsPopupOpen(false);
            setLogsOverlayOpen(true);
          }}
        />
      )}

      {isAdmin && logsOverlayOpen && (
        <div className="logs-viewer-overlay" onClick={() => setLogsOverlayOpen(false)}>
          <div className="logs-viewer-overlay-inner" onClick={(e) => e.stopPropagation()}>
            <LogViewer
              mode="fullscreen"
              onMinimize={() => {
                setLogsOverlayOpen(false);
                setLogsPopupOpen(true);
              }}
              deepLogging={deepLogging}
              onToggleDeepLogging={handleToggleDeepLogging}
            />
          </div>
        </div>
      )}

      {APP_VERSION && (
        <VersionPopup
          open={versionPopupOpen}
          onClose={() => setVersionPopupOpen(false)}
          anchorRef={versionChipRef}
          version={APP_VERSION}
          roleName={roleLabel}
          institutionName={branding.name}
        />
      )}
    </div>
  );
}
