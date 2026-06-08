import { NextResponse } from "next/server";
import { startCallerSession } from "@/lib/hf";

// Start a SIM session as a chosen caller: compose their prompt + open a call.
export async function POST(request: Request) {
  const { callerId } = await request.json().catch(() => ({}));
  if (!callerId) {
    return NextResponse.json({ ok: false, error: "callerId is required" }, { status: 400 });
  }
  try {
    const session = await startCallerSession(callerId);
    return NextResponse.json({ ok: true, ...session });
  } catch (e) {
    const reason = (e as Error).message;
    return NextResponse.json(
      { ok: false, error: reason },
      { status: reason === "no-credentials" ? 503 : 502 },
    );
  }
}
