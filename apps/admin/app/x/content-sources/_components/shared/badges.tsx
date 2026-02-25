"use client";

import Link from "next/link";

// ── Constants ─────────────────────────────────────

export const DOCUMENT_TYPES = [
  { value: "TEXTBOOK", label: "Textbook", icon: "\uD83D\uDCD6" },
  { value: "CURRICULUM", label: "Curriculum", icon: "\uD83C\uDF93" },
  { value: "WORKSHEET", label: "Worksheet", icon: "\uD83D\uDCDD" },
  { value: "COMPREHENSION", label: "Comprehension", icon: "\uD83D\uDCDA" },
  { value: "EXAMPLE", label: "Example", icon: "\uD83D\uDCC4" },
  { value: "ASSESSMENT", label: "Assessment", icon: "\u2705" },
  { value: "REFERENCE", label: "Reference", icon: "\uD83D\uDCD1" },
  { value: "LESSON_PLAN", label: "Lesson Plan", icon: "\uD83D\uDCCB" },
  { value: "POLICY_DOCUMENT", label: "Policy Document", icon: "\uD83C\uDFDB\uFE0F" },
  { value: "READING_PASSAGE", label: "Reading Passage", icon: "\uD83D\uDCC3" },
  { value: "QUESTION_BANK", label: "Question Bank", icon: "\u2753" },
];

export const TRUST_LEVELS = [
  { value: "REGULATORY_STANDARD", label: "L5 Regulatory Standard", color: "var(--trust-l5-text)", bg: "var(--trust-l5-bg)" },
  { value: "ACCREDITED_MATERIAL", label: "L4 Accredited Material", color: "var(--trust-l4-text)", bg: "var(--trust-l4-bg)" },
  { value: "PUBLISHED_REFERENCE", label: "L3 Published Reference", color: "var(--trust-l3-text)", bg: "var(--trust-l3-bg)" },
  { value: "EXPERT_CURATED", label: "L2 Expert Curated", color: "var(--trust-l2-text)", bg: "var(--trust-l2-bg)" },
  { value: "AI_ASSISTED", label: "L1 AI Assisted", color: "var(--trust-l1-text)", bg: "var(--trust-l1-bg)" },
  { value: "UNVERIFIED", label: "L0 Unverified", color: "var(--trust-l0-text)", bg: "var(--trust-l0-bg)" },
];

// ── Types ─────────────────────────────────────────

export type ContentSource = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  trustLevel: string;
  documentType: string;
  documentTypeSource: string | null;
  publisherOrg: string | null;
  accreditingBody: string | null;
  accreditationRef: string | null;
  authors: string[];
  isbn: string | null;
  edition: string | null;
  publicationYear: number | null;
  validFrom: string | null;
  validUntil: string | null;
  qualificationRef: string | null;
  moduleCoverage: string[];
  isActive: boolean;
  archivedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  _count: { assertions: number };
  subjects?: Array<{
    subject: {
      id: string;
      name: string;
      slug: string;
      domains: Array<{
        domain: { id: string; name: string; slug: string };
      }>;
    };
  }>;
};

// ── Badge Components ──────────────────────────────

export function TrustBadge({ level }: { level: string }) {
  const config = TRUST_LEVELS.find((t) => t.value === level) || TRUST_LEVELS[5];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: config.color,
        backgroundColor: config.bg,
        border: `1px solid color-mix(in srgb, ${config.color} 20%, transparent)`,
      }}
    >
      {config.label}
    </span>
  );
}

export function FreshnessIndicator({ validUntil }: { validUntil: string | null }) {
  if (!validUntil) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>No expiry</span>;
  const expiry = new Date(validUntil);
  const now = new Date();
  const daysUntil = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) {
    return <span style={{ color: "var(--status-error-text)", fontSize: 12, fontWeight: 600 }}>Expired {Math.abs(daysUntil)}d ago</span>;
  }
  if (daysUntil <= 60) {
    return <span style={{ color: "var(--status-warning-text)", fontSize: 12, fontWeight: 600 }}>Expires in {daysUntil}d</span>;
  }
  return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Valid until {expiry.toLocaleDateString()}</span>;
}

export function DocumentTypeBadge({ type, source }: { type: string; source?: string | null }) {
  const dt = DOCUMENT_TYPES.find((d) => d.value === type) || DOCUMENT_TYPES[0];
  const isAuto = source?.startsWith("ai:");
  return (
    <span
      title={source ? `Set by: ${source}` : "Default (not classified)"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        color: "var(--text-secondary)",
        backgroundColor: "var(--surface-tertiary)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <span style={{ fontSize: 12 }}>{dt.icon}</span>
      {dt.label}
      {isAuto && (
        <span style={{ fontSize: 9, color: "var(--text-muted)", fontStyle: "italic" }}>auto</span>
      )}
    </span>
  );
}

export function ArchivedBadge({ archivedAt }: { archivedAt?: string | null }) {
  const label = archivedAt
    ? `Archived ${new Date(archivedAt).toLocaleDateString()}`
    : "Archived";
  return (
    <span
      title={label}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-muted)",
        backgroundColor: "var(--surface-secondary)",
        border: "1px solid var(--border-default)",
      }}
    >
      Archived
    </span>
  );
}

export function UsedByCell({ subjects }: { subjects: ContentSource["subjects"] }) {
  if (!subjects || subjects.length === 0) {
    return (
      <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
        Unlinked
      </span>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {subjects.map((ss) => {
        const domainNames = ss.subject.domains.map((d) => d.domain.name);
        return (
          <div key={ss.subject.id} style={{ fontSize: 12 }}>
            <Link
              href={`/x/subjects?id=${ss.subject.id}`}
              style={{ color: "var(--accent-primary)", textDecoration: "none", fontWeight: 500 }}
            >
              {ss.subject.name}
            </Link>
            {domainNames.length > 0 && (
              <span style={{ color: "var(--text-muted)" }}> ({domainNames.join(", ")})</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
