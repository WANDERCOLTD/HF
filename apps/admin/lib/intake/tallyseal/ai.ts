// AIPort adapter for Anthropic — the C5-LOCKED boundary.
//
// ┌────────────────────────────────────────────────────────────────┐
// │ DO NOT re-export anything from @anthropic-ai/sdk here.         │
// │ DO NOT re-export anything from @anthropic-ai/sdk anywhere.     │
// │                                                                │
// │ HF feature code talks to AI via the AIPort surface only.       │
// │ @anthropic-ai/sdk types must not appear in HF compliance code. │
// │                                                                │
// │ See docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md      │
// │ § "Versioning + sync strategy" anti-patterns table.            │
// └────────────────────────────────────────────────────────────────┘

export {
  createAnthropicAdapter,
  DEFAULT_ANTHROPIC_PRICING,
  TALLYSEAL_AI_ANTHROPIC_VERSION,
} from "@tallyseal/ai-anthropic";

export type { ModelPricing, ModelPricingTable } from "@tallyseal/ai-anthropic";
