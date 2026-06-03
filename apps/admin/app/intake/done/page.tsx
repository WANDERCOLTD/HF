// Post-commit recap surface — what the learner sees AFTER the chat
// hits readiness and emits ProjectionCommit.
//
// Shows: captured values, the full Chain of Custody (scrollable),
// download button for the audit bundle (jsonl ready for the verifier
// CLI), and a "Continue to course" button that hands off to HF's
// /join/[token] route. No redirect happens automatically — the
// learner reviews the audit trail before continuing (or simply
// closes the tab; the bundle is still composable from intentId).

import { Suspense } from "react";
import { IntakeDoneClient } from "@/components/intake/IntakeDoneClient";
import "../intake.css";

export const dynamic = "force-dynamic";

export default function IntakeDonePage() {
  return (
    <main className="intake-page">
      <div className="intake-container">
        <header className="hf-mb-lg">
          <h1 className="hf-page-title">Enrolment complete</h1>
          <p className="hf-section-desc">
            Your enrolment has been recorded. Below is the full audit trail —
            every event, hash-chained — that we will hand to your course
            provider. Download it for your records, then continue.
          </p>
        </header>
        <Suspense fallback={<div className="hf-section-desc">Loading…</div>}>
          <IntakeDoneClient />
        </Suspense>
      </div>
    </main>
  );
}
