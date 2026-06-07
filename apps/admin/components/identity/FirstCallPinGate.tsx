'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

interface FirstCallPinGateProps {
  callerId: string;
  recipient: string | null;
  callerFirstName?: string;
  onVerified: () => void;
}

// OPERATOR+ levels for the admin escape hatch. SUPER_TESTER and TESTER
// stay below the cut so they still go through the real PIN flow when
// testing the auth UX itself.
const ADMIN_SKIP_ROLES = new Set([
  'OPERATOR',
  'EDUCATOR',
  'ADMIN',
  'SUPERADMIN',
]);

type VerifyStatus =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string };

type ResendStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'cooldown'; secondsRemaining: number }
  | { kind: 'capReached' };

const COOLDOWN_SECONDS = 60;
const SUCCESS_COPY_FADE_MS = 5000;

function maskRecipient(value: string | null): string {
  if (!value) return 'the email we have on file';
  const at = value.indexOf('@');
  if (at < 2) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const masked = local[0] + '*'.repeat(Math.max(1, local.length - 2)) + local.slice(-1);
  return masked + domain;
}

export function FirstCallPinGate({
  callerId,
  recipient,
  callerFirstName,
  onVerified,
}: FirstCallPinGateProps) {
  const [pin, setPin] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ kind: 'idle' });
  const [resendStatus, setResendStatus] = useState<ResendStatus>({ kind: 'idle' });
  const [successCopyVisible, setSuccessCopyVisible] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [adminSkipPending, setAdminSkipPending] = useState(false);
  const [adminSkipError, setAdminSkipError] = useState<string | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Admin escape hatch: OPERATOR+ session sees a secondary action that
  // marks the challenge verified without entering a PIN. Same end state
  // as a correct PIN (onVerified fires, parent transitions to next
  // step). STUDENT sessions never see this affordance — `role` is null
  // when the user isn't signed in (e.g. the genuine first-call flow on
  // a brand-new caller), so the check is also a privacy gate.
  const { data: session } = useSession();
  const sessionRole = session?.user?.role ?? null;
  const showAdminSkip =
    typeof sessionRole === 'string' && ADMIN_SKIP_ROLES.has(sessionRole);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
      if (successFadeRef.current) clearTimeout(successFadeRef.current);
    };
  }, []);

  function startCooldown(seconds: number) {
    setResendStatus({ kind: 'cooldown', secondsRemaining: seconds });
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setResendStatus((prev) => {
        if (prev.kind !== 'cooldown') return prev;
        const next = prev.secondsRemaining - 1;
        if (next <= 0) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          return { kind: 'idle' };
        }
        return { kind: 'cooldown', secondsRemaining: next };
      });
    }, 1000);
  }

  function showSuccessCopy() {
    setSuccessCopyVisible(true);
    if (successFadeRef.current) clearTimeout(successFadeRef.current);
    successFadeRef.current = setTimeout(() => {
      setSuccessCopyVisible(false);
    }, SUCCESS_COPY_FADE_MS);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (verifyStatus.kind === 'verifying' || isLocked) return;
    if (!/^\d{6}$/.test(pin)) {
      setVerifyStatus({ kind: 'error', message: 'Enter the 6-digit code from your email.' });
      return;
    }
    setVerifyStatus({ kind: 'verifying' });
    try {
      const res = await fetch('/api/identity/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId, pin }),
      });
      const data = await res.json();
      if (data.ok) {
        onVerified();
        return;
      }
      if (data.locked) {
        setIsLocked(true);
        setVerifyStatus({
          kind: 'error',
          message:
            'Your code entry is locked for 24 hours. Requesting a new code won’t unlock it — please contact your teacher.',
        });
        return;
      }
      if (data.expired) {
        setVerifyStatus({
          kind: 'error',
          message: 'This code has expired. Click Resend below for a fresh one.',
        });
        return;
      }
      if (data.noActiveChallenge) {
        setVerifyStatus({
          kind: 'error',
          message: 'No code is waiting for you. Click Resend to get a new one.',
        });
        return;
      }
      const remaining = typeof data.attemptsRemaining === 'number'
        ? data.attemptsRemaining
        : null;
      setVerifyStatus({
        kind: 'error',
        message:
          remaining !== null
            ? `That code didn’t match. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left.`
            : 'That code didn’t match.',
      });
    } catch {
      setVerifyStatus({
        kind: 'error',
        message: 'Couldn’t reach the server. Try again in a moment.',
      });
    }
  }

  async function handleAdminSkip() {
    if (adminSkipPending) return;
    setAdminSkipPending(true);
    setAdminSkipError(null);
    try {
      const res = await fetch('/api/identity/challenge-skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        onVerified();
        return;
      }
      if (data?.noActiveChallenge) {
        setAdminSkipError(
          'No active challenge to skip — hit "Resend code" first, then try again.',
        );
        return;
      }
      if (res.status === 401) {
        setAdminSkipError(
          'Your session can\'t skip the PIN (OPERATOR+ only). Sign in as an admin first.',
        );
        return;
      }
      setAdminSkipError(`Couldn't skip (${res.status}). Try again.`);
    } catch {
      setAdminSkipError('Network error — try again.');
    } finally {
      setAdminSkipPending(false);
    }
  }

  async function handleResend() {
    if (resendStatus.kind !== 'idle') return;
    setResendStatus({ kind: 'sending' });
    try {
      const res = await fetch('/api/identity/resend-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId }),
      });
      const data = await res.json();
      if (data.ok) {
        showSuccessCopy();
        startCooldown(COOLDOWN_SECONDS);
        setVerifyStatus({ kind: 'idle' });
        setPin('');
        return;
      }
      if (data.resendCapReached) {
        setResendStatus({ kind: 'capReached' });
        return;
      }
      if (typeof data.cooldownSecondsRemaining === 'number') {
        startCooldown(data.cooldownSecondsRemaining);
        return;
      }
      setResendStatus({ kind: 'idle' });
    } catch {
      setResendStatus({ kind: 'idle' });
    }
  }

  const verifying = verifyStatus.kind === 'verifying';
  const resendDisabled = resendStatus.kind !== 'idle' || isLocked;
  const resendLabel = (() => {
    switch (resendStatus.kind) {
      case 'sending':
        return 'Sending…';
      case 'cooldown':
        return `Resend in ${resendStatus.secondsRemaining}s`;
      case 'capReached':
        return 'Resend unavailable';
      default:
        return 'Resend code';
    }
  })();

  return (
    <div
      className="wa-chat-bg"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--bg-surface, #fff)',
          border: '1px solid var(--border-default, #e4e4e7)',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>
          {callerFirstName ? `Welcome, ${callerFirstName}` : 'Enter your sign-in code'}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          {`We sent a 6-digit code to ${maskRecipient(recipient)}. Enter it to start your first call.`}
        </p>

        <form onSubmit={handleVerify} noValidate>
          <label
            htmlFor="pin-input"
            style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}
          >
            6-digit code
          </label>
          <input
            id="pin-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={verifying || isLocked}
            style={{
              width: '100%',
              padding: '12px 14px',
              fontSize: 22,
              letterSpacing: 8,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              textAlign: 'center',
              border: '1px solid var(--border-default, #d4d4d8)',
              borderRadius: 8,
              marginBottom: 16,
              boxSizing: 'border-box',
            }}
          />

          <button
            type="submit"
            disabled={verifying || isLocked || pin.length !== 6}
            className="hf-btn-primary"
            style={{ width: '100%', padding: '12px 16px', fontSize: 15 }}
          >
            {verifying ? 'Verifying…' : 'Verify code'}
          </button>
        </form>

        {verifyStatus.kind === 'error' && (
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              color: 'var(--text-danger, #b91c1c)',
              lineHeight: 1.4,
            }}
          >
            {verifyStatus.message}
          </p>
        )}

        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--border-default, #e4e4e7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 32,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {successCopyVisible
              ? 'New code sent — check your email'
              : resendStatus.kind === 'capReached'
                ? 'We’ve sent the code 3 times today. If you didn’t receive it, the email on file may be wrong — contact your teacher.'
                : 'Didn’t get the email?'}
          </span>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendDisabled}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 13,
              color: resendDisabled
                ? 'var(--text-muted, #71717a)'
                : 'var(--text-link, #2563eb)',
              cursor: resendDisabled ? 'default' : 'pointer',
              fontWeight: 500,
            }}
          >
            {resendLabel}
          </button>
        </div>

        {showAdminSkip ? (
          <div
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: '1px dashed var(--border-default, #e4e4e7)',
            }}
            data-testid="first-call-pin-gate-admin-skip-block"
          >
            <button
              type="button"
              onClick={handleAdminSkip}
              disabled={adminSkipPending}
              data-testid="first-call-pin-gate-admin-skip"
              className="hf-btn hf-btn-secondary"
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            >
              {adminSkipPending
                ? 'Skipping PIN…'
                : `Admin: skip PIN (you're signed in as ${sessionRole})`}
            </button>
            {adminSkipError ? (
              <p
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: 'var(--text-danger, #b91c1c)',
                  lineHeight: 1.4,
                }}
                role="alert"
              >
                {adminSkipError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
