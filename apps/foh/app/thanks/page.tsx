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
        <h1 className="text-4xl font-semibold tracking-tight">
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
