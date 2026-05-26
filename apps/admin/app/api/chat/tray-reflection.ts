/**
 * #873 follow-up — bidirectional reflection between the
 * PendingChangesTray and the AI chat.
 *
 * When the user clicks Save & apply or Discard on a tray entry that
 * came from the AI, the AI should know about that decision on its next
 * turn — otherwise the chat feels one-sided ("I proposed X. ... ok now
 * what?" while the user has actually applied or rejected X).
 *
 * Pattern: the client (ChatContext) queues `hf:tray-applied` and
 * `hf:tray-discarded` CustomEvents emitted by the tray, then forwards
 * the queue with the next `/api/chat` request as a `trayReflections`
 * field. This route parses + validates the field, formats each entry
 * as a short synthetic user message ("[tray] User applied: ...") that
 * the AI sees in its conversation history. The AI's system prompts
 * instruct it to acknowledge the reflection naturally on its next turn.
 *
 * Why a synthetic user message vs. a system-role message?
 *   Anthropic's messages array supports user/assistant only; system
 *   is a top-level field. To avoid forking handler logic, we encode
 *   the reflection as a prefixed user-role message that the AI treats
 *   as context. Same convention as `[system]` notes used elsewhere.
 */

export type TrayReflectionAction = "applied" | "discarded";

export interface TrayReflection {
  action: TrayReflectionAction;
  /** Human-readable entry summaries (label + scope + diff). */
  entries: Array<{
    label: string;
    scopeLabel: string;
    beforeValue: string;
    afterValue: string;
  }>;
  /** True if Toggle 1 fired (single-caller recompose). */
  toggleCaller?: boolean;
  /** True if Toggle 2 fired (cohort recompose). */
  toggleAll?: boolean;
  /** Caller name in context at the time of the decision, if any. */
  callerInContext?: string | null;
  /** ISO timestamp of the user's decision. */
  decidedAt?: string;
}

interface RawEntry {
  label?: unknown;
  scopeLabel?: unknown;
  beforeValue?: unknown;
  afterValue?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * Parse the request body's `trayReflections` field defensively. Returns
 * an empty array on any shape error — the AI continues without the
 * reflection rather than the route 400'ing on malformed client input.
 */
export function parseTrayReflections(raw: unknown): TrayReflection[] {
  if (!Array.isArray(raw)) return [];
  const out: TrayReflection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.action !== "applied" && o.action !== "discarded") continue;
    if (!Array.isArray(o.entries)) continue;
    const entries: TrayReflection["entries"] = [];
    for (const e of o.entries as RawEntry[]) {
      if (!e || typeof e !== "object") continue;
      if (
        !isString(e.label) ||
        !isString(e.scopeLabel) ||
        !isString(e.beforeValue) ||
        !isString(e.afterValue)
      ) {
        continue;
      }
      entries.push({
        label: e.label,
        scopeLabel: e.scopeLabel,
        beforeValue: e.beforeValue,
        afterValue: e.afterValue,
      });
    }
    if (entries.length === 0) continue;
    out.push({
      action: o.action,
      entries,
      toggleCaller: typeof o.toggleCaller === "boolean" ? o.toggleCaller : undefined,
      toggleAll: typeof o.toggleAll === "boolean" ? o.toggleAll : undefined,
      callerInContext: isString(o.callerInContext) ? o.callerInContext : null,
      decidedAt: isString(o.decidedAt) ? o.decidedAt : undefined,
    });
  }
  return out;
}

/**
 * Format a single reflection as a synthetic user-role message body.
 * Kept short — the AI sees this as conversation context, not a request.
 */
export function formatTrayReflection(r: TrayReflection): string {
  const lines: string[] = [];
  const action = r.action === "applied" ? "applied" : "discarded";
  const entrySummary = r.entries
    .map((e) => `${e.scopeLabel} · ${e.label}: ${e.beforeValue} → ${e.afterValue}`)
    .join("; ");
  lines.push(`[tray] User ${action} ${r.entries.length} pending change${r.entries.length === 1 ? "" : "s"}: ${entrySummary}.`);
  if (r.action === "applied") {
    const flags: string[] = [];
    if (r.toggleCaller && r.callerInContext) flags.push(`recomposed ${r.callerInContext}`);
    if (r.toggleAll) flags.push("recomposed cohort");
    if (flags.length === 0) flags.push("no immediate recompose (lazy on next call)");
    lines.push(`Toggles: ${flags.join(", ")}.`);
  }
  return lines.join(" ");
}

/**
 * Build the conversation-history entries to prepend before the user's
 * new turn so the AI sees the reflections in chronological order.
 */
export function buildReflectionMessages(
  reflections: TrayReflection[],
): Array<{ role: "user"; content: string }> {
  return reflections.map((r) => ({
    role: "user" as const,
    content: formatTrayReflection(r),
  }));
}
