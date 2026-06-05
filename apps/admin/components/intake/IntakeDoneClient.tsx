"use client";

// Client-side recap shell — fetches the session snapshot, renders
// the CoC + summary + actions. Reads ?intentId= + ?token= from URL.
//
// On "Continue to course": navigates to /join/[token]?firstName=…
// which is the existing battle-tested join flow (creates Caller +
// CallerPlaybook). If no token, the "Continue" button is hidden —
// the platform-level demo path stops here.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  const params = useSearchParams();
  const intentId = params.get("intentId");
  const token = params.get("token");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const continueUrl = token ? buildContinueUrl(token, snapshot.values) : null;
  const bundleUrl = `/api/intake/audit-bundle/${encodeURIComponent(intentId!)}?format=jsonl`;

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
          {continueUrl ? (
            <a
              className="hf-btn hf-btn-primary"
              href={continueUrl}
              data-testid="intake-done-continue"
            >
              Continue to course
            </a>
          ) : null}
        </div>
      </section>

      <aside className="hf-flex hf-flex-col hf-gap-md">
        <IntakeCoCPanel events={snapshot.events} />
      </aside>
    </div>
  );
}

/**
 * Spec-driven URL builder: iterates every non-internal spec field and
 * propagates whatever the learner captured to /join/[token]. Strings
 * are trim-and-skip-if-empty; booleans are stringified; numbers go
 * via String(). Add a spec field → it propagates. Single source.
 *
 * The /join/[token] POST handler decides what it does with each key;
 * unknown keys are ignored there (zod strip).
 */
function buildContinueUrl(token: string, values: Readonly<Record<string, unknown>>): string {
  const internal = new Set<string>(INTERNAL_FIELDS);
  const params = new URLSearchParams();
  for (const [key, fieldSpec] of Object.entries(EnrollmentIntake.fields)) {
    if (internal.has(key)) continue;
    const v = values[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length === 0) continue;
      params.set(key, trimmed);
    } else if (typeof v === "boolean" || typeof v === "number") {
      params.set(key, String(v));
    }
    // Arrays / objects intentionally skipped — none of the current
    // user-facing fields are composite. If a future spec adds one
    // it can serialise via a separate convention (JSON in URL).
    void fieldSpec;
  }
  const qs = params.toString();
  return `/join/${encodeURIComponent(token)}${qs ? `?${qs}` : ""}`;
}
