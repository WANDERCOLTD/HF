/**
 * Cmd+K scope-prefix parser (Epic #1442 Layer 3 Slice 5).
 *
 * Strips a trailing scope-prefix token from a Cmd+K DEMO-mode message so the
 * route layer can resolve the targeted cascade scope BEFORE handing the
 * stripped message to the LLM. The LLM then sees a clean command + a
 * synthetic scope-hint message injected by the route.
 *
 *   "set response-length 0.2 @bertie"   → CALLER scope, name = "bertie"
 *   "set response-length 0.2 ^OCEAN"    → PLAYBOOK scope, name = "OCEAN"
 *   "set response-length 0.2 ~education" → DOMAIN scope, name = "education"
 *   "set response-length 0.2 #system"   → SYSTEM scope (route gates on role)
 *
 * Slash-commands (`/wizard`, `/course-ref`, …) are left untouched — they are
 * dispatched through `parseCommand` in `commands.ts`. This parser bypasses
 * them so the two pipelines do not interfere.
 *
 * Multiple scope tokens in a single message are an error — operators must
 * pick one cascade target per command. The route surfaces a friendly
 * tool-error.
 */

export type ScopeToken =
  | { kind: "caller"; name: string }
  | { kind: "playbook"; name: string }
  | { kind: "domain"; name: string }
  | { kind: "system" };

export interface ParseScopeTokensResult {
  /** The message with the trailing scope token removed, trimmed. */
  stripped: string;
  /** The parsed scope token, or `null` if the message has none. */
  scopeToken: ScopeToken | null;
  /** Non-null when parsing rejected the message (e.g. multiple tokens). */
  error: string | null;
}

// Token regex matches:
//   - `@<name>` / `^<name>` / `~<name>` with [A-Za-z0-9_-]+ name
//   - bare `#system` literal (no name)
// Token must be preceded by whitespace and sit at end-of-string.
const TOKEN_PATTERN = /(?:\s)(?:@([A-Za-z0-9_-]+)|\^([A-Za-z0-9_-]+)|~([A-Za-z0-9_-]+)|#system)\s*$/;

// Detect "too many tokens" by scanning for ANY scope-prefix occurrence in the
// message (anchored by whitespace before the prefix). If more than one match
// reaches end-of-string-trimmed boundaries we reject.
const ANY_TOKEN_GLOBAL = /(?:^|\s)(@[A-Za-z0-9_-]+|\^[A-Za-z0-9_-]+|~[A-Za-z0-9_-]+|#system)(?=\s|$)/g;

export function parseScopeTokens(rawMessage: string): ParseScopeTokensResult {
  const message = rawMessage ?? "";

  // Slash-commands are handled by parseCommand — leave them alone.
  if (message.trimStart().startsWith("/")) {
    return { stripped: message, scopeToken: null, error: null };
  }

  // Count tokens. Two or more → multi-token error.
  const tokenMatches = message.match(ANY_TOKEN_GLOBAL) ?? [];
  if (tokenMatches.length >= 2) {
    return {
      stripped: message,
      scopeToken: null,
      error: "Too many scope tokens — use one of @caller ^course ~domain #system",
    };
  }

  // Try to extract a single trailing token. Anything else (token in the
  // middle of the message, not separated by whitespace, etc.) is treated
  // as no token — those cases will reach the LLM as raw text.
  const trailing = message.match(TOKEN_PATTERN);
  if (!trailing) {
    return { stripped: message, scopeToken: null, error: null };
  }

  const stripped = message.slice(0, trailing.index).trimEnd();
  const [, callerName, playbookName, domainName] = trailing;

  if (callerName) {
    return { stripped, scopeToken: { kind: "caller", name: callerName }, error: null };
  }
  if (playbookName) {
    return { stripped, scopeToken: { kind: "playbook", name: playbookName }, error: null };
  }
  if (domainName) {
    return { stripped, scopeToken: { kind: "domain", name: domainName }, error: null };
  }
  // The `#system` literal — no capture group.
  return { stripped, scopeToken: { kind: "system" }, error: null };
}
