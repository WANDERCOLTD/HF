"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useBranding } from "@/contexts/BrandingContext";
import { showEnvBanner, envSidebarColor, envLabel, envTextColor, isNonProd } from "@/components/shared/EnvironmentBanner";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Link from "next/link";

interface ProviderInfo {
  id: string;
  name: string;
  type: string;
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

type SignInMode = "magic" | "password";

// OAuth provider IDs we know how to render with brand-specific UI.
// Anything else (apple, github, etc.) falls through to a generic button.
const OAUTH_BUTTONS: Record<string, { label: string; bg: string; fg: string }> = {
  google: { label: "Continue with Google", bg: "#fff", fg: "#1f1f1f" },
  "microsoft-entra-id": {
    label: "Continue with Microsoft",
    bg: "#2f2f2f",
    fg: "#fff",
  },
};

export default function LoginPage() {
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  // Magic-link is the default best-practice flow for returning users
  // (Slack / Notion / Vercel pattern). Password is the escape hatch for
  // admins + the demo accounts. EmailProvider is already wired in
  // lib/auth.ts line 115; this page just exposes it.
  const [mode, setMode] = useState<SignInMode>("magic");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const callbackUrl = "/x";
  const { branding } = useBranding();

  // Iterate /api/auth/providers — OAuth providers are only listed if
  // their env vars are present, so this also drives whether the OAuth
  // buttons appear at all.
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((data) => setProviders(data ?? {}))
      .catch(() => setProviders({}));
  }, []);

  const oauthProviders = useMemo(
    () =>
      Object.values(providers).filter((p) => p.type === "oauth"),
    [providers],
  );

  // Auto-detect — @ = email, else phone (digits / +). Same heuristic the
  // V2 entry uses (#1150). Phone is rejected for now with a clean
  // "coming soon" message; the route is in place for when SMS lands.
  const detected = useMemo<"email" | "phone" | "unknown">(() => {
    if (contact.trim().length === 0) return "unknown";
    if (contact.includes("@")) return "email";
    if (/^[+\d\s()-]+$/.test(contact)) return "phone";
    return "unknown";
  }, [contact]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (detected === "phone") {
      setError("Phone sign-in is coming soon. Please use email for now.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await signIn("email", {
        email: contact,
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setError(
          "Couldn't send a sign-in link to that address. If you've never signed in here, ask your teacher for an invite.",
        );
      } else {
        window.location.href = "/login/verify";
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (detected === "phone") {
      setError("Phone sign-in is coming soon. Please use email for now.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await signIn("credentials", {
        email: contact,
        password,
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid email or password");
      } else if (result?.ok) {
        window.location.href = callbackUrl;
      } else {
        setError("Unexpected response. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOauth = async (providerId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn(providerId, { callbackUrl });
    } catch {
      setError("Couldn't reach the sign-in provider. Try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="login-card w-full max-w-md">
      {/* Environment Banner — non-prod only */}
      {showEnvBanner && envSidebarColor && envLabel && (
        <div
          className="mb-6 rounded-xl px-5 py-3 text-center font-semibold tracking-wide"
          style={{
            background: `color-mix(in srgb, ${envSidebarColor} 20%, transparent)`,
            border: `2px solid ${envSidebarColor}`,
            color: envTextColor || envSidebarColor,
          }}
        >
          <div className="text-lg">{envLabel} ENVIRONMENT</div>
          <div className="mt-1 text-xs font-normal opacity-80">v{APP_VERSION}</div>
        </div>
      )}

      {/* Logo & Brand */}
      <div className="mb-8 text-center">
        {branding.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt={branding.name}
            className="mx-auto mb-4 h-14"
          />
        ) : (
          <div className="login-logo">
            <img src="/icons/icon.svg" alt="HF" className="h-10 w-10 rounded-lg" />
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {branding.name}
        </h1>
        <p className="login-text mt-2 text-sm">
          {branding.welcomeMessage || "Sign in to continue"}
        </p>
      </div>

      {/* Sign-in card — OAuth first, then contact + magic link, then password */}
      <div className="login-form-card">
        {oauthProviders.length > 0 && (
          <div className="space-y-3" style={{ marginBottom: 20 }}>
            {oauthProviders.map((p) => {
              const meta = OAUTH_BUTTONS[p.id] ?? {
                label: `Continue with ${p.name}`,
                bg: "#2f2f2f",
                fg: "#fff",
              };
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleOauth(p.id)}
                  disabled={isLoading}
                  className="login-btn"
                  style={{
                    background: meta.bg,
                    color: meta.fg,
                    border: "1px solid color-mix(in srgb, var(--login-blue) 12%, transparent)",
                  }}
                >
                  {meta.label}
                </button>
              );
            })}
            <div
              style={{
                textAlign: "center",
                margin: "12px 0 4px",
                fontSize: 12,
                color: "var(--login-text-muted)",
              }}
            >
              — or —
            </div>
          </div>
        )}

        <form
          onSubmit={mode === "magic" ? handleMagicLink : handlePasswordLogin}
          className="space-y-5"
        >
          <div>
            <label htmlFor="contact" className="login-label">
              Email or phone
            </label>
            <input
              id="contact"
              type="text"
              inputMode="email"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="you@example.com  ·  +44 7700 900123"
              required
              autoComplete="email"
              className="login-input"
            />
            {detected === "phone" && (
              <p
                className="login-text-muted"
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  color: "color-mix(in srgb, var(--login-text-muted) 80%, transparent)",
                }}
              >
                Phone sign-in is coming soon — please use email for now.
              </p>
            )}
          </div>

          {mode === "password" && (
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="login-label">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="login-text-muted text-xs transition-colors hover:text-white"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                autoComplete="current-password"
                className="login-input"
              />
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            disabled={
              isLoading || !contact || (mode === "password" && !password) || detected === "phone"
            }
            className="login-btn"
            style={branding.primaryColor ? { background: branding.primaryColor } : undefined}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {mode === "magic" ? "Sending link…" : "Signing in…"}
              </span>
            ) : mode === "magic" ? (
              "Send me a sign-in link"
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        {/* Mode toggle. Magic is the default best-practice flow for the
            return-visit case (Slack / Notion / Vercel pattern). Password
            is the escape hatch for admins + demo accounts in non-prod. */}
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "magic" ? "password" : "magic");
              setError(null);
              setPassword("");
            }}
            className="login-text-muted text-xs underline-offset-2 transition-colors hover:text-white hover:underline"
          >
            {mode === "magic"
              ? "Use a password instead"
              : "Use a sign-in link instead"}
          </button>
        </div>

        <div className="login-footer">
          {mode === "magic"
            ? "We'll email you a one-tap sign-in link. No password to remember."
            : "Password is for admins + demo accounts. Learners: switch to sign-in link above."}
        </div>
      </div>

      {/* Demo Accounts Panel — non-prod only */}
      {isNonProd && (
        <DemoAccountsPanel
          onLogin={(demoEmail, demoPassword) => {
            setContact(demoEmail);
            setPassword(demoPassword);
          }}
        />
      )}
    </div>
  );
}

// ── Demo Accounts Panel ─────────────────────────────────

const DEMO_ACCOUNTS = [
  { email: "teach@abacus.com", label: "School", role: "Educator", password: "hff" },
  { email: "corporate@hff.com", label: "Corporate", role: "Educator", password: "hff2026" },
  { email: "training@hff.com", label: "Training", role: "Educator", password: "hff2026" },
];

function DemoAccountsPanel({ onLogin }: { onLogin: (email: string, password: string) => void }) {
  const { copiedKey: copied, copy: copyToClipboard } = useCopyToClipboard(1500);

  return (
    <div
      className="mt-6 rounded-2xl p-6"
      style={{
        background: "color-mix(in srgb, var(--login-navy) 50%, transparent)",
        border: "1px solid color-mix(in srgb, var(--login-blue) 12%, transparent)",
      }}
    >
      <div className="mb-4 text-center">
        <span className="login-text-muted text-xs font-semibold tracking-wider uppercase">
          Demo Accounts
        </span>
      </div>

      <div className="space-y-2">
        {DEMO_ACCOUNTS.map((account) => (
          <div
            key={account.email}
            className="flex items-center justify-between rounded-lg px-3 py-2"
            style={{
              background: "color-mix(in srgb, var(--login-navy-light) 50%, transparent)",
              border: "1px solid color-mix(in srgb, var(--login-blue) 8%, transparent)",
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{account.email}</div>
              <div className="login-text-muted text-[11px]">
                {account.label} &middot; {account.role}
              </div>
            </div>
            <div className="flex items-center gap-1 ml-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => copyToClipboard(account.email, account.email)}
                title="Copy email"
                className="p-1.5 rounded-md transition-colors"
                style={{
                  color: copied === account.email ? "var(--login-success)" : "var(--login-blue)",
                  opacity: copied === account.email ? 1 : 0.5,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onLogin(account.email, account.password)}
                title="Quick login"
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors"
                style={{
                  background: "color-mix(in srgb, var(--login-gold) 20%, transparent)",
                  color: "var(--login-gold)",
                  border: "1px solid color-mix(in srgb, var(--login-gold) 30%, transparent)",
                }}
              >
                Login
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Password row */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="login-text-muted text-[11px]">
          Password: <code className="font-mono">hff2026</code>
        </span>
        <button
          type="button"
          onClick={() => copyToClipboard("hff2026", "password")}
          title="Copy password"
          className="p-1 rounded transition-colors"
          style={{
            color: copied === "password" ? "var(--login-success)" : "var(--login-blue)",
            opacity: copied === "password" ? 1 : 0.4,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
