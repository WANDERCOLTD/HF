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
    return cohorts
      .filter((c) => c.joinToken)
      .map((c) => ({
        ...c,
        url: origin
          ? `${origin}/intake/enrollment-crawcus/${c.joinToken}`
          : `/intake/enrollment-crawcus/${c.joinToken}`,
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
          {rows.map((row) => {
            const isCopied = copiedKey === row.id;
            return (
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
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 16,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <School size={13} />
                        {row.domain.name}
                      </span>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Users size={13} />
                        {row._count.members} learner
                        {row._count.members === 1 ? "" : "s"}
                      </span>
                      {row.expired && (
                        <span
                          style={{
                            color: "var(--text-danger, #b91c1c)",
                            fontWeight: 500,
                          }}
                        >
                          Token expired
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => copy(row.url, row.id)}
                      disabled={row.expired}
                      className="hf-btn hf-btn-secondary"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        fontSize: 13,
                        minWidth: 84,
                        justifyContent: "center",
                      }}
                      aria-label={`Copy enrolment link for ${row.name}`}
                    >
                      {isCopied ? (
                        <>
                          <Check size={14} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={14} /> Copy
                        </>
                      )}
                    </button>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hf-btn hf-btn-secondary"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                      aria-label={`Open enrolment link for ${row.name} in a new tab`}
                      title="Opens in a regular new tab — drag to a Private Browsing window for a clean session"
                    >
                      <ExternalLink size={14} /> Open
                    </a>
                  </div>
                </div>

                <code
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    color: "var(--text-muted, #52525b)",
                    background: "var(--bg-subtle, #f4f4f5)",
                    padding: "6px 10px",
                    borderRadius: 4,
                    overflowX: "auto",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.url}
                </code>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
