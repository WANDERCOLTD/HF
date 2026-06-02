// Phase 1 enrolment intake — proof-of-stack route on @tallyseal/*.
//
// Public, learner-facing surface. Honours the V5 wizard non-goal
// (V5 untouched at /x/wizard/*). DRAFT copy belt prevents lorem ipsum
// reaching production traffic — DisclosureContentPort refuses to
// deliver status=DRAFT when NODE_ENV=production.

import { EnrollmentChat } from "@/components/intake/EnrollmentChat";

export const dynamic = "force-dynamic"; // Always render fresh — uses NextAuth session per-request

export default function EnrollmentIntakePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Enrolment</h1>
          <p className="text-sm text-muted-foreground">
            Chat-driven enrolment for HumanFirst Foundation. Conversation on
            the left fills the form on the right as you go.
          </p>
        </header>
        <EnrollmentChat />
      </div>
    </main>
  );
}
