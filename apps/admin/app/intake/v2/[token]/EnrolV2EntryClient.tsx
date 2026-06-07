"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Mail, Phone, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  token: string;
  cohortName: string;
  domainName: string;
  institutionName: string | null;
}

// OPERATOR+ levels for the admin escape hatch. Mirror of the set in
// FirstCallPinGate so the two surfaces gate identically.
const ADMIN_SKIP_ROLES = new Set([
  "OPERATOR",
  "EDUCATOR",
  "ADMIN",
  "SUPERADMIN",
]);

export function EnrolV2EntryClient({
  token,
  cohortName,
  domainName,
  institutionName,
}: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const sessionRole = session?.user?.role ?? null;
  // OPERATOR+ session sees an "Admin: continue as test caller" button
  // that skips email + PIN entry entirely. Creates a synthetic test
  // User+Caller server-side, keeps the admin's session cookie
  // (does NOT mint a new one), navigates to /x/sim/<callerId>.
  // STUDENT/VIEWER sessions never render the affordance.
  const showAdminSkip =
    typeof sessionRole === "string" && ADMIN_SKIP_ROLES.has(sessionRole);

  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminSkipPending, setAdminSkipPending] = useState(false);
  const [adminSkipError, setAdminSkipError] = useState<string | null>(null);

  // Auto-detection — presence of '@' wins. Below the input we surface
  // a one-line hint so the learner knows what we'll do with their input.
  const detected = useMemo<"email" | "phone" | "unknown">(() => {
    if (contact.trim().length === 0) return "unknown";
    if (contact.includes("@")) return "email";
    if (/^[+\d\s()-]+$/.test(contact)) return "phone";
    return "unknown";
  }, [contact]);

  async function handleAdminSkip() {
    if (adminSkipPending) return;
    setAdminSkipPending(true);
    setAdminSkipError(null);
    try {
      const res = await fetch("/api/intake/v2/admin-test-enrol", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classroomToken: token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data?.redirect) {
        router.push(data.redirect);
        return;
      }
      if (res.status === 401) {
        setAdminSkipError(
          "Your session can't create a test caller (OPERATOR+ only). Sign in as admin first.",
        );
        return;
      }
      setAdminSkipError(data?.error ?? `Couldn't create test caller (${res.status}).`);
    } catch {
      setAdminSkipError("Network error — try again.");
    } finally {
      setAdminSkipPending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/intake/v2/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classroomToken: token,
          contact: contact.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // Navigate to the gate + chat-to-complete URL. The route uses the
      // same token + the new callerId so a refresh after PIN entry stays
      // on the same surface.
      router.push(data.gatePath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg-default, #fafafa)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--bg-surface, #fff)",
          borderRadius: 12,
          padding: 32,
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          {institutionName && (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              {institutionName}
            </p>
          )}
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              margin: "0 0 6px",
              color: "var(--text-primary)",
            }}
          >
            Join {cohortName}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: "var(--text-muted)",
              lineHeight: 1.4,
            }}
          >
            {domainName} · sign in to begin
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="contact-input"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 6,
            }}
          >
            Your email
          </label>
          <input
            id="contact-input"
            type="text"
            inputMode="email"
            autoComplete="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            disabled={submitting}
            required
            placeholder="you@example.com"
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 16,
              border: "1px solid var(--border-default, #d4d4d8)",
              borderRadius: 8,
              boxSizing: "border-box",
              marginBottom: 6,
            }}
          />
          {detected !== "unknown" && (
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 12,
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {detected === "email" ? (
                <>
                  <Mail size={12} /> We'll email you a 6-digit code.
                </>
              ) : (
                <>
                  <Phone size={12} /> Phone sign-in is coming soon — please use email for now.
                </>
              )}
            </p>
          )}

          {error && (
            <div
              style={{
                margin: "12px 0",
                padding: 10,
                fontSize: 13,
                color: "var(--text-danger, #b91c1c)",
                background: "var(--bg-danger-subtle, #fef2f2)",
                border: "1px solid var(--border-danger, #fecaca)",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || detected === "phone" || contact.trim().length === 0}
            className="hf-btn-primary"
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: 15,
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="hf-spinner" /> Sending code…
              </>
            ) : (
              "Send my code"
            )}
          </button>

          <p
            style={{
              marginTop: 18,
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            By continuing you agree to receive a sign-in code by email and
            to the privacy notice you'll see on the next screen.
          </p>
        </form>

        {showAdminSkip ? (
          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px dashed var(--border-default, #e4e4e7)",
            }}
            data-testid="enrol-v2-admin-skip-block"
          >
            <button
              type="button"
              onClick={handleAdminSkip}
              disabled={adminSkipPending}
              data-testid="enrol-v2-admin-skip"
              className="hf-btn hf-btn-secondary"
              style={{ width: "100%", padding: "10px 14px", fontSize: 13 }}
            >
              {adminSkipPending
                ? "Creating test caller…"
                : `Admin: continue as test caller (you're signed in as ${sessionRole})`}
            </button>
            {adminSkipError ? (
              <p
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "var(--text-danger, #b91c1c)",
                  lineHeight: 1.4,
                }}
                role="alert"
              >
                {adminSkipError}
              </p>
            ) : null}
            <p
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "var(--text-muted)",
                lineHeight: 1.4,
              }}
            >
              Skips email + PIN. Creates a synthetic Test/Admin caller in this
              classroom, keeps your admin session, drops you on
              /x/sim/&lt;callerId&gt; for browsing as yourself.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
