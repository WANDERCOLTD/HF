/**
 * #809 — DATA-mode pageContext parser + system-prompt block builder.
 *
 * Lives next to route.ts and system-prompts.ts because both consume it:
 * route.ts parses the request body into the typed shape, system-prompts.ts
 * renders it into a short prompt preamble.
 *
 * #1225 — extended to carry a course snapshot when page === "course" so
 * COURSE_MANAGE-mode chats see the live editable surface of the active
 * course in the system prompt, not just the breadcrumb. Forbidden top-level
 * keys (per AI_FORBIDDEN_FIELDS.playbook) are stripped at parse time as
 * defence-in-depth — the page builder is also expected to omit them.
 */

import { AI_FORBIDDEN_FIELDS } from "@/lib/chat/ai-forbidden-fields";

export interface PageContextHint {
  page: string;
  params: {
    activeTab?: string;
    visibleSections?: string[];
    /**
     * #1225 — when page === "course", a snapshot of the active course's
     * editable surface (name, slug, description, config.*, behaviorTargets,
     * primary/linked curricula refs). Built server-side in the page
     * component; rendered into the system prompt by buildPageContextBlock.
     * Keys in AI_FORBIDDEN_FIELDS.playbook are stripped by the parser.
     */
    courseSnapshot?: Record<string, unknown>;
  };
}

/**
 * Defensive parser for the `pageContext` body field. Returns undefined when
 * the shape is unknown so a malformed client payload can never poison the
 * system prompt. Filters visibleSections down to plain non-empty strings.
 */
export function parsePageContext(raw: unknown): PageContextHint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as { page?: unknown; params?: unknown };
  if (typeof obj.page !== "string" || obj.page.length === 0) return undefined;
  const rawParams = (obj.params && typeof obj.params === "object" ? obj.params : {}) as {
    activeTab?: unknown;
    visibleSections?: unknown;
    courseSnapshot?: unknown;
  };
  const params: PageContextHint["params"] = {};
  if (typeof rawParams.activeTab === "string" && rawParams.activeTab.length > 0) {
    params.activeTab = rawParams.activeTab;
  }
  if (Array.isArray(rawParams.visibleSections)) {
    const sections = rawParams.visibleSections.filter(
      (s: unknown): s is string => typeof s === "string" && s.length > 0,
    );
    if (sections.length > 0) params.visibleSections = sections;
  }
  // #1225 — accept courseSnapshot when page === "course"; strip any
  // top-level key listed in AI_FORBIDDEN_FIELDS.playbook so a malformed
  // client payload cannot inject forbidden state into the system prompt
  // (e.g. status, publishedAt, deletedAt, domainId).
  if (obj.page === "course" && rawParams.courseSnapshot && typeof rawParams.courseSnapshot === "object" && !Array.isArray(rawParams.courseSnapshot)) {
    const forbidden = new Set(AI_FORBIDDEN_FIELDS.playbook ?? []);
    const snapshot: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawParams.courseSnapshot as Record<string, unknown>)) {
      if (!forbidden.has(key)) snapshot[key] = value;
    }
    if (Object.keys(snapshot).length > 0) params.courseSnapshot = snapshot;
  }
  return { page: obj.page, params };
}

/**
 * Short preamble naming the user's current page, active tab, and any visible
 * sections. Built only when pageContext is present and only appended to the
 * DATA-mode system prompt by the caller.
 */
export function buildPageContextBlock(pageContext: PageContextHint | undefined): string {
  if (!pageContext?.page) return "";
  const lines = [`Current page: ${pageContext.page}`];
  const tabBits: string[] = [];
  if (pageContext.params.activeTab) tabBits.push(`Active tab: ${pageContext.params.activeTab}`);
  if (pageContext.params.visibleSections && pageContext.params.visibleSections.length > 0) {
    tabBits.push(`Active section: ${pageContext.params.visibleSections.join(", ")}`);
  }
  if (tabBits.length > 0) lines.push(tabBits.join(" | "));

  // #1225 — when the operator is on a course page, append the course
  // snapshot so the AI can propose informed deltas instead of asking
  // "what is the current value?". Serialised as JSON inside a fenced
  // block so the AI sees structure without parser ambiguity.
  let snapshotBlock = "";
  if (pageContext.page === "course" && pageContext.params.courseSnapshot) {
    snapshotBlock =
      "\n\n## Current course snapshot (live editable surface)\n" +
      "```json\n" +
      JSON.stringify(pageContext.params.courseSnapshot, null, 2) +
      "\n```";
  }

  return `\n\n## Page context (what the user is looking at)\n${lines.join("\n")}${snapshotBlock}`;
}
