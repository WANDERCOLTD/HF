import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HumanFirst — Learn out loud",
  description:
    "AI tutors that listen back. IELTS speaking practice and CIO/CTO scenario rehearsal — coached, then tested. Pilot invites open.",
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            HumanFirst
          </Link>
          <nav className="flex items-center gap-6 text-sm text-[var(--text-secondary)]">
            <Link href="/ielts" className="hover:text-[var(--text-primary)]">
              IELTS
            </Link>
            <Link href="/cio-cto" className="hover:text-[var(--text-primary)]">
              CIO / CTO
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--band-high)]" />
          Cohort 001 · Invite-only pilot
        </div>
        <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-6xl">
          Learn out loud.
        </h1>
        <p className="mt-6 text-xl text-[var(--text-secondary)]">
          AI tutors that listen back. Coach you first, then test you honestly.
          No scripted drills. No inflated scores.
        </p>
        <p className="mt-4 text-base text-[var(--text-tertiary)]">
          IELTS Speaking pilot open now. CIO/CTO Standard waitlist for October.
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-2">
          <Link
            href="/ielts"
            className="group rounded-2xl border border-[var(--border-default)] p-8 transition hover:border-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
          >
            <div className="text-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
              For test-takers
            </div>
            <h2 className="mt-3 text-2xl font-semibold">IELTS Speaking Practice</h2>
            <p className="mt-3 text-[var(--text-secondary)]">
              Speak with an examiner who teaches, then tests. Baseline, Part 1,
              Part 2, Part 3, and a full Mock — all four bands scored.
            </p>
            <div className="mt-6 text-sm font-medium group-hover:underline">
              Try it →
            </div>
          </Link>

          <Link
            href="/cio-cto"
            className="group rounded-2xl border border-[var(--border-default)] p-8 transition hover:border-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                For IT leaders
              </div>
              <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-xs text-[var(--text-tertiary)]">
                Waitlist
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold">CIO / CTO Standard</h2>
            <p className="mt-3 text-[var(--text-secondary)]">
              Rehearse the conversations before you have them. Case-study
              scenarios from the SIAS Standard, probed by an AI board chair.
              Cohort 002 opens October.
            </p>
            <div className="mt-6 text-sm font-medium group-hover:underline">
              Join the waitlist →
            </div>
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-[var(--text-tertiary)]">
          <div>© {new Date().getFullYear()} HumanFirst Foundation</div>
          <div className="flex gap-6">
            <Link href="/legal/privacy" className="hover:text-[var(--text-secondary)]">
              Privacy
            </Link>
            <a
              href="mailto:hfpw@thewanders.com"
              className="hover:text-[var(--text-secondary)]"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
