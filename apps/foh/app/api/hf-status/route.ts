import { NextResponse } from "next/server";
import { fetchReadiness, HF_BASE, type HfStatus } from "@/lib/hf";

// Server-side proxy: FOH → HF. Runs on our server (no browser CORS), so it's
// also where an auth header/token would live for protected endpoints later.
export async function GET(): Promise<NextResponse<HfStatus>> {
  try {
    const status = await fetchReadiness();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      {
        connected: false,
        source: HF_BASE,
        ready: false,
        hfTimestamp: null,
        stats: { callers: 0, calls: 0, memories: 0, analyzedCalls: 0 },
        sources: [],
        error: (e as Error).message,
      },
      { status: 502 },
    );
  }
}
