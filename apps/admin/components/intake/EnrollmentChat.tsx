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

import { useEffect, useRef, useState } from "react";
import {
  TallysealBanner,
  TallysealSuggestionRail,
  TallysealIntentForm,
  TallysealActivityTray,
  type Event,
  type Suggestion,
} from "@/lib/intake/tallyseal";
import { EnrollmentIntake } from "@/lib/intake/specs/enrollment.intent";

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
}

export function EnrollmentChat({ classroomToken }: EnrollmentChatProps = {}) {
  const [boot, setBoot] = useState<BootstrapState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({
          intentId: boot.intentId,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        Couldn&rsquo;t start enrolment: {error}
      </div>
    );
  }

  if (!boot) {
    return <div className="text-sm text-muted-foreground">Starting&hellip;</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
      <section className="flex flex-col gap-4">
        <TallysealBanner events={[...boot.events]} />
        <div
          ref={scrollRef}
          className="min-h-[420px] max-h-[60vh] overflow-y-auto rounded border bg-card p-4 space-y-3"
          data-testid="enrollment-chat-thread"
        >
          {boot.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
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
          className="flex gap-2"
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
            className="flex-1 rounded border px-3 py-2 text-sm"
            data-testid="enrollment-chat-input"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
            data-testid="enrollment-chat-send"
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </form>
      </section>
      <aside className="flex flex-col gap-4">
        <ValuesPanel values={boot.values} />
        <TallysealIntentForm
          spec={EnrollmentIntake}
          suggestions={[...boot.suggestions]}
          values={boot.values}
        />
        <TallysealActivityTray events={[...boot.events]} limit={20} />
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
    <div className="rounded border bg-card p-3 text-sm" data-testid="enrollment-values-panel">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Captured so far
      </h3>
      {populated.length === 0 ? (
        <p className="text-muted-foreground">Nothing captured yet.</p>
      ) : (
        <dl className="space-y-1">
          {populated.map((k) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{FIELD_LABELS[k] ?? k}</dt>
              <dd className="font-medium text-foreground">{String(values[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ChatBubble({ role, content }: ChatMessage) {
  const isUser = role === "user";
  return (
    <div
      data-role={role}
      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
        isUser ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
      }`}
    >
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
}
