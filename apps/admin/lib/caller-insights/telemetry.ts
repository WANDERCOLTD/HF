/**
 * Lightweight tab-load telemetry for the v1 → v2 cutover gate.
 *
 * Without this, the cutover criterion ("≥95% v2 traffic") is unverifiable.
 * Falls back silently when no analytics sink is configured — never throws.
 */

type SinkPayload = { tab: string; ts: number };
type Sink = (event: "tab_load", payload: SinkPayload) => void;

let sink: Sink | null = null;

/** Wire in a sink at app start. No-op when never called. */
export function setTelemetrySink(s: Sink | null): void {
  sink = s;
}

/** Fire once on each tab activation. Silent on error. */
export function trackTabLoad(tabName: string): void {
  if (!sink) return;
  try {
    sink("tab_load", { tab: tabName, ts: Date.now() });
  } catch {
    // Telemetry must never break the UI.
  }
}
