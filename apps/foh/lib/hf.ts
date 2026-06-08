// ---------------------------------------------------------------------------
// HF connection layer.
//
// This is FOH's real link to the HumanFirst backend. It calls HF's public
// system endpoint (GET /api/system/readiness — apps/admin, @auth none) and
// reshapes the live payload into a small view model for the UI.
//
// HF_API_URL is env-overridable; it defaults to the live DEV Cloud Run service.
// readiness is public, so no token is needed. Authenticated data (per-student
// CallScores) would additionally send a session/bearer — see app/api/scores.
// ---------------------------------------------------------------------------

export const HF_BASE =
  process.env.HF_API_URL ?? "https://dev.humanfirstfoundation.com";

export interface HfSource {
  key: string;
  label: string;
  status: "green" | "amber" | "red";
  count: number;
}

export interface HfStatus {
  connected: boolean;
  source: string;
  ready: boolean;
  hfTimestamp: string | null;
  stats: {
    callers: number;
    calls: number;
    memories: number;
    analyzedCalls: number;
  };
  sources: HfSource[];
  error?: string;
}

/** Pure mapper: HF's /api/system/readiness payload → our HfStatus view model. */
export function reshapeReadiness(raw: any, source: string): HfStatus {
  const s = raw?.stats ?? {};
  const sources = raw?.sources ?? {};
  return {
    connected: true,
    source,
    ready: Boolean(raw?.ready),
    hfTimestamp: raw?.timestamp ?? null,
    stats: {
      callers: s.totalCallers ?? 0,
      calls: s.totalCalls ?? 0,
      memories: s.totalMemories ?? 0,
      analyzedCalls: s.analyzedCalls ?? 0,
    },
    sources: Object.entries(sources).map(([key, v]: [string, any]) => ({
      key,
      label: v?.label ?? key,
      status: v?.status ?? "red",
      count: v?.count ?? 0,
    })),
  };
}

/** Live fetch against HF. Throws on network/HTTP failure. */
export async function fetchReadiness(): Promise<HfStatus> {
  const url = `${HF_BASE}/api/system/readiness`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HF responded ${res.status}`);
  return reshapeReadiness(await res.json(), HF_BASE);
}

// ---------------------------------------------------------------------------
// Authenticated path — per-caller data lives behind a next-auth session.
//
// HF's requireAuth is session-only (a bearer token won't open /api/callers).
// So we log in programmatically with HF_USER_EMAIL / HF_USER_PASSWORD (a real
// DEV account, ADMIN+), capture the session cookie, and call the roster with
// it. Configure those two env vars to switch the dashboard to live data.
// ---------------------------------------------------------------------------

import { reshapeRoster, type CallerSummary } from "@/lib/callers";
import { buildEntityContext } from "@/lib/chat";

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(
    /((?:__Secure-)?(?:authjs|next-auth)\.session-token)=([^;]+)/,
  );
  return match ? `${match[1]}=${match[2]}` : null;
}

// Cache the session cookie so we log in once, not per request.
let cachedSession: { cookie: string; at: number } | null = null;
const SESSION_TTL_MS = 20 * 60 * 1000;

/** Log in to HF with the configured DEV account → session cookie (cached). */
export async function hfLogin(): Promise<string> {
  if (cachedSession && Date.now() - cachedSession.at < SESSION_TTL_MS) {
    return cachedSession.cookie;
  }
  const email = process.env.HF_USER_EMAIL;
  const password = process.env.HF_USER_PASSWORD;
  if (!email || !password) throw new Error("no-credentials");

  // 1. CSRF token + cookie
  const csrfRes = await fetch(`${HF_BASE}/api/auth/csrf`, { cache: "no-store" });
  const { csrfToken } = await csrfRes.json();
  const csrfCookie = csrfRes.headers.get("set-cookie") ?? "";

  // 2. Submit credentials, capture the session cookie
  const loginRes = await fetch(`${HF_BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookie,
    },
    body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    redirect: "manual",
  });
  const session = extractSessionCookie(loginRes.headers.get("set-cookie"));
  if (!session) throw new Error("login-failed");

  cachedSession = { cookie: session, at: Date.now() };
  return session;
}

/** Authenticated roster fetch. Throws if unconfigured/login fails. */
export async function fetchRosterLive(): Promise<CallerSummary[]> {
  const session = await hfLogin();
  const rosterRes = await fetch(`${HF_BASE}/api/callers/roster`, {
    headers: { cookie: session },
    cache: "no-store",
  });
  if (!rosterRes.ok) throw new Error(`roster ${rosterRes.status}`);
  const data = await rosterRes.json();
  return reshapeRoster(data.roster);
}

export interface CallerSession {
  callId: string;
  firstLine: string | null;
}

/**
 * Start a SIM session AS a specific caller: compose & persist that caller's
 * adapted prompt, then open a call record. Mirrors HF's SimChat init flow.
 */
export async function startCallerSession(callerId: string): Promise<CallerSession> {
  const session = await hfLogin();
  const headers = { "content-type": "application/json", cookie: session };

  // 1. Compose the caller's next-call prompt (persists; supersedes prior active)
  const composeRes = await fetch(
    `${HF_BASE}/api/callers/${callerId}/compose-prompt`,
    { method: "POST", headers, body: JSON.stringify({ triggerType: "sim" }) },
  );
  if (!composeRes.ok) {
    const e = await composeRes.json().catch(() => ({}));
    throw new Error(e.error || `compose ${composeRes.status}`);
  }
  const composed = await composeRes.json();
  const rawId = composed?.prompt?.id;
  const usedPromptId =
    rawId && !String(rawId).startsWith("preview-") ? rawId : null;
  const firstLine =
    composed?.prompt?.llmPrompt?._quickStart?.first_line ?? null;

  // 2. Open a call record linked to the composed prompt
  const callRes = await fetch(`${HF_BASE}/api/callers/${callerId}/calls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "sim", usedPromptId }),
  });
  const callData = await callRes.json().catch(() => ({}));
  if (!callData.ok) throw new Error(callData.error || `call ${callRes.status}`);

  return { callId: callData.call.id, firstLine };
}

/**
 * Stream a chat turn AS a caller (POST /api/chat, mode CALL). The caller
 * entityContext + callId bind the turn to that caller's persona. Returns the
 * upstream Response so the proxy can pipe the token stream straight through.
 */
export async function streamSimChat(payload: {
  message: string;
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
  callerId?: string;
  callerName?: string;
  callId?: string;
}): Promise<Response> {
  const session = await hfLogin();
  return fetch(`${HF_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session },
    body: JSON.stringify({
      message: payload.message,
      mode: "CALL",
      entityContext: buildEntityContext(payload.callerId, payload.callerName),
      conversationHistory: payload.conversationHistory ?? [],
      ...(payload.callId ? { callId: payload.callId } : {}),
    }),
  });
}
