"use client";

// Phase 1 enrolment chat — minimal two-pane LHS-chat / RHS-form.
//
// Uses tallyseal's pure-data primitives (TallysealBanner,
// TallysealSuggestionRail, TallysealIntentForm, TallysealActivityTray)
// — they take events + suggestions + values as props and render
// declaratively, no runtime needed.
//
// The chat itself is a minimal text-based UI for Phase 1. Deep
// assistant-ui runtime integration (TallysealAssistantUI composite
// + AssistantRuntimeProvider) is deferred to Phase 1.5 — it adds
// streaming + tool-call UX but isn't needed to validate the stack.
//
// C5 discipline: server-side route handlers do all Anthropic SDK work.
// This component talks only to /api/intake/* over fetch.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TallysealBanner,
  TallysealSuggestionRail,
  TallysealIntentForm,
  TallysealActivityTray,
  type CrawcusSpec,
  type Event,
  type Suggestion,
} from "@/lib/intake/tallyseal";
import { EnrollmentIntake, INTERNAL_FIELDS } from "@/lib/intake/specs/enrollment.intent";

const ART13_REQUIREMENT_ID = "gdpr.art13.privacy-notice";
const ART50_REQUIREMENT_ID = "eu-ai-act.art50.ai-interaction-disclosure";

// Inline Article 13 notice — minimal DRAFT text. Production should
// load + render the full mdx from lib/intake/copy/gdpr-art13-privacy.*
// (which is what the DRAFT-in-production guard refuses), but for the
// scroll-signal flow we need the SAME text on screen as is hashed.
const ART13_NOTICE_BODY = `Privacy Notice — Enrolment (DRAFT)

HumanFirst Foundation is the data controller. We collect your name and email so we can identify your account and contact you about the course you're enrolling in (GDPR Art. 6(1)(b) — contract).

We process this information for the purposes of adult-learner enrolment and AI-mediated tutoring. Sub-processor: Anthropic (EU). Retention: 7 years by default.

You can contact our Data Protection Officer at dpo@humanfirstfoundation.com. You have the right to access, rectify, erase, restrict, port, and object to processing of your data, and to lodge a complaint with the ICO.`;

// Inline EU AI Act Art 50 notice — same DRAFT-vs-production caveat as
// ART13_NOTICE_BODY above. Surfaced so the learner can scroll-signal
// against the body that was hashed at delivery time.
const ART50_NOTICE_BODY = `AI Interaction Disclosure (DRAFT)

You're interacting with an AI assistant powered by Anthropic Claude. EU AI Act Article 50 requires us to tell you when an AI system is in use.

The assistant captures the values you provide and submits them to a human-reviewed enrolment pipeline. It does NOT make enrolment decisions about you and it cannot grant or deny your access on its own.

You can request a human handover at any time by typing "human please" in the chat, or by emailing dpo@humanfirstfoundation.com.`;

interface ChatMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
}

interface BootstrapState {
  readonly intentId: string;
  readonly chatSessionId: string;
  readonly events: readonly Event[];
  readonly suggestions: readonly Suggestion[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly messages: readonly ChatMessage[];
}

function newChatSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Date round-trip: JSON.stringify turns Date → ISO string, so events
// arrive at the client with timestamp:string. The tallyseal components
// (TallysealActivityTray, etc.) call `event.timestamp.getTime()`, so
// we rehydrate before storing in state.
function rehydrateEvents(events: readonly Event[]): Event[] {
  return events.map((e) => {
    const ts = (e as unknown as { timestamp: unknown }).timestamp;
    if (ts instanceof Date) return e as Event;
    return { ...e, timestamp: new Date(ts as string | number) } as Event;
  });
}

export interface EnrollmentChatProps {
  /**
   * Classroom join token from /intake/enrollment-crawcus/[token]. When
   * present, bootstrap resolves it via /api/join/:token and binds the
   * enrolment to that classroom. When absent, the chat runs as a
   * platform-level demo with no classroom binding.
   */
  readonly classroomToken?: string;

  /**
   * V2 (auth-first) only: field values already captured BEFORE the chat
   * started — typically `email` from /intake/v2/[token]. Passed through
   * to /api/intake/bootstrap which writes them into the intent at start
   * time. The spec-driven prompt (#1130) sees them as set and the AI
   * skips asking. (#1141 Story 2.)
   */
  readonly prefilledValues?: Record<string, string>;
}

export function EnrollmentChat({
  classroomToken,
  prefilledValues,
}: EnrollmentChatProps = {}) {
  const [boot, setBoot] = useState<BootstrapState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Spec passed to TallysealIntentForm + ValuesPanel — drop the 4
  // internal fields (compliance bookkeeping + classroom routing) so
  // the learner only sees fields they can populate.
  const learnerFacingSpec = useMemo<CrawcusSpec>(() => {
    const filteredFields = Object.fromEntries(
      Object.entries(EnrollmentIntake.fields).filter(
        ([k]) => !INTERNAL_FIELDS.includes(k as (typeof INTERNAL_FIELDS)[number]),
      ),
    );
    return { ...EnrollmentIntake, fields: filteredFields };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const chatSessionId = newChatSessionId();
    (async () => {
      try {
        const res = await fetch("/api/intake/bootstrap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chatSessionId,
            specKey: "EnrollmentIntake",
            classroomToken,
            prefilledValues,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => `${res.status}`);
          throw new Error(`bootstrap failed: ${text}`);
        }
        const data = (await res.json()) as BootstrapPayload;
        if (cancelled) return;
        setBoot({
          intentId: data.intentId,
          chatSessionId,
          events: rehydrateEvents(data.events),
          suggestions: data.suggestions,
          values: data.values,
          messages: data.messages ?? [],
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to start enrolment");
      }
    })();
    return () => {
      cancelled = true;
    };
    // prefilledValues is intentionally NOT in deps — we don't want a
    // re-bootstrap if the parent re-renders with the same data (would
    // create a second intent). Mount-time-only is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomToken]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [boot?.messages]);

  async function send(message: string) {
    if (!boot || pending || !message.trim()) return;
    setPending(true);
    setInput("");
    const localUserTurn: ChatMessage = { role: "user", content: message };
    setBoot((b) => (b ? { ...b, messages: [...b.messages, localUserTurn] } : b));
    try {
      const res = await fetch("/api/intake/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // HF-D P1 #3 (issue #1542): intentId travels as the
        // `__hf_intake_sid` cookie set by /api/intake/bootstrap. The
        // same-origin fetch sends it automatically.
        body: JSON.stringify({
          chatSessionId: boot.chatSessionId,
          message,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => `${res.status}`);
        throw new Error(`chat failed: ${text}`);
      }
      const data = (await res.json()) as ChatTurnPayload;
      setBoot((b) =>
        b
          ? {
              ...b,
              events: rehydrateEvents(data.events),
              suggestions: data.suggestions,
              values: data.values,
              messages: data.messages,
            }
          : b,
      );
      // On commit with a classroom-bound URL, hand off to HF's existing
      // /join/[token] page which auto-submits when firstName + lastName +
      // email are URL params. That path mints the session + creates the
      // Caller + redirects to the student dashboard — zero new auth
      // logic in this component.
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return (
      <div className="hf-banner hf-banner-error">
        Couldn&rsquo;t start enrolment: {error}
      </div>
    );
  }

  if (!boot) {
    return <div className="hf-section-desc">Starting&hellip;</div>;
  }

  return (
    <div className="intake-grid">
      <section className="hf-flex hf-flex-col hf-gap-md">
        <TallysealBanner
          events={[...boot.events]}
          requirementId={ART13_REQUIREMENT_ID as never}
          noticeText={ART13_NOTICE_BODY}
          onReadSignal={(signal) => {
            // Fire-and-forget — SIGNAL not gate. Best-effort POST;
            // failure does not block enrolment progress. HF-D P1 #3:
            // intentId travels as the `__hf_intake_sid` cookie.
            void fetch("/api/intake/disclosure-signal", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ signal }),
            }).catch(() => {});
          }}
        />
        {/* Disclosure body — kept in step with TallysealBanner.noticeText
            so the SHA-256 contentHash on the emitted DisclosureSignal
            matches what the learner reads. TallysealBanner renders
            event-chips only; the actual notice text must be surfaced
            here for the read-signal to mean anything. */}
        <DisclosureNoticeCard
          chatSessionId={boot.chatSessionId}
          requirementId={ART13_REQUIREMENT_ID}
          body={ART13_NOTICE_BODY}
          acknowledged={hasAcknowledgement(boot.events, ART13_REQUIREMENT_ID)}
          onAcknowledged={() => {
            // Optimistic refresh — re-fetch the snapshot via the next
            // chat turn or by re-bootstrapping the events. Cheapest:
            // refetch session events directly. HF-D P1 #3: bearer is
            // the `__hf_intake_sid` cookie, no URL path param.
            void fetch("/api/intake/session")
              .then((r) => r.json())
              .then((data) => {
                setBoot((b) => (b ? { ...b, events: rehydrateEvents(data.events) } : b));
              })
              .catch(() => {});
          }}
        />
        {/* EU AI Act Art 50 — parallel surface to ART13 so the audit
            bundle carries delivery + acknowledgement for BOTH notices.
            Same TallysealBanner scroll-signal contract + same
            DisclosureNoticeCard acknowledge contract. */}
        <TallysealBanner
          events={[...boot.events]}
          requirementId={ART50_REQUIREMENT_ID as never}
          noticeText={ART50_NOTICE_BODY}
          onReadSignal={(signal) => {
            void fetch("/api/intake/disclosure-signal", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ signal }),
            }).catch(() => {});
          }}
        />
        <DisclosureNoticeCard
          chatSessionId={boot.chatSessionId}
          requirementId={ART50_REQUIREMENT_ID}
          body={ART50_NOTICE_BODY}
          acknowledged={hasAcknowledgement(boot.events, ART50_REQUIREMENT_ID)}
          onAcknowledged={() => {
            void fetch("/api/intake/session")
              .then((r) => r.json())
              .then((data) => {
                setBoot((b) => (b ? { ...b, events: rehydrateEvents(data.events) } : b));
              })
              .catch(() => {});
          }}
        />
        <div
          ref={scrollRef}
          className="intake-thread"
          data-testid="enrollment-chat-thread"
        >
          {boot.messages.length === 0 ? (
            <p className="hf-section-desc">
              The assistant will start the conversation when ready.
            </p>
          ) : (
            boot.messages.map((m, i) => (
              <ChatBubble key={i} role={m.role} content={m.content} />
            ))
          )}
        </div>
        <TallysealSuggestionRail
          suggestions={[...boot.suggestions]}
          onAccept={(s) =>
            send(`I accept the suggestion for "${s.fieldKey}": ${JSON.stringify(s.proposedValue)}`)
          }
        />
        <form
          className="intake-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            placeholder="Type your message…"
            className="hf-input intake-composer-input"
            data-testid="enrollment-chat-input"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="hf-btn hf-btn-primary"
            data-testid="enrollment-chat-send"
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </form>
      </section>
      <aside className="hf-flex hf-flex-col hf-gap-md">
        <ValuesPanel values={boot.values} />
        {/* TallysealIntentForm renders the raw spec schema (every field as
            a row). Useful when authoring/auditing an intent, noise to a
            learner who's already seeing the populated values in
            ValuesPanel above. Gate on NEXT_PUBLIC_DEBUG_INTAKE so only
            local debugging sessions see it. Same for ActivityTray — the
            hash-chained audit trail is for support/compliance review,
            not the learner's first moment with us. */}
        {process.env.NEXT_PUBLIC_DEBUG_INTAKE === "true" && (
          <>
            <TallysealIntentForm
              spec={learnerFacingSpec}
              suggestions={[...boot.suggestions]}
              values={boot.values}
            />
            <TallysealActivityTray events={[...boot.events]} limit={20} />
          </>
        )}
      </aside>
    </div>
  );
}

// Captured values display. TallysealIntentForm@0.1.0 renders rows
// without values — per the docs, "Field-input widgets remain the
// consumer's concern". Until v0.2 ships a values slot, we render a
// compact summary here so the form filling is visible.
const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  displayName: "Display name",
  timezone: "Timezone",
  preferredContactMethod: "Preferred contact",
  marketingOptIn: "Marketing opt-in",
  accessibilityNote: "Accessibility note",
  ageRange: "Age range",
  classroomName: "Course",
};

const VALUE_FIELD_ORDER = [
  "classroomName",
  "firstName",
  "lastName",
  "email",
  "displayName",
  "timezone",
  "preferredContactMethod",
  "marketingOptIn",
  "accessibilityNote",
  "ageRange",
];

function ValuesPanel({ values }: { values: Readonly<Record<string, unknown>> }) {
  const populated = VALUE_FIELD_ORDER.filter((k) => values[k] !== undefined && values[k] !== "");
  return (
    <div className="hf-card-compact" data-testid="enrollment-values-panel">
      <h3 className="hf-category-label hf-mb-sm">Captured so far</h3>
      {populated.length === 0 ? (
        <p className="hf-section-desc">Nothing captured yet.</p>
      ) : (
        <dl className="hf-flex hf-flex-col hf-gap-xs">
          {populated.map((k) => (
            <div key={k} className="hf-flex hf-flex-between hf-gap-sm">
              <dt className="hf-section-desc">{FIELD_LABELS[k] ?? k}</dt>
              <dd>{String(values[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

interface DisclosureNoticeCardProps {
  readonly chatSessionId: string;
  readonly requirementId: string;
  readonly body: string;
  readonly acknowledged: boolean;
  readonly onAcknowledged: () => void;
}

function DisclosureNoticeCard({
  chatSessionId,
  requirementId,
  body,
  acknowledged,
  onAcknowledged,
}: DisclosureNoticeCardProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ack() {
    if (pending || acknowledged) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/intake/disclosure-acknowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // HF-D P1 #3: intentId travels as the `__hf_intake_sid` cookie.
        body: JSON.stringify({ chatSessionId, requirementId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => `${res.status}`);
        throw new Error(text);
      }
      onAcknowledged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "acknowledge failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="intake-notice-card" data-testid="intake-art13-notice">
      <header className="intake-notice-card-head">
        <span className="intake-notice-card-title">Privacy Notice (GDPR Art. 13)</span>
      </header>
      <pre className="intake-notice-body">{body}</pre>
      <footer className="intake-notice-card-foot">
        {acknowledged ? (
          <span className="intake-notice-acked" data-testid="intake-art13-acked">
            ✓ You confirmed you read this notice
          </span>
        ) : (
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={ack}
            disabled={pending}
            data-testid="intake-art13-ack-btn"
          >
            {pending ? "Confirming…" : "I have read this notice"}
          </button>
        )}
        {error ? <span className="hf-banner hf-banner-error">{error}</span> : null}
      </footer>
    </section>
  );
}

function hasAcknowledgement(events: readonly Event[], requirementId: string): boolean {
  // Walk events for a DisclosureAcknowledged whose `acknowledges`
  // EventId points to a DisclosureDelivered carrying this
  // requirementId. Avoids assuming any particular event order.
  const deliveredIds = new Set<string>();
  for (const e of events) {
    if (e.kind === "DisclosureDelivered") {
      const payload = (e as { payload?: { requirementId?: string } }).payload;
      if (payload?.requirementId === requirementId) {
        const id = (e as { id?: string }).id;
        if (id) deliveredIds.add(id);
      }
    }
  }
  for (const e of events) {
    if (e.kind === "DisclosureAcknowledged") {
      const payload = (e as { payload?: { acknowledges?: string } }).payload;
      if (payload?.acknowledges && deliveredIds.has(payload.acknowledges)) return true;
    }
  }
  return false;
}

function ChatBubble({ role, content }: ChatMessage) {
  const variantClass =
    role === "user"
      ? "intake-bubble--user"
      : role === "assistant"
      ? "intake-bubble--assistant"
      : "intake-bubble--system";
  return (
    <div data-role={role} className={`intake-bubble ${variantClass}`}>
      {content}
    </div>
  );
}

interface BootstrapPayload {
  readonly intentId: string;
  readonly events: readonly Event[];
  readonly suggestions: readonly Suggestion[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly messages?: readonly ChatMessage[];
}

interface ChatTurnPayload {
  readonly events: readonly Event[];
  readonly suggestions: readonly Suggestion[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly messages: readonly ChatMessage[];
  readonly redirectUrl?: string | null;
}
