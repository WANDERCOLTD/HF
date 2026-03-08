/**
 * Builds a rich debug context payload for bug reports.
 * Extracted from BugReportButton to keep it focused on UI.
 */

import type { CapturedError } from "@/contexts/ErrorCaptureContext";

export interface BugContextPayload {
  url: string;
  timestamp: number;
  viewport: string;
  browser: string;
  userRole?: string;
  institution?: string;
  entityBreadcrumbs: string;
  recentErrors: CapturedError[];
  wizardState: Record<string, unknown> | null;
  hfLocalStorage: Record<string, string>;
  hfSessionStorage: Record<string, string>;
  screenshotSize?: string;
}

interface BuildContextOpts {
  pathname: string;
  breadcrumbs: Array<{ type?: string; label?: string }>;
  getRecentErrors: () => CapturedError[];
  userRole?: string;
  screenshotDataUrl?: string | null;
}

/** Collect all HF-prefixed keys from a Storage object */
function collectHfKeys(storage: Storage): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (key.startsWith("hf.") || key.startsWith("ui."))) {
      const val = storage.getItem(key);
      if (val) result[key] = val.length > 200 ? val.slice(0, 200) + "…" : val;
    }
  }
  return result;
}

/** Parse wizard state from sessionStorage (if any wizard is active) */
function getWizardState(): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem("hf.stepflow.state");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.active) return null;
    return {
      flowId: parsed.flowId,
      currentStep: parsed.currentStep,
      stepLabel: parsed.steps?.[parsed.currentStep]?.label,
      dataKeys: parsed.data ? Object.keys(parsed.data) : [],
      data: parsed.data,
    };
  } catch {
    return null;
  }
}

export function buildBugContext(opts: BuildContextOpts): BugContextPayload {
  const { pathname, breadcrumbs, getRecentErrors, userRole, screenshotDataUrl } = opts;
  const fullUrl = typeof window !== "undefined" ? window.location.href : pathname;

  const institution = breadcrumbs.find((b) => b.type === "domain")?.label;

  return {
    url: fullUrl,
    timestamp: Date.now(),
    viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "N/A",
    browser: typeof navigator !== "undefined" ? navigator.userAgent : "N/A",
    userRole,
    institution,
    entityBreadcrumbs: breadcrumbs
      .map((b) => `${b.type || "?"}:${b.label || "?"}`)
      .join(" → "),
    recentErrors: getRecentErrors(),
    wizardState: getWizardState(),
    hfLocalStorage: typeof localStorage !== "undefined" ? collectHfKeys(localStorage) : {},
    hfSessionStorage: typeof sessionStorage !== "undefined" ? collectHfKeys(sessionStorage) : {},
    screenshotSize: screenshotDataUrl
      ? `${Math.round(screenshotDataUrl.length / 1024)}KB`
      : undefined,
  };
}

/** Format context as Markdown for clipboard copy */
export function bugContextToMarkdown(
  ctx: BugContextPayload,
  conversationHistory: Array<{ role: string; content: string }>,
  currentDraft: string,
  latestResponse: string,
): string {
  const lines: string[] = [
    `## Bug Report — ${ctx.url}`,
    `**Time:** ${new Date(ctx.timestamp).toLocaleString()}`,
    `**Viewport:** ${ctx.viewport}`,
    `**Browser:** ${ctx.browser}`,
  ];

  if (ctx.userRole) lines.push(`**Role:** ${ctx.userRole}`);
  if (ctx.institution) lines.push(`**Institution:** ${ctx.institution}`);
  if (ctx.entityBreadcrumbs) lines.push(`**Entity context:** ${ctx.entityBreadcrumbs}`);

  if (ctx.recentErrors.length > 0) {
    lines.push("", "### Captured JS Errors");
    for (const err of ctx.recentErrors) {
      lines.push(`- \`${err.message}\`${err.source ? ` (${err.source})` : ""}`);
    }
  }

  if (ctx.wizardState) {
    lines.push("", "### Wizard State");
    lines.push("```json", JSON.stringify(ctx.wizardState, null, 2), "```");
  }

  const storageKeys = { ...ctx.hfLocalStorage, ...ctx.hfSessionStorage };
  if (Object.keys(storageKeys).length > 0) {
    lines.push("", "### HF Storage Keys");
    for (const [key, val] of Object.entries(storageKeys)) {
      lines.push(`- **${key}:** ${val}`);
    }
  }

  if (conversationHistory.length > 0 || currentDraft.trim()) {
    lines.push("", "### Conversation");
    for (const msg of conversationHistory) {
      lines.push(`**${msg.role === "user" ? "User" : "AI"}:** ${msg.content}`);
    }
    if (currentDraft.trim()) {
      lines.push(`**User (draft):** ${currentDraft.trim()}`);
    }
  }

  if (latestResponse && conversationHistory.length === 0) {
    lines.push("", "### AI Diagnosis", latestResponse);
  }

  if (ctx.screenshotSize) {
    lines.push("", `### Screenshot`, `[Screenshot captured — ${ctx.screenshotSize}]`);
  }

  return lines.join("\n");
}
