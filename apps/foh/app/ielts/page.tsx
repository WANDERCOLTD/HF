import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "IELTS Speaking Practice — HumanFirst",
  description:
    "IELTS speaking practice with an AI examiner who coaches you first, then tests you honestly. Baseline, Part 1, Part 2, Part 3, and full Mock. All four bands scored.",
};

export default function IeltsPage() {
  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            HumanFirst
          </Link>
          <Link
            href="/cio-cto"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            CIO / CTO →
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--band-high)]" />
          Cohort 001 · Invite-only pilot
        </div>
        <div className="mt-4 text-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
          For university applicants + visa candidates targeting band 6.5–7.5
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          The IELTS tutor that teaches you,<br />
          not just tests you.
        </h1>
        <p className="mt-6 text-xl text-[var(--text-secondary)]">
          Every other IELTS app scores you and moves on. This one coaches you
          through what to fix, then tests whether you fixed it. Real examiner
          voice, honest bands, adapts to your weakest of Fluency, Lexical,
          Grammar, Pronunciation.
        </p>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">What you get</h2>
          <ul className="mt-4 space-y-4 text-[var(--text-secondary)]">
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                A real examiner voice.
              </span>{" "}
              Baseline, Part 1 (familiar topics), Part 2 (cue-card monologue),
              Part 3 (discussion), and a full Mock — the same shape as your test day.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                Bands scored honestly.
              </span>{" "}
              Fluency &amp; Coherence, Lexical Resource, Grammatical Range &amp;
              Accuracy, Pronunciation. No inflated numbers. Correlated against
              real examiner ratings during our pilot.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                Adapts to your weak spot.
              </span>{" "}
              Weakest of your four bands sets the next Part 3 technique focus:
              structuring an argument, giving reasons, expanding an answer,
              handling a challenge.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">
                Mastery over sessions, not vibes over one call.
              </span>{" "}
              Your bands move as you improve. You'll see the number, and the
              reason for it.
            </li>
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">How the pilot works</h2>
          <ol className="mt-4 space-y-3 text-[var(--text-secondary)]">
            <li>
              <span className="font-medium text-[var(--text-primary)]">1.</span>{" "}
              Tell us your target band and test date below.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">2.</span>{" "}
              We&rsquo;ll email you a personal invite link within 24 hours.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">3.</span>{" "}
              Take the baseline session on your own — 10 minutes, real speaking,
              real feedback.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">4.</span>{" "}
              Keep going for as many sessions as you like during the pilot. Free
              for the pilot cohort.
            </li>
          </ol>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">Try it — request an invite</h2>
          <p className="mt-3 text-[var(--text-secondary)]">
            15 pilot slots this cohort. First come, first served for the ones
            we think are the best fit.
          </p>

          <form
            method="post"
            action="/api/interest"
            className="mt-6 space-y-4 rounded-2xl border border-[var(--border-default)] p-6"
          >
            <input type="hidden" name="course" value="ielts" />
            <div>
              <label
                htmlFor="ielts-email"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Email <span aria-hidden="true">*</span>
              </label>
              <input
                id="ielts-email"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="ielts-name"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Name
              </label>
              <input
                id="ielts-name"
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Optional"
                className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="ielts-targetBand"
                  className="block text-sm font-medium text-[var(--text-primary)]"
                >
                  Target band
                </label>
                <input
                  id="ielts-targetBand"
                  type="text"
                  name="targetBand"
                  placeholder="e.g. 7.0"
                  className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="ielts-testDate"
                  className="block text-sm font-medium text-[var(--text-primary)]"
                >
                  Test date
                </label>
                <input
                  id="ielts-testDate"
                  type="text"
                  name="testDate"
                  placeholder="e.g. March 2027"
                  className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="ielts-message"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Anything we should know?
              </label>
              <textarea
                id="ielts-message"
                name="message"
                rows={3}
                placeholder="Where you're stuck, previous scores, native language — whatever helps."
                className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <button
                type="submit"
                className="rounded-lg bg-[var(--text-primary)] px-5 py-2.5 text-sm font-medium text-[var(--surface-primary)] transition hover:opacity-90"
              >
                Request an invite
              </button>
              <p className="text-xs text-[var(--text-tertiary)]">
                By submitting you agree to our{" "}
                <Link href="/legal/privacy" className="underline">
                  privacy policy
                </Link>
                .
              </p>
            </div>
          </form>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">Honest limits</h2>
          <ul className="mt-4 space-y-3 text-sm text-[var(--text-tertiary)]">
            <li>
              Pilot pricing only during cohort 1. Commercial pricing set based
              on pilot data.
            </li>
            <li>
              Not affiliated with Cambridge, IDP, or British Council. Not an
              official IELTS product.
            </li>
            <li>
              Pronunciation scoring is currently transcript-based (LLM
              judgement). Acoustic prosody wiring is on the roadmap.
            </li>
          </ul>
        </section>

        <div className="mt-16 text-center">
          <Link
            href="/"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            ← Back to HumanFirst
          </Link>
        </div>
      </article>

      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-[var(--text-tertiary)]">
          <div>© {new Date().getFullYear()} HumanFirst Foundation</div>
          <Link href="/legal/privacy" className="hover:text-[var(--text-secondary)]">
            Privacy
          </Link>
        </div>
      </footer>
    </main>
  );
}
