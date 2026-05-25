"use client";

/**
 * StalePromptPill — #831 (Story 7 of EPIC #832).
 *
 * Surfaces compose-input staleness to educators above the calls list and
 * the tune panel on `/x/callers/[callerId]`. Renders nothing when fresh;
 * renders a non-alarming warning banner with a "Recompose now" button
 * when at least one upstream input has changed since the cached
 * ComposedPrompt was last composed.
 *
 * Data source: `GET /api/callers/:callerId/prompt-staleness`.
 * Recompose action: `POST /api/callers/:callerId/compose-prompt` with
 * `{ triggerType: "manual" }`. On success the pill re-fetches and hides
 * itself when the new ComposedPrompt is fresh.
 */

import { useCallback, useEffect, useState } from "react";

interface UpstreamChange {
  source: "playbook" | "caller" | "domain" | "system";
  changedAt: string;
  label: string;
}

interface StalenessResponse {
  ok: boolean;
  isStale?: boolean;
  composedAt?: string | null;
  upstreamChanges?: UpstreamChange[];
  error?: string;
}

interface StalePromptPillProps {
  callerId: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function StalePromptPill({ callerId }: StalePromptPillProps) {
  const [data, setData] = useState<StalenessResponse | null>(null);
  const [recomposing, setRecomposing] = useState(false);
  const [recomposeError, setRecomposeError] = useState<string | null>(null);

  const fetchStaleness = useCallback(async () => {
    try {
      const res = await fetch(`/api/callers/${callerId}/prompt-staleness`);
      const json = (await res.json()) as StalenessResponse;
      setData(json);
    } catch {
      // Network errors are silent — the pill simply doesn't render until
      // the next mount attempt succeeds.
      setData(null);
    }
  }, [callerId]);

  useEffect(() => {
    fetchStaleness();
  }, [fetchStaleness]);

  const onRecompose = useCallback(async () => {
    setRecomposing(true);
    setRecomposeError(null);
    try {
      const res = await fetch(`/api/callers/${callerId}/compose-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "manual" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Recompose failed (${res.status})`);
      }
      await fetchStaleness();
    } catch (err: unknown) {
      setRecomposeError(
        err instanceof Error ? err.message : "Recompose failed",
      );
    } finally {
      setRecomposing(false);
    }
  }, [callerId, fetchStaleness]);

  if (!data?.ok || !data.isStale) {
    return null;
  }

  const changes = data.upstreamChanges ?? [];
  const headline =
    data.composedAt == null
      ? "Prompt has not been composed yet — caller's next call will compose for the first time."
      : changes.length > 0
        ? `Prompt may be outdated — ${changes[0].label.toLowerCase()} changed ${relativeTime(changes[0].changedAt)}`
        : "Prompt may be outdated — upstream settings changed since last compose";

  const tooltip =
    changes.length > 1
      ? changes
          .map((c) => `${c.label}: changed ${relativeTime(c.changedAt)}`)
          .join("\n")
      : undefined;

  return (
    <div
      className="hf-banner hf-banner-warning hf-flex-between hf-mb-md"
      title={tooltip}
      role="status"
    >
      <div>
        <strong>⚠ {headline}</strong>
        {changes.length > 1 && (
          <div className="hf-text-sm hf-mt-xs">
            {changes.length} upstream sources changed
          </div>
        )}
        {recomposeError && (
          <div className="hf-text-sm hf-text-error hf-mt-xs">
            {recomposeError}
          </div>
        )}
      </div>
      <button
        type="button"
        className="hf-btn hf-btn-secondary"
        onClick={onRecompose}
        disabled={recomposing}
      >
        {recomposing ? "Recomposing…" : "Recompose now"}
      </button>
    </div>
  );
}
