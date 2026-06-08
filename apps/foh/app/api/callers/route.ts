import { NextResponse } from "next/server";
import { fetchRosterLive, HF_BASE } from "@/lib/hf";
import { SAMPLE_ROSTER, type CallersResponse } from "@/lib/callers";

// Proxy: serves real HF callers when a DEV login is configured
// (HF_USER_EMAIL / HF_USER_PASSWORD), otherwise representative roster data
// in the same shape so the dashboard always renders.
export async function GET(): Promise<NextResponse<CallersResponse>> {
  try {
    const callers = await fetchRosterLive();
    return NextResponse.json({ live: true, source: HF_BASE, callers });
  } catch (e) {
    const reason = (e as Error).message;
    return NextResponse.json({
      live: false,
      source: "sample",
      callers: SAMPLE_ROSTER,
      note:
        reason === "no-credentials"
          ? "Set HF_USER_EMAIL / HF_USER_PASSWORD to load real callers."
          : `Live load failed (${reason}) — showing sample data.`,
    });
  }
}
