"use client";

// Client-side recap shell — fetches the session snapshot, renders
// the CoC + summary + actions. Reads ?intentId= + ?token= from URL.
//
// On "Continue to course": navigates to /join/[token]?firstName=…
// which is the existing battle-tested join flow (creates Caller +
// CallerPlaybook). If no token, the "Continue" button is hidden —
// the platform-level demo path stops here.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IntakeCoCPanel } from "./IntakeCoCPanel";
import type { Event } from "@/lib/intake/tallyseal";

interface SessionSnapshot {
  readonly intentId: string;
  readonly state: string;
  readonly events: readonly Event[];
  readonly values: Readonly<Record<string, unknown>>;
}

const VALUES_DISPLAY: ReadonlyArray<readonly [string, string]> = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["displayName", "Display name"],
  ["timezone", "Timezone"],
  ["preferredContactMethod", "Preferred contact"],
  ["marketingOptIn", "Marketing opt-in"],
  ["accessibilityNote", "Accessibility note"],
  ["ageRange", "Age range"],
];

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

  if (error) {
    return <div className="hf-banner hf-banner-error" data-testid="intake-done-error">{error}</div>;
  }
  if (!snapshot) {
    return <div className="hf-section-desc">Loading audit trail…</div>;
  }

  const captured = VALUES_DISPLAY.filter(([k]) => snapshot.values[k] !== undefined);
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

function buildContinueUrl(token: string, values: Readonly<Record<string, unknown>>): string {
  const params = new URLSearchParams();
  const firstName = values.firstName;
  const lastName = values.lastName;
  const email = values.email;
  const ageRange = values.ageRange;
  const phone = values.phone;
  if (typeof firstName === "string") params.set("firstName", firstName);
  if (typeof lastName === "string") params.set("lastName", lastName);
  if (typeof email === "string") params.set("email", email);
  // ageRange propagation per #1036 — persisted as CallerAttribute
  // `intake.ageRange` on /join/[token] POST. `under-18` is rejected by
  // `ageBand.adultOnly()` at intake, so this should never be present
  // as that value, but the route handler defends against URL tampering.
  if (typeof ageRange === "string") params.set("ageRange", ageRange);
  // phone — optional in the intake spec. When supplied, the join route
  // normalises (strip spaces / dashes / parens) and writes Caller.phone,
  // which unblocks Call Me sessions without the mid-call JIT capture
  // and is a prerequisite for the SMS slice of #1101.
  if (typeof phone === "string" && phone.trim().length > 0) {
    params.set("phone", phone.trim());
  }
  const qs = params.toString();
  return `/join/${encodeURIComponent(token)}${qs ? `?${qs}` : ""}`;
}
