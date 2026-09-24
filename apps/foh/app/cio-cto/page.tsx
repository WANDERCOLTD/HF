import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CIO / CTO Standard — HumanFirst",
  description:
    "Rehearse the CIO conversations before you have them. AI-coached case studies from the SIAS Standard, probed like a board. Revision Aid, Pop Quiz, and a board-chair Practice Exam.",
};

export default function CioCtoPage() {
  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            HumanFirst
          </Link>
          <Link
            href="/ielts"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            ← IELTS
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--band-high)]" />
          Cohort 001 · Invite-only pilot
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Rehearse the CIO conversations<br />
          before you have them.
        </h1>
        <p className="mt-6 text-xl text-[var(--text-secondary)]">
          A Gartner conference gets you the frameworks. This gets you the
          rehearsal. Case studies from the SIAS CIO/CTO Standard, coached in
          the moment, probed like a board. 250 authored MCQs, 26 rubric-scored
          LOs, 5 case studies across the five leverage-heavy Units.
        </p>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">Three modes, one Standard</h2>
          <div className="mt-4 space-y-6 text-[var(--text-secondary)]">
            <div>
              <div className="font-medium text-[var(--text-primary)]">
                Revision Aid — the coaching room
              </div>
              <p className="mt-1">
                Pick a Unit. The AI opens with a case (Severn Health Trust's
                02:00 outage, Lyle&rsquo;s Brewery&rsquo;s inherited architecture,
                Carrington Foods&rsquo; strategy vacuum). You answer. It teaches
                you the next maturity tier. Then re-asks.
              </p>
            </div>
            <div>
              <div className="font-medium text-[var(--text-primary)]">
                Pop Quiz — the drill
              </div>
              <p className="mt-1">
                8–12 MCQs per session, one Unit at a time, binary
                correct/incorrect with brief-principle feedback. For the days
                you want vocabulary and framework recall, not full scenario
                rehearsal.
              </p>
            </div>
            <div>
              <div className="font-medium text-[var(--text-primary)]">
                Practice Exam — the board chair
              </div>
              <p className="mt-1">
                4–6 scenario probes, board-chair persona, examiner-mode
                silence. No coaching in-session. Structured close afterwards.
                For the week before you sit the real thing.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">Five Units in the pilot</h2>
          <ul className="mt-4 grid gap-3 text-[var(--text-secondary)] sm:grid-cols-2">
            <li>Unit 04 — IT Operations &amp; Infrastructure</li>
            <li>Unit 09 — Enterprise &amp; Business Architecture</li>
            <li>Unit 10 — Application Definition &amp; Development</li>
            <li>Unit 16 — Data &amp; Information Management</li>
            <li>Unit 21 — Strategic Planning &amp; Delivery</li>
          </ul>
          <p className="mt-4 text-sm text-[var(--text-tertiary)]">
            Foundation and Practitioner tiers of the SIAS Standard V6.0
            (Ofqual-recognised). The pilot covers the five-Unit subset most
            leverage-heavy for newly-promoted CIOs.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">Who this is for</h2>
          <ul className="mt-4 space-y-3 text-[var(--text-secondary)]">
            <li>Newly-promoted CIOs in their first 12 months</li>
            <li>Fractional CIOs juggling context across clients</li>
            <li>IT Directors preparing for the next role up</li>
            <li>Senior CIOs sharpening Distinction-tier judgement</li>
            <li>Aspiring CIOs building the vocabulary before the promotion</li>
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">How the pilot works</h2>
          <ol className="mt-4 space-y-3 text-[var(--text-secondary)]">
            <li>
              <span className="font-medium text-[var(--text-primary)]">1.</span>{" "}
              Tell us your role and which Units matter most below.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">2.</span>{" "}
              We&rsquo;ll email you a personal invite link within 24 hours.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">3.</span>{" "}
              Rehearse at your own pace across the three modes. Free for the
              pilot cohort.
            </li>
            <li>
              <span className="font-medium text-[var(--text-primary)]">4.</span>{" "}
              We&rsquo;ll ask for 15 minutes of feedback at week 3. That&rsquo;s
              the whole ask.
            </li>
          </ol>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold">Try it — request an invite</h2>
          <p className="mt-3 text-[var(--text-secondary)]">
            8 pilot slots. Serious inbounds only — this is rehearsal, not a
            demo. I&rsquo;ll email you a personal invite within 24 hours.
          </p>

          <form
            method="post"
            action="/api/interest"
            className="mt-6 space-y-4 rounded-2xl border border-[var(--border-default)] p-6"
          >
            <input type="hidden" name="course" value="cio-cto" />
            <div>
              <label
                htmlFor="cc-email"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Email <span aria-hidden="true">*</span>
              </label>
              <input
                id="cc-email"
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
                htmlFor="cc-name"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Name
              </label>
              <input
                id="cc-name"
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Optional"
                className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="cc-role"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Your current role
              </label>
              <input
                id="cc-role"
                type="text"
                name="role"
                placeholder="e.g. Fractional CIO, newly-promoted CIO, IT Director"
                className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="cc-units"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                Which Units matter most?
              </label>
              <input
                id="cc-units"
                type="text"
                name="units"
                placeholder="e.g. Unit 09 + Unit 21 — or 'not sure yet'"
                className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--text-secondary)] focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="cc-message"
                className="block text-sm font-medium text-[var(--text-primary)]"
              >
                What are you trying to rehearse for?
              </label>
              <textarea
                id="cc-message"
                name="message"
                rows={3}
                placeholder="Board meeting, promotion interview, new-client onboarding, exam — whatever the real target is."
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
              Practice Exam is framed as rehearsal, not certification. Numeric
              rubric scoring for Distinction-tier is on the roadmap.
            </li>
            <li>
              Not affiliated with SIAS. Not an accredited training provider.
            </li>
            <li>
              Pilot pricing only during cohort 1. Commercial pricing set based
              on pilot data.
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
