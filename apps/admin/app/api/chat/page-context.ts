/**
 * #809 — DATA-mode pageContext parser + system-prompt block builder.
 *
 * Lives next to route.ts and system-prompts.ts because both consume it:
 * route.ts parses the request body into the typed shape, system-prompts.ts
 * renders it into a short prompt preamble.
 */

export interface PageContextHint {
  page: string;
  params: {
    activeTab?: string;
    visibleSections?: string[];
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
  return `\n\n## Page context (what the user is looking at)\n${lines.join("\n")}`;
}
