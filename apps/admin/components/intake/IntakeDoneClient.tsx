"use client";

// Client-side recap shell — fetches the session snapshot, renders
// the CoC + summary + actions. Reads ?intentId= + ?token= from URL.
//
// On "Continue to course": POSTs the captured values directly to
// `/api/join/[token]` (the same endpoint /join/[token] auto-submits
// to). Once the response lands (Caller created, session cookie set),
// we router.push to `/x/sim/<newCallerId>`.
//
// Pre-fix the button was an `<a href="/join/[token]?firstName=…">`
// — so the browser navigated to a visible auto-submit form that
// flashed for ~50–200ms before the form fired. The flash was a UX
// leak, AND the redirect-after-form-submit pattern was implicated in
// the post-enrol "Caller not found" race (#1247): the cookie commit
// + Caller write completed via the form's POST, but the next page's
// SSR fired against the OLD anonymous session in some windows.
// Direct fetch-then-router.push keeps the cookie commit in-process
// and only navigates once the server has confirmed success.

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IntakeCoCPanel } from "./IntakeCoCPanel";
import type { Event } from "@/lib/intake/tallyseal";
import {
  EnrollmentIntake,
  INTERNAL_FIELDS,
} from "@/lib/intake/specs/enrollment.intent";

interface SessionSnapshot {
  readonly intentId: string;
  readonly state: string;
  readonly events: readonly Event[];
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * Spec-driven list of [key, label] pairs to render on the recap.
 * Iterates `EnrollmentIntake.fields` in declaration order, skips
 * internal/derived fields, reads each field's `label.en` from the
 * spec metadata. Add a field to the spec → it appears here. No
 * parallel hand-edit needed.
 */
function deriveValuesDisplay(): ReadonlyArray<readonly [string, string]> {
  const internal = new Set<string>(INTERNAL_FIELDS);
  const out: Array<readonly [string, string]> = [];
  for (const [key, fieldSpec] of Object.entries(EnrollmentIntake.fields)) {
    if (internal.has(key)) continue;
    const labelMeta = fieldSpec.metadata.label;
    const label =
      typeof labelMeta === "string"
        ? labelMeta
        : labelMeta && typeof labelMeta === "object" && "en" in labelMeta
          ? String((labelMeta as Record<string, unknown>).en ?? key)
          : key;
    out.push([key, label] as const);
  }
  return out;
}

export function IntakeDoneClient() {
  const router = useRouter();
  const params = useSearchParams();
  const intentId = params.get("intentId");
  const token = params.get("token");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Continue-to-course in-flight state. `joining` disables the button
  // and shows a spinner label. `joinError` is shown next to the button
  // when the POST fails so the learner sees the failure and can retry
  // (or hit the audit-bundle download as a fallback).
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!intentId) {
      setError("missing intentId");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/intake/session/${encodeURIComponent(intentId)}`);
        if (!res.ok) {
          const text = await res.text().catch(() => `${res.status}`);
          throw new Error(`session fetch failed: ${text}`);
        }
        const data = (await res.json()) as SessionSnapshot;
        if (!cancelled) setSnapshot(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [intentId]);

  const valuesDisplay = useMemo(() => deriveValuesDisplay(), []);

  if (error) {
    return <div className="hf-banner hf-banner-error" data-testid="intake-done-error">{error}</div>;
  }
  if (!snapshot) {
    return <div className="hf-section-desc">Loading audit trail…</div>;
  }

  const captured = valuesDisplay.filter(([k]) => snapshot.values[k] !== undefined);
  const bundleUrl = `/api/intake/audit-bundle/${encodeURIComponent(intentId!)}?format=jsonl`;

  async function handleContinue() {
    if (!token || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const body = buildJoinBody(snapshot!.values);
      const res = await fetch(
        `/api/join/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        },
      );
      const data: { ok?: boolean; callerId?: string; redirect?: string; error?: string } =
        await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setJoinError(
          data?.error ?? `Couldn't continue to your course (${res.status}). Please try again.`,
        );
        return;
      }
      const target = data.redirect ?? (data.callerId ? `/x/sim/${data.callerId}` : null);
      if (!target) {
        setJoinError("Joined the classroom but no redirect target was returned. Please refresh.");
        return;
      }
      // router.push keeps the SPA session-cookie context — the next
      // page's RSC fetch sees the freshly-minted cookie because the
      // fetch above completed before this nav.
      router.push(target);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Network error — please try again.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="intake-done-grid">
      <section className="hf-flex hf-flex-col hf-gap-md">
        <div className="hf-card hf-card-compact" data-testid="intake-done-summary">
          <h2 className="hf-section-title">Captured</h2>
          <dl className="intake-done-values">
            {captured.length === 0 ? (
              <dd className="hf-section-desc">No values captured.</dd>
            ) : (
              captured.map(([k, label]) => (
                <div key={k} className="intake-done-value-row">
                  <dt>{label}</dt>
                  <dd>{String(snapshot.values[k])}</dd>
                </div>
              ))
            )}
          </dl>
        </div>

        <div className="hf-flex hf-gap-sm intake-done-actions" data-testid="intake-done-actions">
          <a
            className="hf-btn hf-btn-secondary"
            href={bundleUrl}
            download
            data-testid="intake-done-download"
          >
            Download audit bundle (.jsonl)
          </a>
          {token ? (
            <button
              type="button"
              className="hf-btn hf-btn-primary"
              onClick={handleContinue}
              disabled={joining}
              data-testid="intake-done-continue"
            >
              {joining ? "Joining…" : "Continue to course"}
            </button>
          ) : null}
        </div>
        {joinError ? (
          <div
            className="hf-banner hf-banner-error"
            role="alert"
            data-testid="intake-done-join-error"
          >
            {joinError}
          </div>
        ) : null}
      </section>

      <aside className="hf-flex hf-flex-col hf-gap-md">
        <IntakeCoCPanel events={snapshot.events} />
      </aside>
    </div>
  );
}

/**
 * Spec-driven JSON body builder: iterates every non-internal spec
 * field and propagates whatever the learner captured to the
 * /api/join/[token] POST body. Strings are trim-and-skip-if-empty;
 * booleans / numbers stay as-is. Add a spec field → it propagates.
 * Single source.
 *
 * /api/join/[token] uses zod strip — unknown keys are silently
 * dropped on the server, so we can over-include without risk.
 */
function buildJoinBody(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const internal = new Set<string>(INTERNAL_FIELDS);
  const body: Record<string, unknown> = {};
  for (const [key, fieldSpec] of Object.entries(EnrollmentIntake.fields)) {
    if (internal.has(key)) continue;
    const v = values[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length === 0) continue;
      body[key] = trimmed;
    } else if (typeof v === "boolean" || typeof v === "number") {
      body[key] = v;
    }
    // Arrays / objects intentionally skipped — none of the current
    // user-facing fields are composite. If a future spec adds one
    // it can serialise via a separate convention.
    void fieldSpec;
  }
  return body;
}
