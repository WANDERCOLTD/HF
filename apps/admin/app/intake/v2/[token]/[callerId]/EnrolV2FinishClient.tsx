"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FirstCallPinGate } from "@/components/identity/FirstCallPinGate";
import { EnrollmentChat } from "@/components/intake/EnrollmentChat";

interface Props {
  token: string;
  callerId: string;
  email: string;
  cohortName: string;
  domainName: string;
}

type Stage =
  | { kind: "loading" }
  | { kind: "gate"; recipient: string | null }
  | { kind: "chat" }
  | { kind: "no-active-challenge" };

/**
 * V2 finish flow client (#1141 Story 2). Renders the FirstCallPinGate
 * if there's an unverified challenge for this caller; once verified,
 * renders EnrollmentChat with the email pre-populated so the AI only
 * asks for the missing fields (name, age, disclosures).
 *
 * When the chat commits the projection, the chat itself navigates the
 * window to /intake/done?intentId=...&token=... per the existing flow.
 * From there the "Continue to course" button goes to /join/[token] which
 * detects the existing caller in this cohort and redirects to /x/sim.
 */
export function EnrolV2FinishClient({
  token,
  callerId,
  email,
  cohortName,
  domainName,
}: Props) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  useEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/identity/challenge-status?callerId=${encodeURIComponent(callerId)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) throw new Error("non-JSON");
        const data = await res.json();
        if (cancelled) return;
        if (!data?.ok) {
          setStage({ kind: "no-active-challenge" });
          return;
        }
        if (data.needsPin) {
          setStage({ kind: "gate", recipient: data.recipient ?? null });
        } else {
          setStage({ kind: "chat" });
        }
      } catch {
        if (!cancelled) setStage({ kind: "no-active-challenge" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callerId, sessionStatus]);

  if (stage.kind === "loading") {
    return (
      <div style={loadingStyle}>
        <div className="hf-spinner" style={{ width: 28, height: 28 }} />
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  if (stage.kind === "no-active-challenge") {
    return (
      <div style={loadingStyle}>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          We couldn't find a sign-in code for this enrolment. Start over —
        </p>
        <button
          type="button"
          className="hf-btn-primary"
          onClick={() => router.push(`/intake/v2/${token}`)}
          style={{ marginTop: 12 }}
        >
          Start sign-in again
        </button>
      </div>
    );
  }

  if (stage.kind === "gate") {
    return (
      <>
        <header style={headerStyle}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>
            {cohortName}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            {domainName}
          </p>
        </header>
        <FirstCallPinGate
          callerId={callerId}
          recipient={stage.recipient ?? email}
          callerFirstName={undefined}
          onVerified={() => setStage({ kind: "chat" })}
        />
      </>
    );
  }

  // Verified — hand off to the spec-driven chat with email prefilled.
  return (
    <EnrollmentChat
      classroomToken={token}
      prefilledValues={{ email }}
    />
  );
}

const loadingStyle: React.CSSProperties = {
  minHeight: "60vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
};

const headerStyle: React.CSSProperties = {
  padding: "16px 24px",
  borderBottom: "1px solid var(--border-default, #e4e4e7)",
  background: "var(--bg-surface, #fff)",
};
