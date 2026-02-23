'use client';

/**
 * LogsPopup — flyout anchored to the Logs chip in the status bar.
 *
 * Fetches recent logs from /api/logs/ai-calls on open (polls every 5s while open).
 * Shows: stats row (total / AI / deep) + recent log entries.
 * Deep logging toggle inline.
 * Footer: "View All Logs →" link to /x/logs.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, ExternalLink, FileText, Zap } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  type: 'ai' | 'api' | 'system' | 'user';
  stage: string;
  message?: string;
  promptLength?: number;
  responseLength?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  ai: { bg: 'var(--badge-blue-bg)', text: 'var(--badge-blue-text, #1e40af)' },
  api: { bg: 'var(--badge-green-bg)', text: 'var(--badge-green-text, #166534)' },
  system: { bg: 'var(--badge-amber-bg, #fef3c7)', text: 'var(--badge-amber-text, #92400e)' },
  user: { bg: 'var(--badge-purple-bg, #f3e8ff)', text: 'var(--badge-purple-text, #6b21a8)' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface LogsPopupProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  deepLogging: boolean;
  onToggleDeepLogging: () => void;
}

export function LogsPopup({ open, onClose, anchorRef, deepLogging, onToggleDeepLogging }: LogsPopupProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs/ai-calls');
      if (res.ok) {
        const data = await res.json();
        setLogs((data.logs || []).slice(0, 8));
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on open + poll every 5s
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [open, fetchLogs]);

  // Outside-click handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        anchorRef.current &&
        !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  // Escape handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const aiCount = logs.filter((l) => l.type === 'ai').length;
  const deepCount = logs.filter((l) => l.metadata?.deep === true).length;
  const totalTokens = logs.reduce(
    (sum, l) => sum + (l.usage?.inputTokens || 0) + (l.usage?.outputTokens || 0),
    0
  );

  return (
    <div className="logs-popup" ref={panelRef}>
      {/* Header */}
      <div className="jobs-popup-header">
        <span className="jobs-popup-title">Logs</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Deep logging toggle */}
          <button
            className={`logs-popup-deep-toggle${deepLogging ? ' logs-popup-deep-toggle-active' : ''}`}
            onClick={onToggleDeepLogging}
            title={deepLogging ? 'Deep logging ON (click to turn off)' : 'Deep logging OFF (click to turn on)'}
          >
            <Zap size={11} />
            <span>Deep</span>
          </button>
          <button className="jobs-popup-close" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="calls-popup-stats">
        <div className="calls-popup-stat">
          <span className="calls-popup-stat-value">{logs.length}</span>
          <span className="calls-popup-stat-label">Recent</span>
        </div>
        <div className="calls-popup-stat-divider" />
        <div className="calls-popup-stat">
          <span className="calls-popup-stat-value">{aiCount}</span>
          <span className="calls-popup-stat-label">AI</span>
        </div>
        <div className="calls-popup-stat-divider" />
        <div className="calls-popup-stat">
          <span className="calls-popup-stat-value">{totalTokens > 0 ? `${Math.round(totalTokens / 1000)}k` : '0'}</span>
          <span className="calls-popup-stat-label">Tokens</span>
        </div>
        {deepCount > 0 && (
          <>
            <div className="calls-popup-stat-divider" />
            <div className="calls-popup-stat">
              <span className="calls-popup-stat-value" style={{ color: 'var(--status-error-text)' }}>{deepCount}</span>
              <span className="calls-popup-stat-label">Deep</span>
            </div>
          </>
        )}
      </div>

      {/* Body */}
      <div className="jobs-popup-body">
        {loading ? (
          <div className="jobs-popup-loading">
            <span className="hf-spinner" />
          </div>
        ) : logs.length === 0 ? (
          <div className="jobs-popup-empty">
            No log entries yet.
            {!deepLogging && ' Toggle Deep to capture full AI prompts.'}
          </div>
        ) : (
          <div className="jobs-popup-section">
            <div className="jobs-popup-section-label">Recent</div>
            {logs.map((log, idx) => {
              const colors = TYPE_COLORS[log.type] || TYPE_COLORS.ai;
              const isDeep = log.metadata?.deep === true;
              return (
                <div
                  key={idx}
                  className="jobs-popup-row"
                  onClick={() => {
                    onClose();
                    router.push('/x/logs');
                  }}
                >
                  <div className="jobs-popup-row-icon">
                    <FileText size={13} />
                  </div>
                  <div className="jobs-popup-row-content">
                    <div className="jobs-popup-row-name" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          padding: '1px 5px',
                          background: colors.bg,
                          color: colors.text,
                          borderRadius: 3,
                          fontSize: 9,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          lineHeight: '14px',
                        }}
                      >
                        {log.type}
                      </span>
                      {isDeep && (
                        <span
                          style={{
                            padding: '1px 4px',
                            background: 'var(--status-error-text)',
                            color: 'var(--surface-primary)',
                            borderRadius: 3,
                            fontSize: 8,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            lineHeight: '12px',
                          }}
                        >
                          DEEP
                        </span>
                      )}
                      <span style={{ fontSize: 12 }}>{log.stage}</span>
                    </div>
                    <div className="jobs-popup-row-meta">
                      {timeAgo(log.timestamp)}
                      {log.durationMs ? ` \u00b7 ${log.durationMs}ms` : ''}
                      {log.usage?.inputTokens ? ` \u00b7 ${log.usage.inputTokens + (log.usage?.outputTokens || 0)} tok` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="jobs-popup-footer">
        <button
          className="jobs-popup-viewall"
          onClick={() => {
            onClose();
            router.push('/x/logs');
          }}
        >
          View All Logs <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}
