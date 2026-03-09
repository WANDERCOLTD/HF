"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useBranding } from "@/contexts/BrandingContext";
import { showEnvBanner, envSidebarColor, envLabel, envTextColor, isNonProd } from "@/components/shared/EnvironmentBanner";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Link from "next/link";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbackUrl = "/x";
  const { branding } = useBranding();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn("credentials", {
        email,
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

      {/* Login Card */}
      <div className="login-form-card">
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="email" className="login-label">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="login-input"
            />
          </div>

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

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            disabled={isLoading || !email || !password}
            className="login-btn"
            style={branding.primaryColor ? { background: branding.primaryColor } : undefined}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <div className="login-footer">
          Admin access only. Testers use their invite link.
        </div>
      </div>

      {/* Demo Accounts Panel — non-prod only */}
      {isNonProd && (
        <DemoAccountsPanel
          onLogin={(demoEmail, demoPassword) => {
            setEmail(demoEmail);
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
