/**
 * HF-internal metadata for admin tools (Epic #1442 Layer 3 Slice 5).
 *
 * Keyed by tool name. Stored separately from `AITool` in `lib/ai/client.ts`
 * because `AITool` is forwarded verbatim to the Anthropic SDK at
 * `lib/ai/client.ts:209-211` — adding HF-internal fields directly would
 * produce 422s from the SDK.
 *
 * Used by the DEMO mode route handler to look up a tool's default cascade
 * layer when the operator types a command with no scope-prefix token and
 * the URL is non-scoped (see `scope-infer.ts`). This file MUST NEVER be
 * imported by any code path that emits Anthropic SDK payloads — the
 * presence of HF-internal fields on the wire would break tool-calling.
 */

import type { Layer } from "@/lib/cascade/layer-types";

export interface HFToolMeta {
  /** Default cascade layer for this tool when no scope token is supplied. */
  defaultLayer?: Layer;
}

/**
 * The 6 demo + cascade-write tools that participate in scope-prefix
 * inference. Tools without an entry here treat scope-inference as opt-out
 * (lookup returns `undefined`).
 */
export const HF_TOOL_META: Record<string, HFToolMeta> = {
  apply_demo_preset: { defaultLayer: "PLAYBOOK" },
  precompose_for_fresh_learner: { defaultLayer: "PLAYBOOK" },
  dry_run_prompt: { defaultLayer: "PLAYBOOK" },
  test_voice: { defaultLayer: "PLAYBOOK" },
  open_sim: { defaultLayer: "CALLER" },
  update_behavior_target: { defaultLayer: "PLAYBOOK" },
};
