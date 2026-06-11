"use client";

import { useEffect, useState } from "react";

import "./cascade.css";

import type { Effective, Layer, LayerHit } from "@/lib/cascade/layer-types";

const LAYER_ORDER: readonly Layer[] = [
  "SYSTEM",
  "DOMAIN",
  "PLAYBOOK",
  "SEGMENT",
  "CALLER",
  "CALL",
];

/**
 * Operator-facing layer labels. The schema uses `Playbook` for the model
 * name; operators think and read in courses. Map the cascade Layer enum
 * onto the words educators see elsewhere in the app.
 */
function layerLabel(layer: Layer): string {
  switch (layer) {
    case "SYSTEM":
      return "System default";
    case "DOMAIN":
      return "Domain";
    case "PLAYBOOK":
      return "Course";
    case "SEGMENT":
      return "Segment";
    case "CALLER":
      return "Caller";
    case "CALL":
      return "Call";
  }
}

interface ScopeChainArg {
  playbookId?: string;
  callerId?: string;
  domainId?: string;
}

export interface CascadeInspectorTrayProps {
  /** Knob key to resolve, e.g. "BEH-WARMTH" or "welcomeMessage". */
  knobKey: string;
  /** Human label for the tray title (e.g., "Warmth"). */
  knobLabel: string;
  /** Scope IDs to thread into `GET /api/cascade/resolve`. */
  scopeChain: ScopeChainArg;
  /** Operator's current editing scope — drives CTA label (default PLAYBOOK). */
  currentEditScope?: Layer;
  /** Called when operator clicks the override-here CTA. */
  onOverrideAtCurrentScope?: (envelope: Effective<unknown>) => void;
  /** Called when operator clicks the deeper-scope CTA. */
  onPickDeeperScope?: (envelope: Effective<unknown>) => void;
  /** Called when operator clicks reset-to-inherited. */
  onResetToInherited?: (envelope: Effective<unknown>) => void;
  /** Called when operator closes the tray. */
  onClose: () => void;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "— not set";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 77) + "…" : v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  } catch {
    return String(v);
  }
}

function fmtSetAt(setAt: string | Date | null): string {
  if (!setAt) return "";
  try {
    return new Date(setAt).toLocaleDateString();
  } catch {
    return "";
  }
}

function ChainRow({
  hit,
  isWinner,
  isOverridden,
}: {
  hit: LayerHit<unknown>;
  isWinner: boolean;
  isOverridden: boolean;
}) {
  const cls = [
    "hf-cascade-tray-chain-row",
    isWinner && "hf-cascade-tray-chain-row--winner",
    isOverridden && "hf-cascade-tray-chain-row--overridden",
  ]
    .filter(Boolean)
    .join(" ");
  const setBy = hit.setBy ?? "(unknown)";
  const setAt = fmtSetAt(hit.setAt as string | Date | null);

  return (
    <div className={cls} data-layer={hit.layer.toLowerCase()}>
      <div className="hf-cascade-tray-row-label">
        <div className="hf-cascade-tray-row-scope">
          {isWinner ? (
            <span className="hf-cascade-tray-row-winner-mark" aria-hidden>
              ✓{" "}
            </span>
          ) : null}
          {layerLabel(hit.layer)}
        </div>
        <div className="hf-cascade-tray-row-meta">
          {hit.scopeLabel}
          {setAt ? ` · Set by ${setBy} on ${setAt}` : setBy !== "(unknown)" ? ` · Set by ${setBy}` : ""}
        </div>
      </div>
      <div />
      <div className="hf-cascade-tray-row-value">{fmtValue(hit.value)}</div>
    </div>
  );
}

function EmptyRow({ layer }: { layer: Layer }) {
  return (
    <div className="hf-cascade-tray-chain-row" data-layer={layer.toLowerCase()}>
      <div className="hf-cascade-tray-row-label">
        <div className="hf-cascade-tray-row-scope">{layerLabel(layer)}</div>
        <div className="hf-cascade-tray-row-meta">(no value at this layer)</div>
      </div>
      <div />
      <div className="hf-cascade-tray-row-value">— not set</div>
    </div>
  );
}

/**
 * Slide-in cascade inspector. Reuses the `.hf-preview-sidetray*` CSS
 * family from the Course Design Console for the slide-in shell;
 * cascade-specific layout lives in `.hf-cascade-tray-*`.
 *
 * Fetches `GET /api/cascade/resolve?knobKey=…&playbookId=…&callerId=…`
 * on open. Renders the chain SYSTEM→CALL, marks the winner with `✓`,
 * crosses out overridden layers above it. CTA label flips between
 * "Override for <scope>" and "Replace override on <scope>" based on
 * whether `currentEditScope` already has a `LayerHit`.
 */
export function CascadeInspectorTray({
  knobKey,
  knobLabel,
  scopeChain,
  currentEditScope = "PLAYBOOK",
  onOverrideAtCurrentScope,
  onPickDeeperScope,
  onResetToInherited,
  onClose,
}: CascadeInspectorTrayProps) {
  const [envelope, setEnvelope] = useState<Effective<unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Resetting the load + error state at the top of the effect IS the
    // intended pattern when the knob or scope chain changes — the rule
    // is a false positive here, same pattern as use-pending-changes-tray.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({ knobKey });
    if (scopeChain.playbookId) qs.set("playbookId", scopeChain.playbookId);
    if (scopeChain.callerId) qs.set("callerId", scopeChain.callerId);
    if (scopeChain.domainId) qs.set("domainId", scopeChain.domainId);

    fetch(`/api/cascade/resolve?${qs.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<Effective<unknown>>;
      })
      .then((env) => {
        if (cancelled) return;
        setEnvelope(env);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [knobKey, scopeChain.playbookId, scopeChain.callerId, scopeChain.domainId]);

  const winnerLayer = envelope?.source ?? null;
  const winnerLabel = envelope?.layers.find((h) => h.layer === currentEditScope)
    ?.scopeLabel ?? scopeForLabel(currentEditScope, envelope);
  const hasHitAtCurrentScope =
    envelope?.layers.some((h) => h.layer === currentEditScope) ?? false;

  return (
    <>
      <div
        className="hf-preview-sidetray-backdrop"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="hf-preview-sidetray"
        role="dialog"
        aria-label={`Cascade inspector for ${knobLabel}`}
      >
        <header className="hf-preview-sidetray-header">
          <h2>{knobLabel}</h2>
          <button
            type="button"
            className="hf-preview-sidetray-close"
            onClick={onClose}
            aria-label="Close inspector"
          >
            ✕
          </button>
        </header>
        <div className="hf-preview-sidetray-body">
          {loading ? <div>Loading cascade…</div> : null}
          {error ? (
            <div role="alert">Could not load cascade — {error}</div>
          ) : null}
          {envelope ? (
            <>
              <div className="hf-cascade-tray-effective">
                <span className="hf-cascade-tray-effective-label">
                  Effective
                </span>
                <span className="hf-cascade-tray-effective-value">
                  {fmtValue(envelope.value)}
                </span>
              </div>
              <div className="hf-cascade-tray-chain">
                {LAYER_ORDER.map((layer) => {
                  const hit = envelope.layers.find((h) => h.layer === layer);
                  if (hit) {
                    const isWinner = hit.layer === winnerLayer;
                    const winnerIdx = LAYER_ORDER.findIndex(
                      (l) => l === winnerLayer,
                    );
                    const hitIdx = LAYER_ORDER.findIndex(
                      (l) => l === hit.layer,
                    );
                    const isOverridden = winnerIdx > -1 && hitIdx < winnerIdx;
                    return (
                      <ChainRow
                        key={layer}
                        hit={hit}
                        isWinner={isWinner}
                        isOverridden={isOverridden}
                      />
                    );
                  }
                  return <EmptyRow key={layer} layer={layer} />;
                })}
              </div>
              <div className="hf-cascade-tray-actions">
                <button
                  type="button"
                  className="hf-btn hf-btn-primary"
                  onClick={() => onOverrideAtCurrentScope?.(envelope)}
                  disabled={!onOverrideAtCurrentScope}
                >
                  {hasHitAtCurrentScope
                    ? `Replace override on ${winnerLabel}`
                    : `Override for ${winnerLabel}`}
                </button>
                <button
                  type="button"
                  className="hf-btn"
                  onClick={() => onPickDeeperScope?.(envelope)}
                  disabled={!onPickDeeperScope}
                >
                  Override for a specific caller…
                </button>
                {envelope.isInherited ? null : (
                  <button
                    type="button"
                    className="hf-btn"
                    onClick={() => onResetToInherited?.(envelope)}
                    disabled={!onResetToInherited}
                  >
                    Reset to inherited
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function scopeForLabel(layer: Layer, envelope: Effective<unknown> | null): string {
  if (!envelope) return layerLabel(layer);
  const hit = envelope.layers.find((h) => h.layer === layer);
  if (hit) return hit.scopeLabel;
  return layerLabel(layer);
}
