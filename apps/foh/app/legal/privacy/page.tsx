import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — HumanFirst",
  description: "How HumanFirst handles your data during the pilot.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--surface-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            HumanFirst
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-16 text-[var(--text-secondary)]">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          Privacy — plain English
        </h1>
        <p className="mt-2 text-sm text-[var(--text-tertiary)]">
          Last updated: {new Date().toISOString().slice(0, 10)}. Pilot-mode
          policy. A full policy ships with the commercial launch.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            What we collect
          </h2>
          <p>
            <strong>When you request a pilot invite:</strong> your email, name
            (optional), and whatever you write in the form. That&rsquo;s it.
          </p>
          <p>
            <strong>When you use the pilot:</strong> your voice recordings and
            transcripts of your sessions, the scores our engine produces, and
            timestamps of what you did. We use these to give you feedback and
            to improve the product.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            What we don&rsquo;t do
          </h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>Sell your data. Ever.</li>
            <li>Use your recordings to train third-party AI models.</li>
            <li>Share your data with anyone outside HumanFirst Foundation.</li>
            <li>
              Contact you for anything other than your pilot participation and
              pilot follow-up.
            </li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Your rights (GDPR)
          </h2>
          <p>You can, at any time:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Ask us what data we hold about you.</li>
            <li>Ask us to delete all of it.</li>
            <li>Withdraw your consent to further processing.</li>
            <li>Ask for a portable copy of what we hold.</li>
          </ul>
          <p>
            One email does all of these:{" "}
            <a
              href="mailto:hfpw@thewanders.com"
              className="underline"
            >
              hfpw@thewanders.com
            </a>
            . We respond within 30 days (usually within 3).
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Third parties we use
          </h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Voice provider (VAPI + Deepgram):</strong> transcribes
              your speech and produces the AI voice you hear.
            </li>
            <li>
              <strong>Anthropic / OpenAI:</strong> the AI models that generate
              tutor responses and scoring. We do not authorise them to train on
              your data.
            </li>
            <li>
              <strong>Google Cloud (EU region):</strong> where the data is
              stored.
            </li>
            <li>
              <strong>Resend:</strong> delivers the confirmation email you get
              after requesting a pilot invite and the internal notification to
              us.
            </li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Retention
          </h2>
          <p>
            Pilot data is retained for the length of the pilot cohort plus 90
            days for post-pilot analysis. After that it&rsquo;s deleted, unless
            you ask us to delete it sooner.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Contact
          </h2>
          <p>
            HumanFirst Foundation. Data controller. Reach us at{" "}
            <a
              href="mailto:hfpw@thewanders.com"
              className="underline"
            >
              hfpw@thewanders.com
            </a>
            .
          </p>
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
    </main>
  );
}
