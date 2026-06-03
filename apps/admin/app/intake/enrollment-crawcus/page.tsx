// Phase 1 enrolment intake — proof-of-stack route on @tallyseal/*.
//
// Public, learner-facing surface. Honours the V5 wizard non-goal
// (V5 untouched at /x/wizard/*). DRAFT copy belt prevents lorem ipsum
// reaching production traffic — DisclosureContentPort refuses to
// deliver status=DRAFT when NODE_ENV=production.

import { EnrollmentChat } from "@/components/intake/EnrollmentChat";
import "../intake.css";

export const dynamic = "force-dynamic"; // Always render fresh — uses NextAuth session per-request

export default function EnrollmentIntakePage() {
  return (
    <main className="intake-page">
      <div className="intake-container">
        <header className="hf-mb-lg">
          <h1 className="hf-page-title">Enrolment</h1>
          <p className="hf-section-desc">
            Chat-driven enrolment for HumanFirst Foundation. Conversation on
            the left fills the form on the right as you go.
          </p>
        </header>
        <EnrollmentChat />
      </div>
    </main>
  );
}
