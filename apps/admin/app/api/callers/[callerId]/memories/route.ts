/**
 * @api GET /api/callers/[callerId]/memories
 *
 * Memory data for the Snapshot v3 tab — Wave A1 of the legacy-tab
 * retirement plan (Profile tab folding into Snapshot).
 *
 * Returns the caller's CallerMemory rows (non-superseded, non-expired)
 * + the per-category counts from CallerMemorySummary so the
 * SnapshotMemoryBlock can render summary tiles + a collapsible list
 * without a second round-trip.
 *
 * Auth: VIEWER + path-param scope (`studentAllowedToReadCaller`).
 * STUDENT may read OWN data only; OPERATOR+ may read any caller.
 * Same STUDENT-readable contract as the rest of the Snapshot tab
 * routes (`/attainment`, `/lo-mastery`, `/skills-evidence`,
 * `/sub-skills`, `/scheduler-decision`, `/personality`).
 *
 * Decision 5 stays: this surface does NOT render
 * `Parameter.interpretationHigh/Low` (memories don't carry those —
 * just listed here for the audit trail).
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import {
  studentAllowedToReadCaller,
  callerScopeMismatchResponse,
} from "@/lib/learner-scope";

export interface MemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  evidence: string | null;
  extractedAt: string | null;
  decayFactor: number;
}

export interface MemorySummaryEntry {
  factCount: number;
  preferenceCount: number;
  eventCount: number;
  topicCount: number;
  /** Sum across all category buckets */
  totalCount: number;
  /** ISO timestamp of the most recent memory extraction (null when empty) */
  lastMemoryAt: string | null;
}

export interface MemoriesResponse {
  ok: boolean;
  callerId: string;
  memories: MemoryEntry[];
  summary: MemorySummaryEntry;
}

const MAX_MEMORIES = 200;

export async function GET(
  _req: Request,
  context: { params: Promise<{ callerId: string }> },
): Promise<NextResponse<MemoriesResponse | { ok: false; error: string }>> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await context.params;
  if (!studentAllowedToReadCaller(auth.session, callerId)) {
    return callerScopeMismatchResponse();
  }

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true },
  });
  if (!caller) {
    return NextResponse.json(
      { ok: false, error: "Caller not found" },
      { status: 404 },
    );
  }

  const now = new Date();
  const [memoryRows, summaryRow] = await Promise.all([
    prisma.callerMemory.findMany({
      where: {
        callerId,
        supersededById: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ category: "asc" }, { confidence: "desc" }],
      take: MAX_MEMORIES,
      select: {
        id: true,
        category: true,
        key: true,
        value: true,
        confidence: true,
        evidence: true,
        extractedAt: true,
        decayFactor: true,
      },
    }),
    prisma.callerMemorySummary.findUnique({
      where: { callerId },
      select: {
        factCount: true,
        preferenceCount: true,
        eventCount: true,
        topicCount: true,
        lastMemoryAt: true,
      },
    }),
  ]);

  const factCount = summaryRow?.factCount ?? 0;
  const preferenceCount = summaryRow?.preferenceCount ?? 0;
  const eventCount = summaryRow?.eventCount ?? 0;
  const topicCount = summaryRow?.topicCount ?? 0;
  const summary: MemorySummaryEntry = {
    factCount,
    preferenceCount,
    eventCount,
    topicCount,
    totalCount: factCount + preferenceCount + eventCount + topicCount,
    lastMemoryAt: summaryRow?.lastMemoryAt
      ? summaryRow.lastMemoryAt.toISOString()
      : null,
  };

  const memories: MemoryEntry[] = memoryRows.map((m) => ({
    id: m.id,
    category: m.category,
    key: m.key,
    value: m.value,
    confidence: m.confidence,
    evidence: m.evidence,
    extractedAt: m.extractedAt ? m.extractedAt.toISOString() : null,
    decayFactor: m.decayFactor,
  }));

  return NextResponse.json({ ok: true, callerId, memories, summary });
}
