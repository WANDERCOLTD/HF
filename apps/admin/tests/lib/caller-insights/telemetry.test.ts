import { describe, it, expect, beforeEach, vi } from "vitest";
import { setTelemetrySink, trackTabLoad } from "@/lib/caller-insights/telemetry";

describe("telemetry", () => {
  beforeEach(() => {
    setTelemetrySink(null);
  });

  it("is a no-op when no sink wired", () => {
    expect(() => trackTabLoad("uplift-v2")).not.toThrow();
  });

  it("fires sink with event and payload", () => {
    const sink = vi.fn();
    setTelemetrySink(sink);

    trackTabLoad("uplift-v2");

    expect(sink).toHaveBeenCalledTimes(1);
    const [event, payload] = sink.mock.calls[0];
    expect(event).toBe("tab_load");
    expect(payload.tab).toBe("uplift-v2");
    expect(typeof payload.ts).toBe("number");
  });

  it("swallows sink errors so UI is never broken", () => {
    setTelemetrySink(() => {
      throw new Error("sink exploded");
    });
    expect(() => trackTabLoad("uplift-v2")).not.toThrow();
  });
});
