import { NextResponse } from "next/server";
import { streamSimChat } from "@/lib/hf";

// Server-side streaming proxy: FOH browser → here → HF /api/chat (with session
// cookie) → token stream piped straight back. The browser can't POST with HF's
// session cookie cross-origin, so the auth + upstream connection live here and
// we hand the raw ReadableStream through untouched (no buffering).
export async function POST(request: Request) {
  const { message, conversationHistory, callerId, callerName, callId } =
    await request.json().catch(() => ({}));
  if (!message?.trim()) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const upstream = await streamSimChat({
      message,
      conversationHistory,
      callerId,
      callerName,
      callId,
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `HF chat responded ${upstream.status}` },
        { status: 502 },
      );
    }
    // Pass the upstream token stream straight through.
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Chat-Mode": upstream.headers.get("X-Chat-Mode") ?? "CALL",
        "X-AI-Engine": upstream.headers.get("X-AI-Engine") ?? "",
      },
    });
  } catch (e) {
    const reason = (e as Error).message;
    const status = reason === "no-credentials" ? 503 : 502;
    return NextResponse.json({ error: reason }, { status });
  }
}
