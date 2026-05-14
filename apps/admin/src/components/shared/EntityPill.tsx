"use client";

import React from "react";
import Link from "next/link";
import { entityColors, statusColors, EntityType, StatusType } from "./uiColors";

// =============================================================================
// TYPES
// =============================================================================

export interface EntityPillProps {
  /** The entity type - determines color and icon */
  type: EntityType;
  /** Display label */
  label: string;
  /** Optional status - adds colored border */
  status?: StatusType;
  /** Optional href - makes the pill clickable */
  href?: string;
  /** Optional click handler (alternative to href) */
  onClick?: () => void;
  /** Optional remove handler - adds × button */
  onRemove?: () => void;
  /** Size variant */
  size?: "compact" | "default" | "large";
  /** Override the default icon */
  icon?: string;
  /** Show icon (default: true) */
  showIcon?: boolean;
  /** Additional class names */
  className?: string;
  /** Make the pill full width */
  fullWidth?: boolean;
  /** Truncate long labels */
  truncate?: boolean;
  /** Max width for truncation (in pixels or CSS value) */
  maxWidth?: number | string;
}

// =============================================================================
// SIZE CONFIGS
// =============================================================================

const sizeStyles = {
  compact: {
    padding: "2px 8px",
    fontSize: "12px",
    iconSize: "12px",
    gap: "4px",
    borderRadius: "4px",
    removeSize: "14px",
  },
  default: {
    padding: "4px 10px",
    fontSize: "13px",
    iconSize: "14px",
    gap: "6px",
    borderRadius: "6px",
    removeSize: "16px",
  },
  large: {
    padding: "6px 14px",
    fontSize: "14px",
    iconSize: "16px",
    gap: "8px",
    borderRadius: "8px",
    removeSize: "18px",
  },
} as const;

// =============================================================================
// COMPONENT
// =============================================================================

export function EntityPill({
  type,
  label,
  status,
  href,
  onClick,
  onRemove,
  size = "default",
  icon,
  showIcon = true,
  className = "",
  fullWidth = false,
  truncate = false,
  maxWidth,
}: EntityPillProps) {
  const colors = entityColors[type];
  const statusStyle = status ? statusColors[status] : null;
  const sizeConfig = sizeStyles[size];

  const displayIcon = icon ?? colors.icon;

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: sizeConfig.gap,
    padding: sizeConfig.padding,
    fontSize: sizeConfig.fontSize,
    fontWeight: 500,
    lineHeight: 1.4,
    borderRadius: sizeConfig.borderRadius,
    backgroundColor: colors.bg,
    color: colors.text,
    border: `1.5px solid ${statusStyle ? statusStyle.accent : colors.border}`,
    textDecoration: "none",
    cursor: href || onClick ? "pointer" : "default",
    transition: "all 0.15s ease",
    width: fullWidth ? "100%" : undefined,
    maxWidth: maxWidth ? (typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth) : undefined,
  };

  const hoverStyle: React.CSSProperties = {
    backgroundColor: colors.border,
    borderColor: statusStyle ? statusStyle.accent : colors.accent,
  };

  const iconStyle: React.CSSProperties = {
    fontSize: sizeConfig.iconSize,
    lineHeight: 1,
    flexShrink: 0,
  };

  const labelStyle: React.CSSProperties = {
    overflow: truncate ? "hidden" : undefined,
    textOverflow: truncate ? "ellipsis" : undefined,
    whiteSpace: truncate ? "nowrap" : undefined,
    flexGrow: 1,
    minWidth: 0,
  };

  const removeButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: sizeConfig.removeSize,
    height: sizeConfig.removeSize,
    marginLeft: "2px",
    marginRight: "-4px",
    borderRadius: "50%",
    color: colors.text,
    opacity: 0.6,
    cursor: "pointer",
    transition: "all 0.15s ease",
    flexShrink: 0,
  };

  const content = (
    <>
      {showIcon && displayIcon && <span style={iconStyle}>{displayIcon}</span>}
      <span style={labelStyle}>{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          style={removeButtonStyle}
          className="entity-pill-remove"
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </>
  );

  // Render as Link if href provided
  if (href) {
    return (
      <>
        <Link
          href={href}
          style={baseStyle}
          className={`entity-pill entity-pill-${type} ${className}`}
        >
          {content}
        </Link>
        <PillStyles hoverBg={colors.border} hoverBorder={statusStyle?.accent ?? colors.accent} />
      </>
    );
  }

  // Render as button if onClick provided
  if (onClick) {
    return (
      <>
        <button
          type="button"
          onClick={onClick}
          style={baseStyle}
          className={`entity-pill entity-pill-${type} ${className}`}
        >
          {content}
        </button>
        <PillStyles hoverBg={colors.border} hoverBorder={statusStyle?.accent ?? colors.accent} />
      </>
    );
  }

  // Render as span (non-interactive)
  return (
    <>
      <span style={baseStyle} className={`entity-pill entity-pill-${type} ${className}`}>
        {content}
      </span>
      <PillStyles hoverBg={colors.border} hoverBorder={statusStyle?.accent ?? colors.accent} />
    </>
  );
}

// =============================================================================
// HOVER STYLES (injected once)
// =============================================================================

function PillStyles({ hoverBg, hoverBorder }: { hoverBg: string; hoverBorder: string }) {
  return (
    <style jsx global>{`
      .entity-pill:hover {
        background-color: ${hoverBg} !important;
        border-color: ${hoverBorder} !important;
      }
      .entity-pill-remove:hover {
        opacity: 1 !important;
        background-color: rgba(0, 0, 0, 0.1);
      }
    `}</style>
  );
}

// =============================================================================
// CONVENIENCE COMPONENTS - Pre-typed pills for common entity types
// =============================================================================

export function DomainPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="domain" {...props} />;
}

export function PlaybookPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="playbook" {...props} />;
}

export function SpecPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="spec" {...props} />;
}

export function ParameterPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="parameter" {...props} />;
}

export function CallerPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="caller" {...props} />;
}

export function GoalPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="goal" {...props} />;
}

export function CallPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="call" {...props} />;
}

export function TranscriptPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="transcript" {...props} />;
}

export function PromptPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="prompt" {...props} />;
}

export function MemoryPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="memory" {...props} />;
}

export function KnowledgePill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="knowledge" {...props} />;
}

export function RunPill(props: Omit<EntityPillProps, "type">) {
  return <EntityPill type="run" {...props} />;
}

// =============================================================================
// STATUS BADGE - Just shows a status (for use in tables/lists)
// =============================================================================

export interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: "compact" | "default" | "large";
  className?: string;
}

export function StatusBadge({ status, label, size = "default", className = "" }: StatusBadgeProps) {
  const colors = statusColors[status];
  const sizeConfig = sizeStyles[size];

  const displayLabel = label ?? status.charAt(0).toUpperCase() + status.slice(1);

  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: sizeConfig.padding,
    fontSize: sizeConfig.fontSize,
    fontWeight: 500,
    lineHeight: 1.4,
    borderRadius: sizeConfig.borderRadius,
    backgroundColor: colors.bg,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    textTransform: "capitalize",
  };

  return (
    <span style={style} className={`status-badge status-badge-${status} ${className}`}>
      {displayLabel}
    </span>
  );
}

// =============================================================================
// ENTITY ICON - Just the icon with type color background (for compact displays)
// =============================================================================

export interface EntityIconProps {
  type: EntityType;
  size?: "compact" | "default" | "large";
  title?: string;
  className?: string;
}

export function EntityIcon({ type, size = "default", title, className = "" }: EntityIconProps) {
  const colors = entityColors[type];

  const sizes = {
    compact: { box: "20px", font: "12px" },
    default: { box: "28px", font: "16px" },
    large: { box: "36px", font: "20px" },
  };

  const sizeConfig = sizes[size];

  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: sizeConfig.box,
    height: sizeConfig.box,
    fontSize: sizeConfig.font,
    borderRadius: "6px",
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
  };

  return (
    <span style={style} className={`entity-icon entity-icon-${type} ${className}`} title={title}>
      {colors.icon}
    </span>
  );
}

