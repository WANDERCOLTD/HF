"use client";

/**
 * useEffectiveValue — Slice C2 of epic #1675 (#1737).
 *
 * Client-side hook that fetches the cascade envelope for a given knob
 * key + scope chain via `GET /api/cascade/resolve` (which delegates to
 * `lib/cascade/effective-value.ts::resolveEffective()` — the canonical
 * Cascade-pillar entry point).
 *
 * The Journey-tab Inspector is the primary caller — every editable
 * setting whose family is registered in `lib/cascade/effective-value.ts`
 * resolves its provenance through this hook and renders via
 * `<CascadeValue>` + `<LayerBadge>`. Settings whose knob key has no
 * registered resolver fall back to the snapshot read; the hook signals
 * that via `unresolvable: true` so the consumer can branch cleanly.
 *
 * Sibling-reuse pattern:
 *   useEffectiveValue(knobKey, scope) → Effective<T>
 *     ↓
 *   <CascadeValue envelope={effective}>{value}</CascadeValue>
 *     ↓ (renders LayerBadge with sidebar-aligned icon + tooltip)
 *
 * Anti-pattern (don't do this):
 *   resolveValueAtPath(playbookConfig, storagePath)
 *     // Reads the snapshot. No layer attribution. No provenance.
 *     // Use only when isResolvableKnob(knobKey) is structurally false
 *     // (e.g. course-intrinsic settings with no cascade family).
 *
 * See `.claude/rules/cascade-reuse.md` for the durable rule.
 */

import { useEffect, useRef, useState } from "react";

import type { Effective } from "./layer-types";

/** Mirror of the route's accepted scope ids. courseId is the operator-
 *  facing alias for playbookId. */
export interface UseEffectiveValueScope {
  courseId?: string | null;
  callerId?: string | null;
  domainId?: string | null;
}

export interface UseEffectiveValueResult<T> {
  envelope: Effective<T> | null;
  loading: boolean;
  /** True when the route returned 400 "Unknown cascade knob key …". The
   *  knob key has no registered resolver — consumers fall back to their
   *  snapshot read path. */
  unresolvable: boolean;
  /** Non-null when a non-400 error occurred (network, 500, scope-missing
   *  400). Consumers render a muted "—" or retry affordance. */
  error: string | null;
}

const UNRESOLVABLE_REASONS = [
  /Unknown cascade knob key/,
] as const;

function isUnresolvableMessage(message: string): boolean {
  return UNRESOLVABLE_REASONS.some((re) => re.test(message));
}

/**
 * Fetch the cascade envelope for `(knobKey, scope)`. Stable across renders
 * via a string-derived cache key. Aborts in-flight requests on remount or
 * key change.
 *
 * When `knobKey` is null/empty (caller is reading something with no
 * cascade family), the hook short-circuits to `{ envelope: null,
 * unresolvable: true }` without hitting the route.
 */
export function useEffectiveValue<T>(
  knobKey: string | null | undefined,
  scope: UseEffectiveValueScope,
): UseEffectiveValueResult<T> {
  const [state, setState] = useState<UseEffectiveValueResult<T>>({
    envelope: null,
    loading: Boolean(knobKey),
    unresolvable: !knobKey,
    error: null,
  });

  // Stable cache key — re-run when any input changes.
  const cacheKey = JSON.stringify({
    k: knobKey ?? "",
    c: scope.courseId ?? "",
    l: scope.callerId ?? "",
    d: scope.domainId ?? "",
  });

  // Track the latest in-flight key so out-of-order responses can't
  // clobber the state. Assigned inside the effect — React lint
  // doesn't allow ref writes during render.
  const latestKeyRef = useRef(cacheKey);

  useEffect(() => {
    latestKeyRef.current = cacheKey;
    if (!knobKey) {
      // Knob transitioned from a value to null — reset the envelope.
      // setState-in-effect is the correct shape here: the lint warning
      // assumes derivable state, but this is a true reset on a
      // transition signal (knobKey going null is a user action, not a
      // derivation).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({
        envelope: null,
        loading: false,
        unresolvable: true,
        error: null,
      });
      return;
    }

    let aborted = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ knobKey });
    if (scope.courseId) params.set("courseId", scope.courseId);
    if (scope.callerId) params.set("callerId", scope.callerId);
    if (scope.domainId) params.set("domainId", scope.domainId);

    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch(`/api/cascade/resolve?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (aborted) return;
        if (latestKeyRef.current !== cacheKey) return;
        if (res.ok) {
          const envelope = (await res.json()) as Effective<T>;
          setState({
            envelope,
            loading: false,
            unresolvable: false,
            error: null,
          });
          return;
        }
        // Try to read the error body for the 400 message — it's where
        // the route signals "Unknown cascade knob key …".
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // ignore — keep the HTTP status as the message
        }
        if (res.status === 400 && isUnresolvableMessage(message)) {
          setState({
            envelope: null,
            loading: false,
            unresolvable: true,
            error: null,
          });
          return;
        }
        setState({
          envelope: null,
          loading: false,
          unresolvable: false,
          error: message,
        });
      })
      .catch((err: unknown) => {
        if (aborted) return;
        if (latestKeyRef.current !== cacheKey) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setState({
          envelope: null,
          loading: false,
          unresolvable: false,
          error: message,
        });
      });

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [cacheKey, knobKey, scope.courseId, scope.callerId, scope.domainId]);

  return state;
}
