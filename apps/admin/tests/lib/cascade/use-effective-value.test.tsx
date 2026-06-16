import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

import { useEffectiveValue } from "@/lib/cascade/use-effective-value";
import type { Effective } from "@/lib/cascade/layer-types";

const FAKE_ENVELOPE: Effective<unknown> = {
  value: 0.6,
  source: "DOMAIN",
  layers: [
    {
      layer: "SYSTEM",
      scopeId: null,
      scopeLabel: "System default",
      value: 0.5,
      setAt: null,
      setBy: null,
    },
    {
      layer: "DOMAIN",
      scopeId: "dom-1",
      scopeLabel: "Education",
      value: 0.6,
      setAt: new Date("2026-06-01"),
      setBy: "admin",
    },
  ],
  isInherited: true,
  recommendedLayerForEdit: "PLAYBOOK",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useEffectiveValue — Slice C2 (#1737)", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("short-circuits with unresolvable=true when knobKey is null", () => {
    const { result } = renderHook(() =>
      useEffectiveValue<unknown>(null, { courseId: "c1" }),
    );
    expect(result.current.unresolvable).toBe(true);
    expect(result.current.envelope).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches the route and returns the envelope on success (skillTierMapping family)", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FAKE_ENVELOPE),
    } as Response);

    const { result } = renderHook(() =>
      useEffectiveValue<unknown>("skillTierMapping", { courseId: "c1" }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.envelope).toEqual(FAKE_ENVELOPE);
    expect(result.current.unresolvable).toBe(false);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/cascade/resolve?knobKey=skillTierMapping"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain("courseId=c1");
  });

  it("marks unresolvable when the route returns 400 'Unknown cascade knob key'", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          ok: false,
          error: 'Unknown cascade knob key: "freshSetting"',
        }),
    } as Response);

    const { result } = renderHook(() =>
      useEffectiveValue<unknown>("freshSetting", { courseId: "c1" }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.unresolvable).toBe(true);
    expect(result.current.envelope).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces non-400 errors as `error` (network failure stays in error)", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ ok: false, error: "internal" }),
    } as Response);

    const { result } = renderHook(() =>
      useEffectiveValue<unknown>("skillScoringEmaHalfLifeDays", {
        courseId: "c1",
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("internal");
    expect(result.current.unresolvable).toBe(false);
  });

  it("threads voiceProvider family with playbookId-aliased courseId", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ...FAKE_ENVELOPE,
          value: "deepgram",
          source: "PLAYBOOK",
          isInherited: false,
        }),
    } as Response);

    const { result } = renderHook(() =>
      useEffectiveValue<string>("voiceProvider", { courseId: "course-abc" }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.envelope?.value).toBe("deepgram");
    expect(result.current.envelope?.source).toBe("PLAYBOOK");
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain(
      "courseId=course-abc",
    );
  });

  it("threads callerId when supplied in scope", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FAKE_ENVELOPE),
    } as Response);

    renderHook(() =>
      useEffectiveValue<unknown>("BEH-WARMTH", {
        courseId: "c1",
        callerId: "caller-1",
      }),
    );

    await waitFor(() => {
      expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(0);
    });

    const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(url).toContain("knobKey=BEH-WARMTH");
    expect(url).toContain("courseId=c1");
    expect(url).toContain("callerId=caller-1");
  });

  it("ignores out-of-order responses when the key changes mid-flight", async () => {
    // First call — slow.
    let resolveFirst: (v: Response) => void = () => {};
    const firstPromise = new Promise<Response>((res) => {
      resolveFirst = res;
    });
    // Second call — fast.
    const secondResponse = {
      ok: true,
      json: () =>
        Promise.resolve({ ...FAKE_ENVELOPE, value: "fast" }),
    } as Response;

    vi.mocked(global.fetch)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(secondResponse);

    const { result, rerender } = renderHook(
      ({ knob }: { knob: string }) =>
        useEffectiveValue<unknown>(knob, { courseId: "c1" }),
      { initialProps: { knob: "voiceProvider" } },
    );

    // Switch key before the first response arrives.
    rerender({ knob: "voiceId" });

    await waitFor(() => {
      expect(result.current.envelope?.value).toBe("fast");
    });

    // Now resolve the stale first call — it must not clobber state.
    resolveFirst({
      ok: true,
      json: () =>
        Promise.resolve({ ...FAKE_ENVELOPE, value: "stale" }),
    } as Response);

    // Allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.envelope?.value).toBe("fast");
  });
});
