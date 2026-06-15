"use client";

/**
 * SnapshotEnrollmentBlock — Wave A1 of the legacy-tab retirement plan.
 *
 * Folds the Profile tab's CallerEnrollmentsSection into Snapshot v3
 * (per the user decision: Profile retires; memories/slugs/enrollments
 * fold into Snapshot).
 *
 * Reuses the existing component verbatim — it already handles status
 * badges, Pause / Complete / Resume / Re-enroll actions, the
 * EnrollmentDotRail journey, and the available-playbooks picker.
 *
 * The wrapper exists so:
 *  1. Snapshot section ordering stays self-documenting
 *  2. The enrollment count callback is a no-op (Snapshot doesn't need
 *     to surface a count badge in a tab title — the count lives inside
 *     the section header itself).
 *  3. Future Snapshot-specific tweaks (e.g. compact mode if the section
 *     becomes too tall) have a clear home.
 */

import { CallerEnrollmentsSection } from "./ProfileTab";

interface SnapshotEnrollmentBlockProps {
  callerId: string;
  domainId: string | null | undefined;
}

export function SnapshotEnrollmentBlock({
  callerId,
  domainId,
}: SnapshotEnrollmentBlockProps) {
  return (
    <section
      className="hf-snapshot-section"
      data-testid="hf-snapshot-enrollments"
    >
      <CallerEnrollmentsSection
        callerId={callerId}
        domainId={domainId}
        onCountChange={() => {
          /* no-op — Snapshot doesn't surface an external count badge */
        }}
      />
    </section>
  );
}
