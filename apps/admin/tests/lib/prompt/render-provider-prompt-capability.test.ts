/**
 * Tests for renderProviderPrompt capability-awareness (#1093).
 *
 * Validates that the same ComposedPrompt produces correct text for
 * VAPI (HTTP knowledge + tools + chat rail open) vs Retell-skeleton
 * (preuploaded knowledge + WSS tools + audio-only) without recomposing.
 */

import { describe, it, expect } from "vitest";

import {
  renderProviderPrompt,
  DEFAULT_RENDER_CAPABILITIES,
  DEFAULT_RENDER_RUNTIME,
} from "@/lib/prompt/composition/renderPromptSummary";
import type { VoiceProviderCapabilities } from "@/lib/voice/types";
import type { VoiceRuntimeFeatures } from "@/lib/voice/runtime-features";

const minimalLlmPrompt = {
  identity: { role: "tutor", style: "warm" },
  curriculum: { focusModule: "Algebra Basics" },
  instructions: { voice: { style: "warm and patient" } },
} as unknown as Parameters<typeof renderProviderPrompt>[0];

const VAPI_CAPS: VoiceProviderCapabilities = {
  endOfCallEvents: "single",
  hasKnowledgeCallback: true,
  toolCallsOverWebSocket: false,
  supportsRequestEndCall: true,
  orchestrationMode: "vendor-cloud",
};

const RETELL_CAPS: VoiceProviderCapabilities = {
  endOfCallEvents: "split",
  hasKnowledgeCallback: false,
  toolCallsOverWebSocket: true,
  supportsRequestEndCall: true,
  orchestrationMode: "vendor-cloud",
};

const CHAT_RAIL_RUNTIME: VoiceRuntimeFeatures = {
  callId: "call_abc",
  hasChatRail: true,
  hasSmsRail: false,
  hasWhatsAppRail: false,
};

const SMS_ONLY_RUNTIME: VoiceRuntimeFeatures = {
  callId: "call_abc",
  hasChatRail: false,
  hasSmsRail: true,
  hasWhatsAppRail: false,
};

const NO_RAILS_RUNTIME: VoiceRuntimeFeatures = {
  callId: "call_abc",
  hasChatRail: false,
  hasSmsRail: false,
  hasWhatsAppRail: false,
};

describe("renderProviderPrompt — capability-aware (#1093)", () => {
  it("backward-compatible: no caps + no runtime → defaults to VAPI shape", () => {
    const rendered = renderProviderPrompt(minimalLlmPrompt);
    // Default caps have hasKnowledgeCallback: true, so the rendered text
    // is the existing-behaviour wording.
    expect(rendered).toContain("automatically provide relevant material");
    expect(rendered).not.toContain("no mid-turn retrieval");
  });

  it("VAPI caps + chat rail → 'automatically provide' + 'take a look at the chat'", () => {
    const rendered = renderProviderPrompt(
      minimalLlmPrompt,
      VAPI_CAPS,
      CHAT_RAIL_RUNTIME,
    );
    expect(rendered).toContain("automatically provide");
    expect(rendered).toContain("take a look at the chat");
    expect(rendered).toContain("share_content");
  });

  it("Retell caps (no HTTP knowledge) → 'pre-loaded, no mid-turn retrieval'", () => {
    const rendered = renderProviderPrompt(
      minimalLlmPrompt,
      RETELL_CAPS,
      CHAT_RAIL_RUNTIME,
    );
    expect(rendered).toContain("pre-loaded");
    expect(rendered).toContain("no mid-turn retrieval");
    expect(rendered).not.toContain("automatically provide relevant material");
  });

  it("SMS-only runtime → 'I'm texting you' phrasing", () => {
    const rendered = renderProviderPrompt(
      minimalLlmPrompt,
      VAPI_CAPS,
      SMS_ONLY_RUNTIME,
    );
    expect(rendered).toContain("I'm texting you");
    expect(rendered).not.toContain("take a look at the chat");
  });

  it("No-rails runtime → 'follow up after the call' phrasing", () => {
    const rendered = renderProviderPrompt(
      minimalLlmPrompt,
      VAPI_CAPS,
      NO_RAILS_RUNTIME,
    );
    expect(rendered).toContain("follow up after the call");
  });

  it("Cross-provider portability: same llmPrompt → different rendered text for VAPI vs Retell", () => {
    const vapi = renderProviderPrompt(
      minimalLlmPrompt,
      VAPI_CAPS,
      CHAT_RAIL_RUNTIME,
    );
    const retell = renderProviderPrompt(
      minimalLlmPrompt,
      RETELL_CAPS,
      CHAT_RAIL_RUNTIME,
    );
    // Knowledge-section text MUST differ
    expect(vapi).not.toEqual(retell);
    expect(vapi).toContain("automatically provide");
    expect(retell).toContain("pre-loaded");
    // But the IDENTITY / OPENING sections (capability-blind) should
    // still appear in both. Probe one stable string.
    expect(vapi).toContain("[IDENTITY]");
    expect(retell).toContain("[IDENTITY]");
  });

  it("exports DEFAULT_RENDER_CAPABILITIES and DEFAULT_RENDER_RUNTIME for downstream callers", () => {
    expect(DEFAULT_RENDER_CAPABILITIES.hasKnowledgeCallback).toBe(true);
    expect(DEFAULT_RENDER_RUNTIME.hasChatRail).toBe(true);
  });
});
