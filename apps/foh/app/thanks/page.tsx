import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Thanks — HumanFirst",
  description: "Your pilot request is in. We'll be in touch within 24 hours.",
};

export default function ThanksPage() {
  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            HumanFirst
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--band-high)]" />
          Cohort 001 · Invite-only pilot
        </div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">
          You&rsquo;re in the queue.
        </h1>
        <p className="mt-6 text-lg text-[var(--text-secondary)]">
          We&rsquo;ll email you within 24 hours with a personal invite link if
          you&rsquo;re a fit for this cohort. If not this cohort, the next one.
        </p>

        <div className="mt-12 rounded-2xl border border-[var(--border-default)] p-8 text-left">
          <h2 className="text-base font-semibold">What happens next</h2>
          <ol className="mt-4 space-y-3 text-[var(--text-secondary)]">
            <li>
              <span className="font-medium text-[var(--text-primary)]">Today.</span>{" "}
              We read your submission. Yes, personally.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">Within 24 hours.</span>{" "}
              You get an email — either an invite link, or a note about when
              the next cohort opens.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">Your first session.</span>{" "}
              Click the link, put on headphones, speak. That&rsquo;s it.
            </li>
          </ol>
        </div>

        <div className="mt-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-8 text-left">
          <h2 className="text-base font-semibold">
            So you can plan for it
          </h2>
          <ul className="mt-4 space-y-3 text-[var(--text-secondary)]">
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                15-25 minutes of your time.
              </span>{" "}
              Depending on which course. Do it in one sitting.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                Headphones + quiet room.
              </span>{" "}
              You&rsquo;ll be speaking out loud. Others in the room = awkward.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                A browser with mic access.
              </span>{" "}
              Chrome, Safari, Firefox — all fine. Desktop or phone.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                Feedback on the spot.
              </span>{" "}
              You&rsquo;ll see your scores the moment the session ends.
            </li>
          </ul>
        </div>

        <p className="mt-10 text-sm text-[var(--text-tertiary)]">
          Change of heart, question, or a friend you&rsquo;d like to refer?{" "}
          <a
            href="mailto:hfpw@thewanders.com"
            className="underline"
          >
            hfpw@thewanders.com
          </a>
        </p>

        <div className="mt-12">
          <Link
            href="/"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            ← Back to HumanFirst
          </Link>
        </div>
      </section>
    </main>
  );
}
