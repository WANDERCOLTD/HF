/**
 * Canonical log types — shared by LogViewer, logger.ts, and the logs API route.
 *
 * Single source of truth for log entry shape, type colors, and filtering helpers.
 */

// ── Types ──────────────────────────────────────────────

export type LogType = "ai" | "api" | "system" | "user";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  type: LogType;
  stage: string;
  level?: LogLevel;
  message?: string;
  promptLength?: number;
  promptPreview?: string;
  responseLength?: number;
  responsePreview?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

// ── Constants ──────────────────────────────────────────

export const ALL_TYPES: LogType[] = ["ai", "api", "system", "user"];

export const LOG_TYPE_COLORS: Record<LogType, { bg: string; text: string }> = {
  ai: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text, #1e40af)" },
  api: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text, #166534)" },
  system: { bg: "var(--badge-amber-bg, #fef3c7)", text: "var(--badge-amber-text, #92400e)" },
  user: { bg: "var(--badge-purple-bg, #f3e8ff)", text: "var(--badge-purple-text, #6b21a8)" },
};

// ── Helpers ────────────────────────────────────────────

export function isDeepEntry(log: LogEntry): boolean {
  return log.metadata?.deep === true;
}

export function isErrorEntry(log: LogEntry): boolean {
  return (
    log.level === "error" ||
    (log.metadata?.level as string) === "error"
  );
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Format a log entry as structured markdown for pasting into Claude.
 */
export function formatForClaude(log: LogEntry): string {
  const lines: string[] = [];
  lines.push(`## AI Call: ${log.stage}`);
  if (log.metadata?.model || log.metadata?.engine || log.durationMs) {
    const parts: string[] = [];
    if (log.metadata?.model) parts.push(`**Model:** ${log.metadata.model}`);
    if (log.metadata?.engine) parts.push(`**Engine:** ${log.metadata.engine}`);
    if (log.durationMs) parts.push(`**Duration:** ${log.durationMs}ms`);
    lines.push(parts.join(" | "));
  }
  if (log.usage) {
    lines.push(`**Tokens:** ${log.usage.inputTokens ?? 0} in / ${log.usage.outputTokens ?? 0} out`);
  }
  lines.push(`**Time:** ${log.timestamp}`);
  lines.push("");
  if (log.promptPreview) {
    lines.push("### Prompt");
    lines.push(log.promptPreview);
    lines.push("");
  }
  if (log.responsePreview) {
    lines.push("### Response");
    lines.push(log.responsePreview);
    lines.push("");
  }
  if (log.metadata?.error) {
    lines.push("### Error");
    lines.push(String(log.metadata.error));
    lines.push("");
  }
  return lines.join("\n");
}
