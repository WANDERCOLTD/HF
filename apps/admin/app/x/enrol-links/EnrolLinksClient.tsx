"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Users,
  School,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

interface Cohort {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  joinToken: string | null;
  joinTokenExp: string | null;
  domain: { id: string; slug: string; name: string };
  owner: { id: string; name: string | null; email: string | null };
  _count: { members: number };
}

interface CohortsResponse {
  ok: boolean;
  cohorts: Cohort[];
  total: number;
}

export function EnrolLinksClient() {
  const { data, isLoading, error } = useApi<CohortsResponse>(
    "/api/cohorts?isActive=true&limit=500",
  );
  const { copiedKey, copy } = useCopyToClipboard();
  const [origin, setOrigin] = useState<string>("");

  // We build absolute URLs so the operator can paste them into a fresh
  // incognito window with no session leakage. Use the current window's
  // origin so the link points at the same env the operator is on
  // (localhost via tunnel, dev.humanfirstfoundation.com, etc.). #1120
  // hotfix already made the email PIN link follow the same rule.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const rows = useMemo(() => {
    const cohorts = data?.cohorts ?? [];
    const base = origin || "";
    return cohorts
      .filter((c) => c.joinToken)
      .map((c) => ({
        ...c,
        v1Url: `${base}/intake/enrollment-crawcus/${c.joinToken}`,
        v2Url: `${base}/intake/v2/${c.joinToken}`,
        expired:
          c.joinTokenExp !== null && new Date(c.joinTokenExp) < new Date(),
      }));
  }, [data, origin]);

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 className="hf-page-title" style={{ marginBottom: 4 }}>
          Test Enrolment Links
        </h1>
        <p className="hf-section-desc" style={{ margin: 0 }}>
          Copy a cohort's enrolment URL, then paste it into a{" "}
          <strong>Private Browsing</strong> window (so your admin session
          doesn't leak into the chat). Use a fresh email each time so you
          don't collide with prior test runs.
        </p>
      </header>

      <div
        className="hf-banner"
        style={{
          marginBottom: 20,
          padding: 12,
          background: "var(--bg-info-subtle, #eff6ff)",
          border: "1px solid var(--border-info, #bfdbfe)",
          borderRadius: 8,
          color: "var(--text-info, #1e40af)",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <strong>Why incognito?</strong> The intake chat captures your
        email. If you're signed in as an admin, that admin email auto-fills
        the join form (issue #1121) and the test learner's data gets
        overwritten. A Private Browsing window has no session, so the chat
        starts clean.
      </div>

      {isLoading && (
        <div className="hf-section-desc">Loading cohorts…</div>
      )}

      {error && (
        <div
          className="hf-banner hf-banner-error"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <AlertCircle size={16} />
          <span>Could not load cohorts: {String(error)}</span>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <div className="hf-section-desc">
          No active cohorts with enrolment tokens were found in your scope.
        </div>
      )}

      {rows.length > 0 && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          data-testid="enrol-links-list"
        >
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                border: "1px solid var(--border-default, #e4e4e7)",
                borderRadius: 8,
                padding: 16,
                background: "var(--bg-surface, #fff)",
                opacity: row.expired ? 0.55 : 1,
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    margin: "0 0 4px",
                    color: "var(--text-primary)",
                  }}
                >
                  {row.name}
                </h3>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 13,
                    color: "var(--text-muted, #71717a)",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <School size={13} />
                    {row.domain.name}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Users size={13} />
                    {row._count.members} learner
                    {row._count.members === 1 ? "" : "s"}
                  </span>
                  {row.expired && (
                    <span style={{ color: "var(--text-danger, #b91c1c)", fontWeight: 500 }}>
                      Token expired
                    </span>
                  )}
                </div>
              </div>

              <LinkLine
                label="V1 (chat-first)"
                url={row.v1Url}
                copyKey={`${row.id}-v1`}
                copiedKey={copiedKey}
                onCopy={copy}
                disabled={row.expired}
              />
              <div style={{ height: 8 }} />
              <LinkLine
                label="V2 (auth-first)"
                url={row.v2Url}
                copyKey={`${row.id}-v2`}
                copiedKey={copiedKey}
                onCopy={copy}
                disabled={row.expired}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LinkLineProps {
  label: string;
  url: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  disabled: boolean;
}

function LinkLine({ label, url, copyKey, copiedKey, onCopy, disabled }: LinkLineProps) {
  const isCopied = copiedKey === copyKey;
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "var(--text-muted, #71717a)",
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => onCopy(url, copyKey)}
            disabled={disabled}
            className="hf-btn hf-btn-secondary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              fontSize: 12,
              minWidth: 80,
              justifyContent: "center",
            }}
            aria-label={`Copy ${label} link`}
          >
            {isCopied ? (
              <>
                <Check size={12} /> Copied
              </>
            ) : (
              <>
                <Copy size={12} /> Copy
              </>
            )}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="hf-btn hf-btn-secondary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              fontSize: 12,
              textDecoration: "none",
            }}
            aria-label={`Open ${label} link in a new tab`}
            title="Opens in a regular new tab — drag to a Private Browsing window for a clean session"
          >
            <ExternalLink size={12} /> Open
          </a>
        </div>
      </div>
      <code
        style={{
          display: "block",
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "var(--text-muted, #52525b)",
          background: "var(--bg-subtle, #f4f4f5)",
          padding: "4px 8px",
          borderRadius: 4,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {url}
      </code>
    </div>
  );
}
