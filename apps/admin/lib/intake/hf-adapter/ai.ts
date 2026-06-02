// HF AIPort singleton — wraps @tallyseal/ai-anthropic with HF's
// Anthropic SDK instance.
//
// This is the ONE allowed @anthropic-ai/sdk import point in HF's
// intake compliance code. Per CLAUDE.md C5 discipline + the boundary
// facade rules, no other file in apps/admin/lib/intake/** /
// apps/admin/app/intake/** / apps/admin/app/api/intake/** /
// apps/admin/components/intake/** may import @anthropic-ai/sdk
// directly.
//
// Returns null when ANTHROPIC_API_KEY is missing — callers fall back
// to the deterministic interview stub (used by tests + when running
// without a key). In production, a missing key should fail loudly at
// boot — see startup check in app/api/intake/bootstrap/route.ts.

import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicAdapter } from "@/lib/intake/tallyseal";
import type { AIPort } from "@/lib/intake/tallyseal";

let aiPortSingleton: AIPort | null = null;

export function getIntakeAIPort(): AIPort | null {
  if (aiPortSingleton) return aiPortSingleton;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  aiPortSingleton = createAnthropicAdapter({
    // Cast: @anthropic-ai/sdk Anthropic class implements (and extends)
    // the structural AnthropicClient interface the adapter accepts.
    client: client as unknown as Parameters<typeof createAnthropicAdapter>[0]["client"],
    // regionStrategy 'pass-through' is the spike posture — Anthropic
    // is US-based. Tighten to 'strict' or 'forbid' after Q-SC6
    // (Anthropic EU residency) resolves. NEVER ship non-test traffic
    // at 'pass-through' to EU data subjects without DPA-approved SCCs.
    regionStrategy: { kind: "pass-through" },
  });
  return aiPortSingleton;
}

/** Test-only: reset the singleton between fixtures. */
export function __resetIntakeAIPort(): void {
  aiPortSingleton = null;
}
