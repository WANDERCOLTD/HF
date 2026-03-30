"use client";

/**
 * SuccessCard — post-creation action card shown after a course is built.
 *
 * Extracted from ConversationalWizard to reduce file size.
 * Shows: view course, try practice call, copy link, create another, dashboard.
 */

import { Check, Headphones, BookMarked, Link2, Plus } from "lucide-react";

interface SuccessCardProps {
  draftCallerId: string | undefined;
  draftPlaybookId: string | undefined;
  draftDomainId: string;
  communityJoinToken: string | undefined;
  confirmReset: boolean;
  linkCopied: boolean;
  onStartOver: () => void;
  onConfirmReset: () => void;
  onCopyLink: (url: string, key: string) => void;
}

export function SuccessCard({
  draftCallerId,
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
        {/* Primary — view course */}
        {draftPlaybookId && (
          <a
            href={`/x/courses/${draftPlaybookId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hf-btn hf-btn-primary cv4-success-primary"
          >
            <BookMarked size={16} /> View Your Course
          </a>
        )}

        {/* Secondary row — sharing + sim call */}
        <div className="cv4-success-row">
          {draftCallerId && (
            <a
              href={`/x/sim/${draftCallerId}?${new URLSearchParams({
                forceFirstCall: "true",
                ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                ...(draftDomainId ? { domainId: draftDomainId } : {}),
              }).toString()}`}
              className="hf-btn hf-btn-secondary cv4-success-btn-half"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Headphones size={14} /> Try a Practice Call
            </a>
          )}
          {(communityJoinToken || draftCallerId) && (
            <button
              type="button"
              className="hf-btn hf-btn-secondary cv4-success-btn-half"
              onClick={() => {
                const url = communityJoinToken
                  ? `${window.location.origin}/join/${communityJoinToken}`
                  : `${window.location.origin}/x/sim/${draftCallerId}?${new URLSearchParams({
                      forceFirstCall: "true",
                      ...(draftPlaybookId ? { playbookId: draftPlaybookId } : {}),
                      ...(draftDomainId ? { domainId: draftDomainId } : {}),
                    }).toString()}`;
                onCopyLink(url, "tryit");
              }}
            >
              {linkCopied ? <><Check size={14} /> Copied!</> : <><Link2 size={14} /> Copy Try-It Link</>}
            </button>
          )}
        </div>

        {/* Tertiary — create another */}
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
