/**
 * URL-based scope inference (Epic #1442 Layer 3 Slice 5).
 *
 * When an operator types a Cmd+K DEMO-mode command with NO trailing scope
 * token, we try to infer the target cascade scope from the URL the chat
 * panel is mounted on. This mirrors the operator's intuition: "I'm on the
 * OCEAN course page → my set-knob command targets this course."
 *
 * Inference rules:
 *   `/x/courses/[courseId]`  → PLAYBOOK { playbookId: courseId }
 *   `/x/callers/[callerId]`  → CALLER   { callerId }
 *   `/x/domains/[domainId]`  → DOMAIN   { domainId }
 *   anything else            → { ok: false, reason: "Specify a scope, …" }
 *
 * We deliberately do NOT silently default to `toolDefaultLayer` when the URL
 * lacks a scope hint — per ADR §3.4 we ask the operator to be explicit. The
 * `toolDefaultLayer` argument exists for tools that are intrinsically
 * scope-bound (e.g. read-only `open_sim` on CALLER) but the route is
 * expected to drive the no-token path via the LLM asking for clarification
 * rather than this helper inventing a default.
 */

export type ScopeInferResult =
  | { ok: true; layer: "PLAYBOOK"; scopeIds: { playbookId: string } }
  | { ok: true; layer: "CALLER"; scopeIds: { callerId: string } }
  | { ok: true; layer: "DOMAIN"; scopeIds: { domainId: string } }
  | { ok: false; reason: string };

const COURSE_PATTERN = /^\/x\/courses\/([^/?#]+)/;
const CALLER_PATTERN = /^\/x\/callers\/([^/?#]+)/;
const DOMAIN_PATTERN = /^\/x\/domains\/([^/?#]+)/;

const ASK_FOR_SCOPE = "Specify a scope, e.g. @bertie or ^OCEAN";

export function inferScopeFromUrl(
  pageHintRoute: string | undefined | null,
): ScopeInferResult {
  if (!pageHintRoute) {
    return { ok: false, reason: ASK_FOR_SCOPE };
  }

  const course = pageHintRoute.match(COURSE_PATTERN);
  if (course) {
    return { ok: true, layer: "PLAYBOOK", scopeIds: { playbookId: course[1] } };
  }

  const caller = pageHintRoute.match(CALLER_PATTERN);
  if (caller) {
    return { ok: true, layer: "CALLER", scopeIds: { callerId: caller[1] } };
  }

  const domain = pageHintRoute.match(DOMAIN_PATTERN);
  if (domain) {
    return { ok: true, layer: "DOMAIN", scopeIds: { domainId: domain[1] } };
  }

  return { ok: false, reason: ASK_FOR_SCOPE };
}
