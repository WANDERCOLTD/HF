"use client";

import { useEffect, useRef, useState } from "react";
import {
  appendToken,
  greetingTrigger,
  toHistory,
  type ChatMessage,
} from "@/lib/chat";
import { TRIAGE, type CallerSummary, type CallersResponse } from "@/lib/callers";
import { CallerSelect } from "@/components/CallerSelect";

let counter = 0;
const nextId = () => `m${++counter}`;

export default function SimChatPage() {
  const [callers, setCallers] = useState<CallerSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [active, setActive] = useState<CallerSummary | null>(null);
  const [callId, setCallId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/callers")
      .then((r) => r.json() as Promise<CallersResponse>)
      .then((d) => {
        setCallers(d.callers);
        if (d.callers[0]) setSelectedId(d.callers[0].id);
      })
      .catch(() => {});
  }, []);

  const scrollToEnd = () =>
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
    );

  // Stream one assistant turn as a given caller/call (explicit args because
  // React state isn't committed yet at greeting time).
  async function streamTurn(caller: CallerSummary, cid: string, message: string, history: ChatMessage[]) {
    const assistantId = nextId();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    setStreaming(true);
    scrollToEnd();
    try {
      const res = await fetch("/api/sim-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationHistory: toHistory(history),
          callerId: caller.id,
          callerName: caller.name,
          callId: cid,
        }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setMessages((prev) => appendToken(prev, assistantId, decoder.decode(value, { stream: true })));
        scrollToEnd();
      }
    } catch (e) {
      setError((e as Error).message);
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
    }
  }

  async function startSession() {
    const caller = callers.find((c) => c.id === selectedId);
    if (!caller) return;
    setStarting(true);
    setError(null);
    setMessages([]);
    try {
      const res = await fetch("/api/sim-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId: caller.id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setActive(caller);
      setCallId(data.callId);
      setStarting(false);
      // AI opens with the caller's adapted first line.
      await streamTurn(caller, data.callId, greetingTrigger(data.firstLine), []);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || streaming || !active || !callId) return;
    setInput("");
    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    streamTurn(active, callId, text, history);
  }

  function endSession() {
    setActive(null);
    setCallId(null);
    setMessages([]);
    setError(null);
  }

  // ─── Picker view ───
  if (!active) {
    return (
      <main style={{ minHeight: "100vh", background: "var(--surface-primary)", color: "var(--text-primary)" }}>
        <Header title="SIM Chat" />
        <div style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
            Choose a caller and start a session — the assistant loads <em>their</em> adapted prompt,
            memories and progress, and responds as their tutor would.
          </p>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>
            Act as
          </div>
          <CallerSelect callers={callers} selectedId={selectedId} onSelect={setSelectedId} />
          <button
            onClick={startSession}
            disabled={starting || !selectedId}
            style={{ marginTop: 20, width: "100%", padding: "14px", borderRadius: 12, border: "none", background: starting ? "var(--border-default)" : "var(--band-high)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: starting ? "default" : "pointer" }}
          >
            {starting ? "Composing prompt & opening call…" : "Start session →"}
          </button>
          {error && (
            <div style={{ marginTop: 16, fontSize: 13, color: "var(--band-poor)", background: "var(--surface-secondary)", border: "1px solid var(--band-poor)", borderRadius: 10, padding: "10px 14px" }}>
              {error}
            </div>
          )}
        </div>
      </main>
    );
  }

  // ─── Chat view ───
  const t = TRIAGE[active.triage];
  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-primary)", color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--border-default)" }}>
        <button onClick={endSession} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600 }}>← Switch</button>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.color, boxShadow: `0 0 8px ${t.color}` }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.1 }}>Acting as {active.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>call {callId?.slice(0, 8)} · {t.label}</div>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "var(--band-high)", color: "#fff" }}>● LIVE</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} content={m.content} thinking={streaming && m.role === "assistant" && m.content === ""} />
          ))}
          {error && (
            <div style={{ alignSelf: "center", fontSize: 13, color: "var(--band-poor)", background: "var(--surface-secondary)", border: "1px solid var(--band-poor)", borderRadius: 10, padding: "8px 14px" }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-default)", padding: 16 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", gap: 10 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={`Message as ${active.name}…`}
            disabled={streaming}
            style={{ flex: 1, padding: "12px 16px", borderRadius: 12, border: "1px solid var(--border-default)", background: "var(--surface-secondary)", color: "var(--text-primary)", fontSize: 14, outline: "none" }}
          />
          <button onClick={send} disabled={streaming || !input.trim()} style={{ padding: "12px 24px", borderRadius: 12, border: "none", background: streaming || !input.trim() ? "var(--border-default)" : "var(--band-high)", color: "#fff", fontWeight: 600, fontSize: 14, cursor: streaming ? "default" : "pointer" }}>
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>
    </main>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--border-default)" }}>
      <a href="/" style={{ color: "var(--text-secondary)", textDecoration: "none", fontWeight: 600 }}>← Back</a>
      <span style={{ fontWeight: 700 }}>{title}</span>
    </div>
  );
}

function Bubble({ role, content, thinking }: { role: string; content: string; thinking: boolean }) {
  const isUser = role === "user";
  return (
    <div style={{ alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: "80%" }}>
      <div style={{ padding: "11px 16px", borderRadius: 16, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", background: isUser ? "var(--band-high)" : "var(--surface-secondary)", color: isUser ? "#fff" : "var(--text-primary)", border: isUser ? "none" : "1px solid var(--border-default)", borderBottomRightRadius: isUser ? 4 : 16, borderBottomLeftRadius: isUser ? 16 : 4 }}>
        {thinking ? <TypingDots /> : content}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-tertiary)", animation: `simBlink 1.2s ${i * 0.2}s infinite` }} />
      ))}
      <style>{`@keyframes simBlink { 0%,80%,100% { opacity:0.3 } 40% { opacity:1 } }`}</style>
    </span>
  );
}
