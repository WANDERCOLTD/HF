"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

interface ClassroomInfo {
  name: string;
  domain: string;
  teacher: string;
  memberCount: number;
  institutionName?: string | null;
  institutionLogo?: string | null;
  institutionPrimaryColor?: string | null;
  institutionWelcome?: string | null;
  domainWelcome?: string | null;
  isCommunity?: boolean;
}

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [classroom, setClassroom] = useState<ClassroomInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Pre-fill from URL query params (?firstName=X&lastName=Y&email=Z)
  const [firstName, setFirstName] = useState(searchParams.get("firstName") ?? "");
  const [lastName, setLastName] = useState(searchParams.get("lastName") ?? "");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  // Track whether all params were pre-filled for auto-submit
  const autoSubmitRef = useRef(
    !!(searchParams.get("firstName")?.trim() && searchParams.get("lastName")?.trim() && searchParams.get("email")?.includes("@")),
  );

  useEffect(() => {
    fetch(`/api/join/${token}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setClassroom(res.classroom);
        } else {
          setError(res.error ?? "Invalid join link");
        }
      })
      .catch(() => setError("Failed to verify link"))
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-submit when all fields are pre-filled via URL and classroom loaded
  useEffect(() => {
    if (autoSubmitRef.current && classroom && !joining && !joined) {
      autoSubmitRef.current = false; // prevent re-trigger
      handleJoin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroom]);

  const handleJoin = async () => {
    setJoining(true);
    setError("");

    try {
      const res = await fetch(`/api/join/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          ...(searchParams.get("course") ? { playbookId: searchParams.get("course") } : {}),
          ...(searchParams.get("skipOnboarding") === "true" ? { skipOnboarding: true } : {}),
        }),
      });

      const data = await res.json();

      if (data.ok) {
        setJoined(true);
        setTimeout(() => {
          router.push(data.callerId ? `/x/sim/${data.callerId}` : (data.redirect || "/x/sim"));
        }, 1500);
      } else {
        setError(data.error ?? "Failed to join");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setJoining(false);
  };

  const canSubmit = firstName.trim() && lastName.trim() && email.includes("@");

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-secondary)",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--surface-primary)",
          border: "1px solid var(--border-default)",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        {loading || (autoSubmitRef.current && !error) ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 15 }}>
            {loading ? "Verifying link..." : "Joining..."}
          </div>
        ) : error && !classroom ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>😕</div>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
              Link Not Found
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)" }}>{error}</p>
          </div>
        ) : joined ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
              Welcome!
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
              You&apos;ve joined {classroom?.name}. Redirecting...
            </p>
          </div>
        ) : classroom ? (
          <>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              {classroom.institutionLogo ? (
                <img
                  src={classroom.institutionLogo}
                  alt={classroom.institutionName ?? ""}
                  style={{ height: 48, margin: "0 auto 12px", objectFit: "contain" }}
                />
              ) : (
                <div style={{ fontSize: 40, marginBottom: 12 }}>{classroom.isCommunity ? '🤝' : '🏫'}</div>
              )}
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                Join {classroom.name}
              </h1>
              <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
                {classroom.institutionWelcome ?? classroom.domainWelcome ?? (
                  classroom.isCommunity
                    ? `You've been invited to join the ${classroom.name} community`
                    : `${classroom.teacher} has invited you to a learning experience`
                )}
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>
                  First Name
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Your first name"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    fontSize: 14,
                    background: "var(--surface-secondary)",
                    color: "var(--text-primary)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Your last name"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    fontSize: 14,
                    background: "var(--surface-secondary)",
                    color: "var(--text-primary)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    fontSize: 14,
                    background: "var(--surface-secondary)",
                    color: "var(--text-primary)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {error && (
              <div
                style={{
                  padding: 10,
                  background: "color-mix(in srgb, var(--status-error-text) 10%, transparent)",
                  color: "var(--status-error-text)",
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 16,
                  textAlign: "center",
                }}
              >
                {error}
              </div>
            )}

            <button
              disabled={!canSubmit || joining}
              onClick={handleJoin}
              style={{
                width: "100%",
                padding: "12px 20px",
                background: !canSubmit || joining
                  ? "var(--border-default)"
                  : (classroom.institutionPrimaryColor ?? "var(--button-primary-bg)"),
                color: !canSubmit || joining ? "var(--text-muted)" : "var(--button-primary-text)",
                border: "none",
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: !canSubmit || joining ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {joining ? "Joining..." : classroom.isCommunity ? "Join Community" : "Join Classroom"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
