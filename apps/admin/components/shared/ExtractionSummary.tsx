'use client';

/**
 * ExtractionSummary — Rich post-extraction results card.
 *
 * Shows document count, stat bar (TPs, questions, vocab, images),
 * per-file list with DocType badges, and per-category pill breakdown.
 *
 * Two modes:
 *   - Full (default) — hero checkmark, full stats, action buttons. Used in step wizards.
 *   - Compact — smaller, no hero, no buttons. Used inline in chat.
 */

import './extraction-summary.css';
import './wizard-summary.css'; // reuse wiz-hero-check + wiz-fade-up keyframes
import { FileText, AlertTriangle, Check } from 'lucide-react';
import type { PackUploadResult } from '@/components/wizards/PackUploadStep';
import { DocTypeBadge } from '@/app/x/content-sources/_components/shared/badges';
import { getCategoryStyle } from '@/lib/content-categories';
import { INSTRUCTION_CATEGORIES } from '@/lib/content-trust/resolve-config';

// ── Props ────────────────────────────────────────

interface ExtractionSummaryProps {
  result: PackUploadResult;
  /** Compact mode for chat embed (no hero, smaller) */
  compact?: boolean;
  /** Continue button handler (full mode) */
  onContinue?: () => void;
  /** Re-upload / back button handler (full mode) */
  onReUpload?: () => void;
}

// ── Component ────────────────────────────────────

export function ExtractionSummary({
  result,
  compact = false,
  onContinue,
  onReUpload,
}: ExtractionSummaryProps) {
  const { extractionTotals, classifications, sourceCount, subjects, categoryCounts } = result;

  const totalAssertions = extractionTotals?.assertions ?? 0;
  const totalQs = extractionTotals?.questions ?? 0;
  const totalVocab = extractionTotals?.vocabulary ?? 0;
  const totalImages = extractionTotals?.images ?? 0;
  const isEmpty = totalAssertions === 0 && totalQs === 0 && totalVocab === 0;

  // Split assertions into TPs (content) and TIs (instructions) using categoryCounts
  const instructionSet = new Set<string>(INSTRUCTION_CATEGORIES);
  const tiCount = categoryCounts
    ? Object.entries(categoryCounts).reduce((sum, [cat, n]) => instructionSet.has(cat) ? sum + n : sum, 0)
    : 0;
  const tpCount = totalAssertions - tiCount;

  // Build subtitle
  const parts: string[] = [];
  if (sourceCount && sourceCount > 0) parts.push(`${sourceCount} document${sourceCount !== 1 ? 's' : ''}`);
  if (subjects && subjects.length > 0) parts.push(`${subjects.length} subject${subjects.length !== 1 ? 's' : ''}`);
  const subtitle = parts.join('  ·  ');

  // Filter stats to only show non-zero
  const stats = [
    { label: 'Teaching Points', value: tpCount },
    ...(tiCount > 0 ? [{ label: 'Instructions', value: tiCount }] : []),
    { label: 'Questions', value: totalQs },
    { label: 'Vocabulary', value: totalVocab },
    { label: 'Images', value: totalImages },
  ].filter(s => s.value > 0);

  // Sort categories by count descending
  const sortedCategories = categoryCounts
    ? Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])
    : [];

  // ── Empty state ──

  if (isEmpty) {
    return (
      <div className={`es-root${compact ? ' es-root--compact' : ''}`}>
        <div className="es-warning">
          <div className="es-warning-icon">
            <AlertTriangle size={24} />
          </div>
          <h2 className="es-warning-title">No Teaching Points Found</h2>
          <p className="es-warning-desc">
            Files were processed but no teaching points could be extracted.
            Try uploading different content.
          </p>
        </div>
        {!compact && (onReUpload || onContinue) && (
          <div className="es-actions">
            {onReUpload && (
              <button className="wiz-action-back" onClick={onReUpload}>
                Re-upload
              </button>
            )}
            <div className="es-actions-spacer" />
            {onContinue && (
              <button className="wiz-action-secondary" onClick={onContinue}>
                Skip
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Success state ──

  return (
    <div className={`es-root${compact ? ' es-root--compact' : ''}`}>
      {/* Hero */}
      <div className="es-hero">
        {!compact && <SuccessCheckmark />}
        <h2 className="es-hero-title">
          {compact && <Check size={16} style={{ color: 'var(--status-success-text)' }} />}
          Content Extracted
        </h2>
        {subtitle && <p className="es-hero-subtitle">{subtitle}</p>}
      </div>

      {/* Stat bar */}
      {stats.length > 0 && (
        <div className="es-stat-bar">
          {stats.map(s => (
            <div key={s.label} className="es-stat">
              <span className="es-stat-value">{s.value}</span>
              <span className="es-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* File list */}
      {classifications && classifications.length > 0 && (
        <div className="es-section">
          <div className="es-section-label">Documents</div>
          <div className="es-file-list">
            {classifications.map((file, i) => (
              <div key={i} className="es-file-row">
                <FileText size={14} className="es-file-icon" />
                <span className="es-file-name">{file.fileName}</span>
                <DocTypeBadge type={file.documentType} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category pills — split into content TPs and instruction TIs */}
      {sortedCategories.length > 0 && (() => {
        const contentCats = sortedCategories.filter(([cat]) => !instructionSet.has(cat));
        const instructionCats = sortedCategories.filter(([cat]) => instructionSet.has(cat));

        const renderPills = (cats: [string, number][]) => (
          <div className="es-categories">
            {cats.map(([cat, count]) => {
              const colors = getCategoryStyle(cat);
              return (
                <span
                  key={cat}
                  className="es-category-pill"
                  style={{
                    color: colors.color,
                    background: colors.bg,
                    borderColor: colors.color,
                  }}
                >
                  {colors.label} <span className="es-category-count">{count}</span>
                </span>
              );
            })}
          </div>
        );

        return (
          <>
            {contentCats.length > 0 && (
              <div className="es-section">
                <div className="es-section-label">Teaching Points by Type</div>
                {renderPills(contentCats)}
              </div>
            )}
            {instructionCats.length > 0 && (
              <div className="es-section">
                <div className="es-section-label">Teaching Instructions by Type</div>
                {renderPills(instructionCats)}
              </div>
            )}
          </>
        );
      })()}

      {/* Actions (full mode only) */}
      {!compact && (onReUpload || onContinue) && (
        <div className="es-actions">
          {onReUpload && (
            <button className="wiz-action-back" onClick={onReUpload}>
              Back
            </button>
          )}
          <div className="es-actions-spacer" />
          {onContinue && (
            <button className="wiz-action-primary" onClick={onContinue}>
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Animated Checkmark (reused from WizardSummary) ──

function SuccessCheckmark() {
  return (
    <svg className="wiz-hero-check" viewBox="0 0 64 64">
      <circle
        className="wiz-check-circle"
        cx="32"
        cy="32"
        r="30"
      />
      <polyline
        className="wiz-check-mark"
        points="20,34 28,42 44,24"
      />
    </svg>
  );
}
