// Token-scoped Phase 1 enrolment intake — the production-shaped route.
//
// Mirrors the routing pattern of app/join/[token]/page.tsx: the URL
// token resolves to a CohortGroup via /api/join/:token (the existing
// HF endpoint, unchanged). The chat then captures PII into an
// IntakeApplication projection bound to that classroom.
//
// Without a token (the demo route at .../enrollment-crawcus/page.tsx)
// the chat still works for spike demos — it just doesn't bind to a
// classroom and the enrollment.classroom-resolved Contract short-
// circuits on the absent token.

import { EnrollmentChat } from "@/components/intake/EnrollmentChat";

export const dynamic = "force-dynamic";

export default async function EnrollmentIntakeWithTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

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
        <EnrollmentChat classroomToken={token} />
      </div>
    </main>
  );
}
