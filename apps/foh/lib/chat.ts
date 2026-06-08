// Chat message model + pure helpers for the streaming SIM chat. No React here,
// so the reducer logic is unit-tested independently of the stream.

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** Append a streamed token to the message with the given id (immutable). */
export function appendToken(
  messages: ChatMessage[],
  id: string,
  token: string,
): ChatMessage[] {
  return messages.map((m) =>
    m.id === id ? { ...m, content: m.content + token } : m,
  );
}

/** Shape the visible history into HF's conversationHistory payload. */
export function toHistory(
  messages: ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

export interface EntityBreadcrumb {
  type: string;
  id: string;
  label: string;
}

/**
 * HF's entityContext breadcrumb that binds a chat turn to a specific caller —
 * this is what makes /api/chat load that caller's persona, memories and prompt.
 */
export function buildEntityContext(
  callerId?: string,
  callerName?: string,
): EntityBreadcrumb[] {
  if (!callerId) return [];
  return [{ type: "caller", id: callerId, label: callerName ?? callerId }];
}

/** The instruction that triggers the AI's caller-specific opening line. */
export function greetingTrigger(firstLine: string | null): string {
  return firstLine
    ? `The user just opened the chat. Open with exactly: "${firstLine}"`
    : "The user just opened the chat. Greet them warmly as if answering a phone call. Be brief and natural.";
}
