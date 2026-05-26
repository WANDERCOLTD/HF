/**
 * Pending-change payload returned by AI tool handlers (epic #854 / #873).
 *
 * Server-side AI tool handlers (`wizard-tool-executor.ts`,
 * `admin-tool-handlers.ts`, chat route tools) write compose-affecting
 * settings immediately as today. When they do, they ALSO return a
 * `pendingChange` field in their tool response. The client-side chat
 * message renderer reads this field and pushes it into the
 * PendingChangesTray with `aiSuggested: true` — so the educator can see
 * what the AI just did and decide whether to recompose.
 *
 * Why not just push to the tray server-side?
 *   The tray is a React Context on the client; the server has no handle
 *   to it. Server-emitted payload → client-side push is the only path.
 *
 * Field shape mirrors `TrayEntry` minus the client-only `id` (generated
 * on push) and `aiSuggested` (always true for AI payloads — the renderer
 * sets it). `fanoutScope` defaults to `'caller'` since AI tools may not
 * request `'all'` (enforced by `hf-recompose/no-ai-fanout-all` ESLint
 * rule + server-side `/api/recompose/apply` guard).
 */

export interface PendingChangePayload {
  /** Canonical config key path. e.g. `"tolerances.masteryThreshold"`. */
  key: string;
  /** Human-readable field label. e.g. `"Mastery threshold"`. */
  label: string;
  /** Human-readable scope label. e.g. `"Course IELTS Prep"`. */
  scopeLabel: string;
  /** Original DB value as display string. */
  beforeValue: string;
  /** Proposed new value as display string. */
  afterValue: string;
  scope: "playbook" | "domain" | "system";
  /** UUID of the playbook/domain. Null for `scope: 'system'`. */
  scopeId: string | null;
  /** Always 'caller' for AI-sourced changes (server enforces). */
  fanoutScope: "caller" | "none";
}

/**
 * Build a payload from a successful AI helper call. Centralised so all
 * tool handlers produce consistent shape (labels, scope inference).
 */
export interface BuildPendingChangePayloadArgs {
  scope: "playbook" | "domain" | "system";
  scopeId: string | null;
  scopeLabel: string;
  key: string;
  label: string;
  beforeValue: unknown;
  afterValue: unknown;
}

export function buildPendingChangePayload(
  args: BuildPendingChangePayloadArgs,
): PendingChangePayload {
  return {
    key: args.key,
    label: args.label,
    scopeLabel: args.scopeLabel,
    beforeValue: stringifyValue(args.beforeValue),
    afterValue: stringifyValue(args.afterValue),
    scope: args.scope,
    scopeId: args.scopeId,
    fanoutScope: "caller",
  };
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Extract a pendingChange payload from a stringified tool result.
 *
 * `lib/chat/admin-tool-handlers.ts::executeAdminTool` returns a JSON-
 * stringified blob (so the AI loop can append it as a tool_result block).
 * The chat route needs to pluck pendingChange OUT of that string before
 * the result goes back to the model — otherwise the AI sees the field
 * (harmless but noisy) and the client gets nothing in the
 * X-Pending-Changes header.
 *
 * Defensive on parse failure: tool results may be truncated at
 * MAX_RESULT_LENGTH (3000) producing invalid JSON. In that case we
 * silently return null — accepting that very-long tool results lose
 * their tray push as a v1 limitation.
 */
export function extractPendingChangeFromToolResult(
  toolResultString: string,
): PendingChangePayload | null {
  if (typeof toolResultString !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolResultString);
  } catch {
    return null;
  }
  return hasPendingChangePayload(parsed) ? parsed.pendingChange : null;
}

/**
 * Type guard — detects whether a chat tool result carries a pending-change
 * payload. Tool results are heterogenous shapes; this narrows safely.
 */
export function hasPendingChangePayload(
  obj: unknown,
): obj is { pendingChange: PendingChangePayload } {
  if (!obj || typeof obj !== "object") return false;
  const candidate = (obj as { pendingChange?: unknown }).pendingChange;
  if (!candidate || typeof candidate !== "object") return false;
  const p = candidate as Record<string, unknown>;
  return (
    typeof p.key === "string" &&
    typeof p.label === "string" &&
    typeof p.scopeLabel === "string" &&
    typeof p.beforeValue === "string" &&
    typeof p.afterValue === "string" &&
    (p.scope === "playbook" || p.scope === "domain" || p.scope === "system") &&
    (typeof p.scopeId === "string" || p.scopeId === null) &&
    (p.fanoutScope === "caller" || p.fanoutScope === "none")
  );
}
