import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome — HumanFirst",
  description:
    "You're one click from your first HumanFirst session. Here's what to expect.",
};

/**
 * /welcome/[token] — pre-intake welcome page.
 *
 * The invite email Paul sends points here (not directly at the admin
 * /join/[token] flow) so the learner sees a branded, expectations-first
 * page BEFORE the admin intake wizard opens.
 *
 * The token in the URL is opaque to this page — it's just forwarded to
 * the admin /join/[token] route. No auth, no DB access.
 *
 * The default `?course` query hint can be passed by Paul to tune the
 * copy (`?course=ielts` or `?course=cio-cto`).
 */
export default async function WelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ course?: string; name?: string }>;
}) {
  const { token } = await params;
  const { course, name } = await searchParams;

  const adminBase =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://dev.humanfirstfoundation.com";
  // Points at the v2 intake page (auth-first, email/phone → PIN → profile).
  // Sibling `/intake/enrollment-crawcus/${token}` is the v1 crawcus flow;
  // pick one per pilot cohort. Both create a Caller and redirect to
  // /x/sim/${callerId}?embedded=1 on completion.
  const joinUrl = `${adminBase}/intake/v2/${encodeURIComponent(token)}`;

  const isCioCto = course === "cio-cto";
  const isIelts = course === "ielts" || !isCioCto;

  const courseLabel = isCioCto ? "CIO / CTO Standard" : "IELTS Speaking Practice";
  const sessionMinutes = isCioCto ? 25 : 15;

  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            HumanFirst
          </Link>
          <div className="text-sm text-[var(--text-tertiary)]">Pilot access</div>
        </div>
      </header>

      <article className="mx-auto max-w-2xl px-6 py-16">
        <div className="text-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
          {courseLabel} · Pilot cohort
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          {name ? `Welcome, ${name}.` : "You're in."}
        </h1>
        <p className="mt-6 text-xl text-[var(--text-secondary)]">
          Your first session is one click away. Take {sessionMinutes} minutes when
          you can focus — this isn&rsquo;t a demo, it&rsquo;s the real thing.
        </p>

        <section className="mt-12 rounded-2xl border border-[var(--border-default)] p-8">
          <h2 className="text-base font-semibold">Before you click Start</h2>
          <ul className="mt-4 space-y-3 text-[var(--text-secondary)]">
            <li className="flex gap-3">
              <span className="text-[var(--text-tertiary)]">1.</span>
              <span>
                <span className="font-medium text-[var(--text-primary)]">
                  Grab headphones.
                </span>{" "}
                A phone or laptop mic works fine. AirPods are perfect.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-[var(--text-tertiary)]">2.</span>
              <span>
                <span className="font-medium text-[var(--text-primary)]">
                  Find a quiet spot.
                </span>{" "}
                No one else in the room ideally — you&rsquo;ll be speaking out
                loud.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-[var(--text-tertiary)]">3.</span>
              <span>
                <span className="font-medium text-[var(--text-primary)]">
                  Allow mic access
                </span>{" "}
                when your browser asks. That&rsquo;s how the tutor hears you.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-[var(--text-tertiary)]">4.</span>
              <span>
                <span className="font-medium text-[var(--text-primary)]">
                  Just talk.
                </span>{" "}
                {isIelts
                  ? "The AI examiner will ask about familiar topics. There are no wrong answers — talk the way you'd talk to a person."
                  : "The AI coach opens with a case study. Say what you'd say. It'll teach the next tier from there."}
              </span>
            </li>
          </ul>
        </section>

        <div className="mt-10 text-center">
          <a
            href={joinUrl}
            className="inline-block rounded-lg bg-[var(--text-primary)] px-8 py-3 text-base font-medium text-[var(--surface-primary)] transition hover:opacity-90"
          >
            Start my first session
          </a>
          <p className="mt-4 text-xs text-[var(--text-tertiary)]">
            You&rsquo;ll be asked to confirm a couple of details (~30 seconds)
            before the session begins.
          </p>
        </div>

        <section className="mt-16 text-sm text-[var(--text-tertiary)]">
          <h3 className="font-medium text-[var(--text-secondary)]">
            What happens after
          </h3>
          <ul className="mt-3 space-y-2">
            <li>
              You&rsquo;ll see your scores {isIelts ? "(all four bands)" : "(maturity-tier feedback)"} the moment the session ends.
            </li>
            <li>
              I&rsquo;ll (Paul) email you in 48 hours to check in and unlock the
              next module.
            </li>
            <li>
              Questions?{" "}
              <a href="mailto:hfpw@thewanders.com" className="underline">
                hfpw@thewanders.com
              </a>
              . Real inbox, I reply.
            </li>
          </ul>
        </section>

        <div className="mt-16 text-center">
          <Link
            href="/"
            className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            ← humanfirstfoundation.com
          </Link>
        </div>
      </article>
    </main>
  );
}
