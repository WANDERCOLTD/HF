import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type { JourneySettingContract } from "@/lib/journey/setting-contracts";
import { useCascadeEditField } from "@/lib/journey/use-cascade-edit-field";

const contract: JourneySettingContract = {
  id: "welcomeMessage",
  group: "G2",
  educatorLabel: "Opening line",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: {
    sections: ["welcome"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

describe("useCascadeEditField", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts not dirty with draft === value", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      useCascadeEditField<string>({ contract, value: "hello", onSave }),
    );
    expect(result.current.draftValue).toBe("hello");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isSaving).toBe(false);
  });

  it("flips dirty when setDraftValue changes", () => {
    const { result } = renderHook(() =>
      useCascadeEditField<string>({ contract, value: "a", onSave: vi.fn() }),
    );
    act(() => result.current.setDraftValue("b"));
    expect(result.current.isDirty).toBe(true);
  });

  it("commit fires onSave with draft", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useCascadeEditField<string>({ contract, value: "a", onSave }),
    );
    act(() => result.current.setDraftValue("b"));
    await act(async () => {
      await result.current.commit();
    });
    expect(onSave).toHaveBeenCalledWith("b");
  });

  it("commitDebounced delays the save by debounceMs", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useCascadeEditField<string>({
        contract,
        value: "a",
        onSave,
        debounceMs: 200,
      }),
    );
    act(() => {
      result.current.setDraftValue("b");
      result.current.commitDebounced();
    });
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("reset drops the draft back to upstream value", () => {
    const { result } = renderHook(() =>
      useCascadeEditField<string>({
        contract,
        value: "a",
        onSave: vi.fn(),
      }),
    );
    act(() => result.current.setDraftValue("dirty"));
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.draftValue).toBe("a");
    expect(result.current.isDirty).toBe(false);
  });

  it("upstream value change is adopted when not dirty", () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) =>
        useCascadeEditField<string>({ contract, value: v, onSave: vi.fn() }),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "b" });
    expect(result.current.draftValue).toBe("b");
  });

  it("upstream value change is ignored when dirty", () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) =>
        useCascadeEditField<string>({ contract, value: v, onSave: vi.fn() }),
      { initialProps: { v: "a" } },
    );
    act(() => result.current.setDraftValue("draft"));
    rerender({ v: "b" });
    expect(result.current.draftValue).toBe("draft");
  });
});
