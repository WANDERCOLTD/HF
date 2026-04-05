"use client";

/**
 * SuccessCard — post-creation action card shown after a course is built.
 *
 * Extracted from ConversationalWizard to reduce file size.
 * Shows: view course, try practice call, copy link, create another, dashboard.
 */

import { Check, Headphones, BookMarked, Link2, Plus, Users, GraduationCap } from "lucide-react";

interface SuccessCardProps {
  draftCallerId: string | undefined;
  draftCallerName: string | undefined;
  draftDemoCallerId: string | undefined;
  draftDemoCallerName: string | undefined;
  draftPlaybookId: string | undefined;
  draftDomainId: string;
  communityJoinToken: string | undefined;
  confirmReset: boolean;
  linkCopied: boolean;
  onStartOver: () => void;
  onConfirmReset: () => void;
  onCopyLink: (url: string, key: string) => void;
}

/** Build a /join URL with pre-filled learner fields so the form auto-submits. */
function buildJoinUrl(origin: string, token: string, playbookId?: string, callerName?: string): string {
  const params = new URLSearchParams();
  if (playbookId) params.set("course", playbookId);

  const parts = (callerName || "Test Caller").split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(" ") || "Tester";
  params.set("firstName", first);
  params.set("lastName", last);
  params.set("email", `${first.toLowerCase()}.${last.toLowerCase().replace(/\s+/g, "")}@tryit.example.com`);

  return `${origin}/join/${token}?${params.toString()}`;
}

export function SuccessCard({
  draftCallerId,
  draftCallerName,
  draftDemoCallerId,
  draftDemoCallerName,
  draftPlaybookId,
  draftDomainId,
  communityJoinToken,
  confirmReset,
  linkCopied,
  onStartOver,
  onConfirmReset,
  onCopyLink,
}: SuccessCardProps) {
  return (
    <div className="cv4-success-card">
      <div className="cv4-success-title">Your AI tutor is ready</div>
      <div className="cv4-success-sub">
        {draftCallerId
          ? "View your course, share it with someone, or try it out."
          : "View your course or head to your dashboard."}
      </div>
      <div className="cv4-success-actions">
        {/* Primary — view course (always show; fall back to course list) */}
        <a
          href={draftPlaybookId ? `/x/courses/${draftPlaybookId}` : "/x/courses"}
          target="_blank"
          rel="noopener noreferrer"
          className="hf-btn hf-btn-primary cv4-success-primary"
        >
          <BookMarked size={16} /> View Your Course
        </a>

        {/* Test callers — each with practice call link */}
        {(draftCallerId || draftDemoCallerId) && (
          <div className="cv4-success-callers">
            <div className="cv4-success-callers-label">
              <Users size={14} /> Test Learners
            </div>
            {draftDemoCallerId && (
              <div className="cv4-success-row">
                <a
                  href={`/x/callers/${draftDemoCallerId}`}
                  className="hf-btn hf-btn-secondary cv4-success-btn-half"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {draftDemoCallerName || "Demo Caller"} <span className="hf-text-xs hf-text-muted">(ready)</span>
                </a>
                <a
                  href={`/x/sim/${draftDemoCallerId}?${new URLSearchParams({
                    ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                    ...(draftDomainId ? { domainId: draftDomainId } : {}),
                  }).toString()}`}
                  className="hf-btn hf-btn-secondary cv4-success-btn-half"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Headphones size={14} /> Try a Practice Call
                </a>
              </div>
            )}
            {draftCallerId && (
              <div className="cv4-success-row">
                <a
                  href={`/x/callers/${draftCallerId}`}
                  className="hf-btn hf-btn-secondary cv4-success-btn-half"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {draftCallerName || "Test Caller"} <span className="hf-text-xs hf-text-muted">(new)</span>
                </a>
                <a
                  href={communityJoinToken
                    ? buildJoinUrl("", communityJoinToken, draftPlaybookId, draftCallerName)
                    : `/x/sim/${draftCallerId}?${new URLSearchParams({
                        ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                        ...(draftDomainId ? { domainId: draftDomainId } : {}),
                      }).toString()}`}
                  className="hf-btn hf-btn-secondary cv4-success-btn-half"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GraduationCap size={14} /> Try the Learner Journey
                </a>
              </div>
            )}
          </div>
        )}

        {/* Copy link */}
        <div className="cv4-success-row">
          {(communityJoinToken || draftCallerId) && (
            <button
              type="button"
              className="hf-btn hf-btn-secondary cv4-success-btn-half"
              onClick={() => {
                const tryItUrl = communityJoinToken
                  ? buildJoinUrl(window.location.origin, communityJoinToken, draftPlaybookId, draftCallerName)
                  : `${window.location.origin}/x/sim/${draftCallerId}?${new URLSearchParams({
                      ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                      ...(draftDomainId ? { domainId: draftDomainId } : {}),
                    }).toString()}`;
                onCopyLink(tryItUrl, "tryit");
              }}
            >
              {linkCopied ? <><Check size={14} /> Copied!</> : <><Link2 size={14} /> Copy Try-It Link</>}
            </button>
          )}
        </div>

        {/* Tertiary — create another + dashboard */}
        <div className="cv4-success-row">
          <button
            type="button"
            className="hf-btn hf-btn-secondary cv4-success-btn-half"
            onClick={() => {
              if (!confirmReset) { onConfirmReset(); return; }
              onStartOver();
            }}
          >
            {confirmReset
              ? "Confirm — Start Fresh"
              : <><Plus size={14} /> Create Another Course</>}
          </button>
        </div>

        {/* Dashboard — text link, opens new tab */}
        <a
          href={draftDomainId ? `/x/educator` : "/x"}
          target="_blank"
          rel="noopener noreferrer"
          className="cv4-success-link"
        >
          Go to Dashboard &rarr;
        </a>
      </div>
    </div>
  );
}
