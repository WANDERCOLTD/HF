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
import type { CriterionKey, CriterionScore, SessionScore } from "@/lib/types";

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

// ---------------------------------------------------------------------------
// Scores proxy — admin /api/calls/scores → FOH SessionScore[]
//
// Item #4 of epic #2277 (IELTS market test readiness). Replaces the
// synthetic SAMPLE in app/api/scores/route.ts with a real proxy of HF's
// admin endpoint. The admin endpoint returns one row PER (callId,
// parameterId) — we group by callId and reshape into SessionScore.
//
// IELTS parameterId → CriterionKey mapping mirrors the canonical order
// used by apps/admin/app/api/callers/[callerId]/mock-results/route.ts.
// Non-IELTS parameterIds (BEH-*, _average sentinels, etc.) are filtered
// out — the FOH Progress page is IELTS-only by design.
//
// Per the operator-pinned rule (MEMORY.md "NEVER fill empty scores with
// hardcoded defaults"): we NEVER fabricate criterion scores. A session
// that's missing a criterion row simply omits it from the response. A
// session with ZERO criterion rows is dropped entirely (no overall to
// compute honestly).
// ---------------------------------------------------------------------------

/**
 * Canonical IELTS Parameter.parameterId → FOH CriterionKey mapping.
 * Mirrors `apps/admin/app/api/callers/[callerId]/mock-results/route.ts`
 * `CRITERION_PARAM_ORDER` — keep these in sync. The label text is
 * resolved at runtime from the admin response's `parameter.name`
 * (HF-canonical authored display name; per
 * `.claude/rules/spec-readonly-boundary.md` IP boundary).
 */
const IELTS_PARAM_TO_KEY: Record<string, CriterionKey> = {
  skill_fluency_and_coherence_fc: "fluency",
  skill_lexical_resource_lr: "lexical",
  skill_grammatical_range_and_accuracy_gra: "grammar",
  skill_pronunciation_p: "pronunciation",
};

/** Canonical display order for the criteria array. */
const CRITERION_ORDER: CriterionKey[] = [
  "fluency",
  "lexical",
  "grammar",
  "pronunciation",
];

/**
 * Shape of one row from the admin GET /api/calls/scores response —
 * `CallScore` with `call.source` + `parameter.{name, parameterId}` joined.
 * Loose typing because we cross a process boundary; the mapper validates.
 *
 * `callerId` lives at the TOP LEVEL on CallScore (denormalized per
 * `prisma/schema.prisma::CallScore.callerId`) — NOT under `call.*`. The
 * admin `/api/calls/scores` endpoint only selects `{ source, transcript }`
 * from the `call` relation, so `row.call.callerId` is always undefined.
 * (Caught in PR #2288 review.)
 */
export interface AdminCallScoreRow {
  callId: string;
  callerId?: string | null;
  parameterId: string;
  score: number;
  createdAt: string;
  call?: { source?: string | null } | null;
  parameter?: { name?: string | null; parameterId?: string | null } | null;
}

/**
 * Heuristic Call.source → SessionScore.type label. The admin endpoint
 * carries free-form `Call.source` values (e.g. "vapi-pstn",
 * "sim", "webrtc"). For the FOH Progress page we surface a short
 * label; richer "P1/P2/P3/Mock" classification requires module-level
 * context the admin endpoint doesn't return today (follow-on if needed).
 *
 * Until then: pass the source through, capitalising "sim" → "Sim",
 * "vapi-pstn" → "Voice", etc.
 */
function inferSessionType(source: string | null | undefined): string {
  if (!source) return "Session";
  if (source === "sim") return "Sim";
  if (source.startsWith("vapi")) return "Voice";
  if (source.startsWith("webrtc")) return "Voice";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/**
 * Pure mapper: admin `/api/calls/scores` rows → FOH `SessionScore[]`.
 *
 * - Groups by `callId`
 * - Filters to the 4 IELTS criterion parameters (drops `BEH-*`,
 *   `_average` sentinels, behaviour rows)
 * - Drops sessions with zero IELTS criterion rows (no honest overall)
 * - Optionally scopes to `callerId` (FOH is single-learner per session;
 *   when supplied, only that caller's sessions surface)
 * - Sorts oldest-first (the Progress page treats `sessions[0]` as
 *   "First" and `sessions[length-1]` as "Latest")
 * - Computes `overall` as the mean of the available criteria for the
 *   session (matches the admin mock-results route's overall calc)
 */
export function reshapeScores(
  rows: AdminCallScoreRow[],
  opts: { callerId?: string | null } = {},
): SessionScore[] {
  const scopedCallerId = opts.callerId ?? null;

  // Group rows by callId, keeping only IELTS criterion rows (and only
  // the matching caller's rows if a scope was supplied).
  const buckets = new Map<
    string,
    {
      date: string;
      source: string | null;
      criteria: Map<CriterionKey, { label: string; scores: number[] }>;
    }
  >();

  for (const row of rows) {
    const key = IELTS_PARAM_TO_KEY[row.parameterId];
    if (!key) continue; // not an IELTS criterion row
    if (scopedCallerId !== null && row.callerId !== scopedCallerId) {
      continue;
    }
    const label = row.parameter?.name ?? row.parameterId; // canonical name
    let bucket = buckets.get(row.callId);
    if (!bucket) {
      bucket = {
        date: row.createdAt,
        source: row.call?.source ?? null,
        criteria: new Map(),
      };
      buckets.set(row.callId, bucket);
    }
    const slot = bucket.criteria.get(key) ?? { label, scores: [] };
    slot.scores.push(row.score);
    bucket.criteria.set(key, slot);
    // Keep the earliest createdAt for the session (admin returns
    // newest-first; if multiple rows land at the same callId they
    // share a createdAt anyway).
    if (row.createdAt < bucket.date) bucket.date = row.createdAt;
  }

  const sessions: SessionScore[] = [];
  for (const [callId, bucket] of buckets) {
    // Build the per-criterion array in canonical display order, taking
    // the mean of any duplicate rows (the Mock module can carry P1/P2/P3
    // segment-level scores under the same callId — mean reflects the
    // full session).
    const criteria: CriterionScore[] = [];
    for (const key of CRITERION_ORDER) {
      const slot = bucket.criteria.get(key);
      if (!slot || slot.scores.length === 0) continue;
      const mean =
        slot.scores.reduce((a, b) => a + b, 0) / slot.scores.length;
      criteria.push({ key, label: slot.label, score: mean });
    }
    if (criteria.length === 0) continue; // no honest overall possible
    const overall =
      criteria.reduce((a, c) => a + c.score, 0) / criteria.length;
    sessions.push({
      id: callId,
      date: bucket.date,
      type: inferSessionType(bucket.source),
      overall,
      criteria,
    });
  }

  // Oldest-first — Progress page treats sessions[0] as "First" and
  // sessions[length-1] as "Latest".
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  return sessions;
}

/**
 * Authenticated scores fetch. Logs in as the configured DEV account
 * (`HF_USER_EMAIL` / `HF_USER_PASSWORD`), proxies admin
 * `/api/calls/scores`, and reshapes. Throws on missing creds /
 * network / non-2xx.
 *
 * NOTE: the admin endpoint does NOT accept a `callerId` query param
 * today — it returns scores across every caller the session can see.
 * We filter client-side in the mapper. For market test that's
 * acceptable (admin sessions see everything; the FOH consumer
 * scopes to ONE caller); a future hardening can push the scope
 * server-side (see follow-on note in app/api/scores/route.ts).
 */
export async function fetchScoresLive(
  opts: { callerId?: string | null; limit?: number } = {},
): Promise<SessionScore[]> {
  const session = await hfLogin();
  const limit = opts.limit ?? 200;
  const res = await fetch(
    `${HF_BASE}/api/calls/scores?limit=${encodeURIComponent(String(limit))}`,
    { headers: { cookie: session }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`scores ${res.status}`);
  const data = await res.json();
  if (!data?.ok || !Array.isArray(data?.scores)) {
    throw new Error("scores: unexpected response shape");
  }
  return reshapeScores(data.scores as AdminCallScoreRow[], {
    callerId: opts.callerId ?? null,
  });
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
