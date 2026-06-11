/**
 * VoiceFlowLens — Slice 1 read-only diagram coverage (#1478).
 *
 * Pins:
 *   - 6 nodes render in the confirmed top-to-bottom order
 *   - fillerInjectionEnabled is NEVER rendered (Amendment B regression)
 *   - VAPI-only nodes hidden + replaced by the muted placeholder when
 *     enabledProviderSlug !== "vapi"
 *   - Origin pill copy reflects the cascade source
 *   - Loading skeleton → diagram transition fires after fetch resolves
 *   - Error banner renders + Retry button re-fetches
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { VoiceFlowLens } from "@/app/x/courses/[courseId]/_components/VoiceFlowLens";

const COURSE_ID = "pb_test_123";

function makeVapiPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    playbookId: COURSE_ID,
    playbookName: "Test Course",
    enabledProviderSlug: "vapi",
    enabledProviderId: "vp_vapi_1",
    resolved: {
      provider: { value: "vapi", source: "system" },
      model: { value: "gpt-4o-mini", source: "system" },
      fields: {
        voiceProvider: { value: "deepgram", source: "system" },
        voiceId: { value: "aura-asteria-en", source: "course" },
        transcriber: { value: "deepgram", source: "provider" },
        transcriberEndpointingMs: { value: 200, source: "system" },
        transcriptStreamEnabled: { value: true, source: "domain" },
        voicemailDetectionEnabled: { value: false, source: "system" },
        maxCostPerCallUsd: { value: 0.5, source: "course" },
        autoPipeline: { value: true, source: "system" },
        // Ghost field included in the cascade — lens must filter it out.
        fillerInjectionEnabled: { value: true, source: "system" },
      },
    },
    allowedKeys: [
      "voiceProvider",
      "voiceId",
      "transcriber",
      "transcriberEndpointingMs",
      "transcriptStreamEnabled",
      "fillerInjectionEnabled",
      "voicemailDetectionEnabled",
      "maxCostPerCallUsd",
      "autoPipeline",
    ],
    schemaFields: [
      { key: "voiceProvider", label: "Voice provider", type: "enum", enumValues: ["deepgram", "openai"] },
      { key: "voiceId", label: "Voice id", type: "string" },
      { key: "transcriber", label: "Transcriber", type: "enum", enumValues: ["deepgram", "assembly-ai"] },
      { key: "transcriberEndpointingMs", label: "Transcriber endpointing (ms)", type: "number" },
      { key: "transcriptStreamEnabled", label: "Transcript stream", type: "boolean" },
      { key: "fillerInjectionEnabled", label: "Filler injection", type: "boolean" },
      { key: "voicemailDetectionEnabled", label: "Voicemail detection", type: "boolean" },
      { key: "maxCostPerCallUsd", label: "Max cost per call (USD)", type: "number" },
      { key: "autoPipeline", label: "Auto-run pipeline after each call", type: "boolean" },
    ],
    courseOverrides: { voiceId: "aura-asteria-en", maxCostPerCallUsd: 0.5 },
    ...overrides,
  };
}

function makeNonVapiPayload() {
  return makeVapiPayload({
    enabledProviderSlug: "elevenlabs",
    enabledProviderId: "vp_eleven_1",
    resolved: {
      provider: { value: "elevenlabs", source: "system" },
      model: { value: null, source: "system" },
      fields: {
        voiceProvider: { value: "elevenlabs", source: "system" },
        voiceId: { value: "rachel", source: "course" },
        // Non-VAPI providers don't expose transcriber-* / transcriptStreamEnabled
        voicemailDetectionEnabled: { value: false, source: "system" },
        maxCostPerCallUsd: { value: 0.5, source: "system" },
        autoPipeline: { value: true, source: "system" },
      },
    },
    allowedKeys: [
      "voiceProvider",
      "voiceId",
      "voicemailDetectionEnabled",
      "maxCostPerCallUsd",
      "autoPipeline",
    ],
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VoiceFlowLens — Slice 1 read-only diagram", () => {
  it("renders all 6 cascade-bound nodes in confirmed top-to-bottom order on a VAPI course", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeVapiPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(screen.getByText("Pickup")).toBeInTheDocument());

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Pickup",
      "Voice Provider",
      "Selected Voice",
      "Transcriber",
      "During the call",
      "End of call",
      "Post-call summary",
    ]);
  });

  it("requests the cascade with the courseId mapped onto the playbookId URL segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeVapiPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(`/api/playbooks/${COURSE_ID}/voice-config`);
  });

  it("NEVER renders fillerInjectionEnabled (Amendment B — hardcoded exclusion of the VAPI ghost field)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeVapiPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(screen.getByText("During the call")).toBeInTheDocument());

    expect(screen.queryByText(/Filler injection/i)).toBeNull();
    expect(screen.queryByText(/filler/i)).toBeNull();
  });

  it("renders the muted placeholder for the Transcriber node when enabledProviderSlug is not vapi", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeNonVapiPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(screen.getByText("Transcriber")).toBeInTheDocument());

    const placeholder = screen.getByText(/Not configurable for/i);
    expect(placeholder).toBeInTheDocument();
    expect(placeholder.textContent).toContain("elevenlabs");
  });

  it("renders an origin pill describing the cascade source for each row", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeVapiPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(screen.getByText("Voice Provider")).toBeInTheDocument());

    expect(screen.getAllByText("Set at Course").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/System default|Provider default|Set at Domain/).length).toBeGreaterThan(0);
  });

  it("renders the loading skeleton before the fetch resolves", async () => {
    let resolveFetch: ((v: unknown) => void) | null = null;
    const pending = new Promise((res) => {
      resolveFetch = res;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<VoiceFlowLens courseId={COURSE_ID} />);

    expect(container.querySelector(".hf-voice-flow-skeleton")).not.toBeNull();

    // Cleanup
    await act(async () => {
      resolveFetch?.({ ok: true, json: async () => makeVapiPayload() });
      await pending.catch(() => {});
    });
  });

  it("renders an error banner with a Retry button when the fetch fails, and retry re-fetches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => makeVapiPayload() });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(screen.getByText(/Voice config:/i)).toBeInTheDocument());

    const retry = screen.getByRole("button", { name: /retry/i });
    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => expect(screen.getByText("Voice Provider")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders edit buttons that are disabled in Slice 1 (drawer wired in Slice 2)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeVapiPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(screen.getByText("Voice Provider")).toBeInTheDocument());

    const editButtons = screen.getAllByRole("button", { name: /^Edit / });
    expect(editButtons.length).toBeGreaterThan(0);
    editButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("wraps the node list in an ordered list with the call-lifecycle aria-label", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeVapiPayload(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceFlowLens courseId={COURSE_ID} />);

    await waitFor(() => expect(screen.getByText("Voice Provider")).toBeInTheDocument());

    const list = screen.getByRole("list", { name: /call lifecycle voice configuration/i });
    expect(list.tagName).toBe("OL");
  });
});
