/**
 * @api GET /api/calls/:callId
 * @visibility public
 * @scope calls:read
 * @auth session
 * @tags calls
 * @description Get detailed call data including basic call info, scores with parameter details, extracted memories, behavior measurements, reward score, triggered prompts, personality observation, and effective behavior targets (layered: SYSTEM -> PLAYBOOK -> SEGMENT -> CALLER).
 * @pathParam callId string - The call ID to retrieve
 * @response 200 { ok: true, call: Call, scores: CallScore[], memories: CallerMemory[], measurements: BehaviorMeasurement[], rewardScore: RewardScore | null, triggeredPrompts: ComposedPrompt[], personalityObservation: PersonalityObservation | null, effectiveTargets: EffectiveTarget[], counts: { scores, memories, measurements, prompts, targets } }
 * @response 404 { ok: false, error: "Call not found" }
 * @response 500 { ok: false, error: "Failed to fetch call" }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callId } = await params;

    const [call, scores, memories, measurements, rewardScore, triggeredPrompts, personalityObservation] = await Promise.all([
      // Basic call info
      prisma.call.findUnique({
        where: { id: callId },
        select: {
          id: true,
          source: true,
          externalId: true,
          transcript: true,
          createdAt: true,
          callSequence: true,
          callerId: true,
          caller: {
            select: {
              id: true,
              name: true,
              email: true,
              domainId: true,
            },
          },
        },
      }),

      // Scores with parameter details and analysis spec
      prisma.callScore.findMany({
        where: { callId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          parameterId: true,
          score: true,
          confidence: true,
          evidence: true,
          reasoning: true,
          scoredBy: true,
          scoredAt: true,
          createdAt: true,
          analysisSpecId: true,
          parameter: {
            select: {
              name: true,
              definition: true,
            },
          },
          analysisSpec: {
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
            },
          },
        },
      }),

      // Memories extracted from this call
      prisma.callerMemory.findMany({
        where: {
          callId,
          supersededById: null,
        },
        orderBy: { extractedAt: "desc" },
        select: {
          id: true,
          category: true,
          key: true,
          value: true,
          evidence: true,
          confidence: true,
          extractedAt: true,
          extractedBy: true,
        },
      }),

      // Behavior measurements
      prisma.behaviorMeasurement.findMany({
        where: { callId },
        select: {
          id: true,
          parameterId: true,
          actualValue: true,
          confidence: true,
          evidence: true,
          createdAt: true,
          parameter: {
            select: {
              name: true,
              definition: true,
            },
          },
        },
      }),

      // Reward score
      prisma.rewardScore.findUnique({
        where: { callId },
        select: {
          id: true,
          overallScore: true,
          parameterDiffs: true,
          modelVersion: true,
          scoredAt: true,
        },
      }),

      // Prompts triggered by this call
      prisma.composedPrompt.findMany({
        where: { triggerCallId: callId },
        orderBy: { composedAt: "desc" },
        select: {
          id: true,
          prompt: true,
          llmPrompt: true, // LLM-friendly structured JSON version
          triggerType: true,
          model: true,
          status: true,
          composedAt: true,
          inputs: true,
        },
      }),

      // Personality observation for this call
      prisma.personalityObservation.findUnique({
        where: { callId },
        select: {
          id: true,
          openness: true,
          conscientiousness: true,
          extraversion: true,
          agreeableness: true,
          neuroticism: true,
          confidence: true,
          decayFactor: true,
          observedAt: true,
        },
      }),
    ]);

    if (!call) {
      return NextResponse.json(
        { ok: false, error: "Call not found" },
        { status: 404 }
      );
    }

    // Fetch effective behavior targets for this caller
    // Cascade: SYSTEM → PLAYBOOK → SEGMENT → CALLER
    // Each lower level overrides the higher level
    let effectiveTargets: any[] = [];

    if (call.callerId) {
      // Get caller's segment and identity info, and find published playbook for their domain
      const [callerIdentity, publishedPlaybook] = await Promise.all([
        prisma.callerIdentity.findFirst({
          where: { callerId: call.callerId },
          select: {
            id: true,
            segmentId: true,
            segment: { select: { id: true, name: true } },
          },
        }),
        // Find the published playbook for the caller's domain
        call.caller?.domainId
          ? prisma.playbook.findFirst({
              where: {
                domainId: call.caller.domainId,
                status: "PUBLISHED",
              },
              select: { id: true, name: true },
            })
          : Promise.resolve(null),
      ]);

      // Fetch all potentially applicable targets
      const [systemTargets, playbookTargets, segmentTargets, callerTargets] = await Promise.all([
        // SYSTEM level targets
        prisma.behaviorTarget.findMany({
          where: {
            scope: "SYSTEM",
            effectiveUntil: null,
          },
          include: {
            parameter: {
              select: {
                parameterId: true,
                name: true,
                definition: true,
                interpretationHigh: true,
                interpretationLow: true,
                domainGroup: true,
              },
            },
          },
        }),
        // PLAYBOOK level targets (from published playbook for caller's domain)
        publishedPlaybook?.id
          ? prisma.behaviorTarget.findMany({
              where: {
                scope: "PLAYBOOK",
                playbookId: publishedPlaybook.id,
                effectiveUntil: null,
              },
              include: {
                parameter: {
                  select: {
                    parameterId: true,
                    name: true,
                    definition: true,
                    interpretationHigh: true,
                    interpretationLow: true,
                    domainGroup: true,
                  },
                },
                playbook: { select: { id: true, name: true } },
              },
            })
          : Promise.resolve([]),
        // SEGMENT level targets
        callerIdentity?.segmentId
          ? prisma.behaviorTarget.findMany({
              where: {
                scope: "SEGMENT",
                segmentId: callerIdentity.segmentId,
                effectiveUntil: null,
              },
              include: {
                parameter: {
                  select: {
                    parameterId: true,
                    name: true,
                    definition: true,
                    interpretationHigh: true,
                    interpretationLow: true,
                    domainGroup: true,
                  },
                },
                segment: { select: { id: true, name: true } },
              },
            })
          : Promise.resolve([]),
        // CALLER level targets
        callerIdentity?.id
          ? prisma.behaviorTarget.findMany({
              where: {
                scope: "CALLER",
                callerIdentityId: callerIdentity.id,
                effectiveUntil: null,
              },
              include: {
                parameter: {
                  select: {
                    parameterId: true,
                    name: true,
                    definition: true,
                    interpretationHigh: true,
                    interpretationLow: true,
                    domainGroup: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      // Merge targets with cascade (lower levels override higher)
      const targetMap = new Map<string, any>();

      // Layer 1: SYSTEM (base)
      for (const t of systemTargets) {
        targetMap.set(t.parameterId, {
          parameterId: t.parameterId,
          parameter: t.parameter,
          targetValue: t.targetValue,
          confidence: t.confidence,
          source: t.source,
          effectiveScope: "SYSTEM",
          layers: [{ scope: "SYSTEM", value: t.targetValue, source: t.source }],
        });
      }

      // Layer 2: PLAYBOOK (overrides SYSTEM)
      for (const t of playbookTargets) {
        const existing = targetMap.get(t.parameterId);
        if (existing) {
          existing.layers.push({
            scope: "PLAYBOOK",
            value: t.targetValue,
            source: t.source,
            playbookName: t.playbook?.name,
          });
          existing.targetValue = t.targetValue;
          existing.confidence = t.confidence;
          existing.source = t.source;
          existing.effectiveScope = "PLAYBOOK";
        } else {
          targetMap.set(t.parameterId, {
            parameterId: t.parameterId,
            parameter: t.parameter,
            targetValue: t.targetValue,
            confidence: t.confidence,
            source: t.source,
            effectiveScope: "PLAYBOOK",
            layers: [{ scope: "PLAYBOOK", value: t.targetValue, source: t.source, playbookName: t.playbook?.name }],
          });
        }
      }

      // Layer 3: SEGMENT (overrides PLAYBOOK)
      for (const t of segmentTargets) {
        const existing = targetMap.get(t.parameterId);
        if (existing) {
          existing.layers.push({
            scope: "SEGMENT",
            value: t.targetValue,
            source: t.source,
            segmentName: t.segment?.name,
          });
          existing.targetValue = t.targetValue;
          existing.confidence = t.confidence;
          existing.source = t.source;
          existing.effectiveScope = "SEGMENT";
        } else {
          targetMap.set(t.parameterId, {
            parameterId: t.parameterId,
            parameter: t.parameter,
            targetValue: t.targetValue,
            confidence: t.confidence,
            source: t.source,
            effectiveScope: "SEGMENT",
            layers: [{ scope: "SEGMENT", value: t.targetValue, source: t.source, segmentName: t.segment?.name }],
          });
        }
      }

      // Layer 4: CALLER (overrides all)
      for (const t of callerTargets) {
        const existing = targetMap.get(t.parameterId);
        if (existing) {
          existing.layers.push({
            scope: "CALLER",
            value: t.targetValue,
            source: t.source,
          });
          existing.targetValue = t.targetValue;
          existing.confidence = t.confidence;
          existing.source = t.source;
          existing.effectiveScope = "CALLER";
        } else {
          targetMap.set(t.parameterId, {
            parameterId: t.parameterId,
            parameter: t.parameter,
            targetValue: t.targetValue,
            confidence: t.confidence,
            source: t.source,
            effectiveScope: "CALLER",
            layers: [{ scope: "CALLER", value: t.targetValue, source: t.source }],
          });
        }
      }

      effectiveTargets = Array.from(targetMap.values());

      // Add measurement comparison if available
      const measurementMap = new Map(measurements.map((m: any) => [m.parameterId, m.actualValue]));
      for (const target of effectiveTargets) {
        const measured = measurementMap.get(target.parameterId);
        if (measured !== undefined) {
          target.actualValue = measured;
          target.delta = measured - target.targetValue;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      call,
      scores,
      memories,
      measurements,
      rewardScore,
      triggeredPrompts,
      personalityObservation,
      effectiveTargets,
      counts: {
        scores: scores.length,
        memories: memories.length,
        measurements: measurements.length,
        prompts: triggeredPrompts.length,
        targets: effectiveTargets.length,
      },
    });
  } catch (error: any) {
    console.error("Error fetching call:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch call" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/calls/:callId
 * @visibility public
 * @scope calls:write
 * @auth session
 * @tags calls
 * @description Update call data (e.g., transcript or summary after AI simulation). Only provided fields are updated.
 * @pathParam callId string - The call ID to update
 * @body transcript string - Updated call transcript (optional)
 * @body summary string - Updated call summary (optional)
 * @response 200 { ok: true, call: Call }
 * @response 404 { ok: false, error: "Call not found" }
 * @response 500 { ok: false, error: "Failed to update call" }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callId } = await params;
    const body = await request.json();
    const { transcript, summary, endedAt } = body;

    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { id: true, callerId: true },
    });

    if (!call) {
      return NextResponse.json(
        { ok: false, error: "Call not found" },
        { status: 404 }
      );
    }

    const updateData: any = {};
    if (transcript !== undefined) updateData.transcript = transcript;
    if (summary !== undefined) updateData.summary = summary;
    if (endedAt !== undefined) updateData.endedAt = new Date(endedAt);

    const updated = await prisma.call.update({
      where: { id: callId },
      data: updateData,
    });

    return NextResponse.json({
      ok: true,
      call: updated,
    });
  } catch (error: any) {
    console.error("Error updating call:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update call" },
      { status: 500 }
    );
  }
}

// advanceSessionEagerly deleted — scheduler replaces session tracking.
// See ADR: docs/decisions/2026-04-14-outcome-graph-pacing.md
