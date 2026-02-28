"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Pencil, Check } from "lucide-react";
import { DOC_TYPE_INFO, DOC_TYPE_GROUPS, getDocTypeInfo } from "@/lib/doc-type-icons";

// ── Constants ──────────────────────────────────────
// Derived from doc-type-icons.ts — single source of truth.
// icon field is emojiIcon (string) for backward compat with <option> render sites.

export const DOCUMENT_TYPES = Object.entries(DOC_TYPE_INFO).map(([value, info]) => ({
  value,
  label: info.label,
  icon: info.emojiIcon,  // string emoji — keeps {d.icon} in <option> working
  desc: info.description,
  role: info.role,
  color: info.color,
  bg: info.bg,
}));

export const TRUST_LEVELS = [
  { value: "REGULATORY_STANDARD", label: "L5 Regulatory Standard", color: "var(--trust-l5-text)", bg: "var(--trust-l5-bg)" },
  { value: "ACCREDITED_MATERIAL", label: "L4 Accredited Material", color: "var(--trust-l4-text)", bg: "var(--trust-l4-bg)" },
  { value: "PUBLISHED_REFERENCE", label: "L3 Published Reference", color: "var(--trust-l3-text)", bg: "var(--trust-l3-bg)" },
  { value: "EXPERT_CURATED", label: "L2 Expert Curated", color: "var(--trust-l2-text)", bg: "var(--trust-l2-bg)" },
  { value: "AI_ASSISTED", label: "L1 AI Assisted", color: "var(--trust-l1-text)", bg: "var(--trust-l1-bg)" },
  { value: "UNVERIFIED", label: "L0 Unverified", color: "var(--trust-l0-text)", bg: "var(--trust-l0-bg)" },
];

// ── Types ──────────────────────────────────────────

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

// ── DocTypeBadge ───────────────────────────────────
// Role-coloured badge with optional click-to-change picker.
// source?: "ai:0.87" format from DB (extracts confidence for signal).
// confidence?: direct number (wizard use, 0–1).
// onChange?: if provided, badge is editable — click opens role-grouped picker.

interface DocTypeBadgeProps {
  type: string;
  source?: string | null;
  confidence?: number;
  onChange?: (newType: string) => void;
}

export function DocTypeBadge({ type, source, confidence, onChange }: DocTypeBadgeProps) {
  const info = getDocTypeInfo(type);
  const Icon = info.icon;
  const editable = !!onChange;

  // Derive confidence: prefer direct prop, fall back to parsing "ai:0.87"
  const conf = confidence !== undefined
    ? confidence
    : (source?.startsWith("ai:") ? parseFloat(source.slice(3)) : undefined);

  const isUncertain = conf !== undefined && conf < 0.85 && conf >= 0.6;
  const isWarn      = conf !== undefined && conf < 0.6;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [hoveredType, setHoveredType] = useState<string | null>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openPicker = useCallback(() => {
    if (!badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();
    // Position below badge, aligned left; clamp to viewport right edge
    const left = Math.min(rect.left, window.innerWidth - 320);
    setPickerPos({ top: rect.bottom + 6, left });
    setPickerOpen(true);
    setHoveredType(type); // pre-select current type in hover preview
  }, [type]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setHoveredType(null);
  }, []);

  const selectType = useCallback((newType: string) => {
    onChange?.(newType);
    closePicker();
  }, [onChange, closePicker]);

  // Close on Escape
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closePicker(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pickerOpen, closePicker]);

  const badgeClasses = [
    "hf-doc-type-badge",
    editable ? "hf-doc-type-badge--editable" : "",
    isWarn ? "hf-doc-type-badge--warn" : (isUncertain ? "hf-doc-type-badge--uncertain" : ""),
  ].filter(Boolean).join(" ");

  const hoveredInfo = hoveredType ? getDocTypeInfo(hoveredType) : null;

  return (
    <>
      {editable ? (
        <button
          ref={badgeRef}
          className={badgeClasses}
          style={{ "--badge-color": info.color, "--badge-bg": info.bg } as React.CSSProperties}
          onClick={openPicker}
          type="button"
          title={conf !== undefined ? `Confidence: ${Math.round(conf * 100)}%` : undefined}
        >
          <Icon size={11} />
          {info.label}
          {isUncertain && <span className="hf-doc-type-badge-ai">AI</span>}
          {isWarn && <span className="hf-doc-type-badge-ai">Check</span>}
          <Pencil size={10} className="hf-doc-type-badge-edit-icon" />
        </button>
      ) : (
        <span
          className={badgeClasses}
          style={{ "--badge-color": info.color, "--badge-bg": info.bg } as React.CSSProperties}
          title={source ? `Set by: ${source}` : undefined}
        >
          <Icon size={11} />
          {info.label}
          {isUncertain && <span className="hf-doc-type-badge-ai">AI</span>}
        </span>
      )}

      {/* ── Picker popover ── */}
      {pickerOpen && pickerPos && (
        <>
          {/* Backdrop — click outside to close */}
          <div
            className="hf-doc-type-picker-backdrop"
            onClick={closePicker}
          />
          <div
            ref={pickerRef}
            className="hf-doc-type-picker"
            style={{ top: pickerPos.top, left: pickerPos.left }}
          >
            {DOC_TYPE_GROUPS.map((group) => (
              <div key={group.role} className="hf-doc-type-picker-group">
                <div className="hf-doc-type-picker-group-label">{group.label}</div>
                <div className="hf-doc-type-picker-chips">
                  {group.types.map((t) => {
                    const tInfo = getDocTypeInfo(t);
                    const TIcon = tInfo.icon;
                    const isSelected = t === type;
                    return (
                      <button
                        key={t}
                        type="button"
                        className={`hf-chip${isSelected ? " hf-chip-selected" : ""}`}
                        style={isSelected
                          ? { "--chip-color": tInfo.color, "--chip-bg": tInfo.bg } as React.CSSProperties
                          : undefined}
                        onClick={() => selectType(t)}
                        onMouseEnter={() => setHoveredType(t)}
                        onMouseLeave={() => setHoveredType(type)}
                      >
                        <TIcon size={11} />
                        {tInfo.label}
                        {isSelected && <Check size={10} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Description preview */}
            <div className="hf-doc-type-picker-preview">
              {hoveredInfo ? (
                <>
                  <span className="hf-doc-type-picker-preview-label">{hoveredInfo.label}</span>
                  {" — "}
                  <span className="hf-doc-type-picker-preview-desc">{hoveredInfo.description}</span>
                </>
              ) : (
                <span className="hf-doc-type-picker-preview-empty">Hover a type to see what it does</span>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Backward-compat alias — existing call sites (SourceStep, etc.) need no change
export const DocumentTypeBadge = DocTypeBadge;

// ── Other badge components ─────────────────────────

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
