/**
 * Wire-shape transform for `GET /api/callers/[callerId]` `calls[]`.
 *
 * Extracted from the route handler so the wire contract can be pinned
 * by a unit test without mocking the route's ~30 Prisma calls.
 *
 * #1459 — pre-fix the inline transform stripped `sessionId`, `endedAt`,
 * `requestedModuleId`, and the three voice end-state fields even though
 * Prisma selected them, the route used `sessionId` internally for
 * `promptedCallIds`, and the UI `Call` type marked them as required.
 * That broke `CallsPromptsTab.buildTimeline` — every call rendered
 * "previous call has no composition" because `callBySessionId` was
 * empty.
 */

export type CallerDetailCallInput = {
  id: string;
  source: string;
  externalId: string | null;
  transcript: string;
  createdAt: Date;
  endedAt: Date | null;
  sessionId: string | null;
  session: { sequenceNumber: number; learnerFacingNumber: number | null } | null;
  playbookId: string | null;
  requestedModuleId: string | null;
  voiceEndedReason: string | null;
  voiceDurationSeconds: number | null;
  voiceCostUsd: number | null;
  curriculumModuleId: string | null;
  curriculumModule:
    | { id: string; slug: string; title: string; coversModules: unknown }
    | null;
  _count: { scores: number; behaviorMeasurements: number };
  rewardScore: { id: string } | null;
};

export type CallerDetailCallWire = {
  id: string;
  source: string;
  externalId: string | null;
  transcript: string;
  createdAt: Date;
  endedAt: Date | null;
  sessionId: string | null;
  callSequence: number | null;
  playbookId: string | null;
  requestedModuleId: string | null;
  hasScores: boolean;
  hasMemories: boolean;
  hasBehaviorMeasurements: boolean;
  hasRewardScore: boolean;
  hasPrompt: boolean;
  curriculumModuleId: string | null;
  curriculumModule: CallerDetailCallInput["curriculumModule"];
  voiceEndedReason: string | null;
  voiceDurationSeconds: number | null;
  voiceCostUsd: number | null;
};

export function serializeCallForCallerDetail(
  call: CallerDetailCallInput,
  memoryCount: number,
  hasPrompt: boolean,
): CallerDetailCallWire {
  return {
    id: call.id,
    source: call.source,
    externalId: call.externalId,
    transcript: call.transcript,
    createdAt: call.createdAt,
    endedAt: call.endedAt,
    sessionId: call.sessionId,
    callSequence: call.session?.learnerFacingNumber ?? null,
    playbookId: call.playbookId || null,
    requestedModuleId: call.requestedModuleId || null,
    hasScores: call._count.scores > 0,
    hasMemories: memoryCount > 0,
    hasBehaviorMeasurements: call._count.behaviorMeasurements > 0,
    hasRewardScore: !!call.rewardScore,
    hasPrompt,
    curriculumModuleId: call.curriculumModuleId || null,
    curriculumModule: call.curriculumModule || null,
    voiceEndedReason: call.voiceEndedReason ?? null,
    voiceDurationSeconds: call.voiceDurationSeconds ?? null,
    voiceCostUsd: call.voiceCostUsd ?? null,
  };
}
