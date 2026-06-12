import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { studentAllowedToReadCaller, callerScopeMismatchResponse } from "@/lib/learner-scope";

/**
 * @api GET /api/callers/:callerId/snapshot
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, snapshot, export
 * @description Download a complete snapshot of a caller's analysis state as a JSON file attachment. Includes caller profile, personality data (aggregate, profiles, observations), all memories, all call scores, calls with transcripts, caller identities, composed prompts, playbook info, and summary statistics. Useful for comparing analysis results across playbook configurations, archiving before reset, and debugging/auditing.
 * @pathParam callerId string - The caller ID to snapshot
 * @query includeTranscripts boolean - Whether to include call transcripts (default: true, set to "false" to exclude)
 * @query label string - Optional label to include in the snapshot metadata and filename
 * @response 200 application/json attachment: { _meta, summary, caller, personality, memory, calls, identities, composedPrompts }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: "Failed to create snapshot" }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { callerId } = await params;

    // HF-M IDOR (2026-06-12): STUDENT-as-bearer routes that admit STUDENT must reject
    // a foreign callerId — without this, a STUDENT can read any caller's PII by supplying
    // their callerId in the URL path. See docs/audit/HF-M-evidence-path-param-idor.md.
    if (!studentAllowedToReadCaller(authResult.session, callerId)) {
      return callerScopeMismatchResponse();
    }
    const url = new URL(req.url);
    const includeTranscripts = url.searchParams.get("includeTranscripts") !== "false";
    const label = url.searchParams.get("label") || "";

    // Verify caller exists
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      include: {
        domain: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Fetch all analysis data in parallel
    const [
      personality,
      personalityProfiles,
      observations,
      memories,
      memorySummary,
      calls,
      scores,
      identities,
      composedPrompts,
    ] = await Promise.all([
      // Personality aggregate
      prisma.callerPersonality.findUnique({
        where: { callerId },
      }),

      // Personality profiles (time-series)
      prisma.callerPersonalityProfile.findMany({
        where: { callerId },
        orderBy: { lastUpdatedAt: "desc" },
      }),

      // Personality observations (per-call)
      prisma.personalityObservation.findMany({
        where: { callerId },
        orderBy: { observedAt: "desc" },
        include: {
          call: {
            select: {
              id: true,
              externalId: true,
              createdAt: true,
            },
          },
        },
      }),

      // All memories (including superseded for history)
      prisma.callerMemory.findMany({
        where: { callerId },
        orderBy: [{ category: "asc" }, { extractedAt: "desc" }],
        include: {
          call: {
            select: {
              id: true,
              externalId: true,
              createdAt: true,
            },
          },
        },
      }),

      // Memory summary
      prisma.callerMemorySummary.findUnique({
        where: { callerId },
      }),

      // Calls
      prisma.call.findMany({
        where: { callerId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          source: true,
          externalId: true,
          createdAt: true,
          // #1344 Slice 4 — `callSequence` gone; walk via Session FK.
          session: { select: { learnerFacingNumber: true } },
          transcript: includeTranscripts,
          _count: {
            select: {
              scores: true,
            },
          },
        },
      }),

      // All scores
      prisma.callScore.findMany({
        where: {
          call: { callerId },
        },
        orderBy: [{ callId: "asc" }, { parameterId: "asc" }],
        include: {
          parameter: {
            select: {
              parameterId: true,
              name: true,
              parameterType: true,
              domainGroup: true,
            },
          },
          analysisSpec: {
            select: {
              slug: true,
              name: true,
              scope: true,
              outputType: true,
            },
          },
          call: {
            select: {
              externalId: true,
              createdAt: true,
              // #1344 Slice 4 — `callSequence` gone; walk via Session FK.
              session: { select: { learnerFacingNumber: true } },
            },
          },
        },
      }),

      // Identities
      prisma.callerIdentity.findMany({
        where: { callerId },
        include: {
          segment: {
            select: { name: true },
          },
        },
      }),

      // Composed prompts
      prisma.composedPrompt.findMany({
        where: { callerId },
        orderBy: { composedAt: "desc" },
        take: 10,
      }),
    ]);

    // Get active playbook info if domain is set
    let playbookInfo = null;
    if (caller.domainId) {
      const playbook = await prisma.playbook.findFirst({
        where: {
          domainId: caller.domainId,
          status: "PUBLISHED",
        },
        include: {
          items: {
            where: { isEnabled: true },
            include: {
              spec: {
                select: {
                  slug: true,
                  name: true,
                  scope: true,
                  outputType: true,
                },
              },
            },
          },
          behaviorTargets: {
            include: {
              parameter: {
                select: {
                  parameterId: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (playbook) {
        playbookInfo = {
          id: playbook.id,
          name: playbook.name,
          version: playbook.version,
          specs: playbook.items
            .filter((i) => i.spec)
            .map((i) => ({
              slug: i.spec!.slug,
              name: i.spec!.name,
              scope: i.spec!.scope,
              outputType: i.spec!.outputType,
            })),
          targets: playbook.behaviorTargets.map((t) => ({
            parameterId: t.parameterId,
            parameterName: t.parameter?.name,
            targetValue: t.targetValue,
          })),
        };
      }
    }

    // Organize scores by call for easier comparison
    const scoresByCall = new Map<string, typeof scores>();
    for (const score of scores) {
      const callId = score.callId;
      if (!scoresByCall.has(callId)) {
        scoresByCall.set(callId, []);
      }
      scoresByCall.get(callId)!.push(score);
    }

    // Build summary statistics
    const summary = {
      callCount: calls.length,
      scoreCount: scores.length,
      memoryCount: memories.filter((m) => !m.supersededById).length,
      observationCount: observations.length,
      uniqueParameters: [...new Set(scores.map((s) => s.parameterId))].length,
      personality: personality
        ? {
            openness: personality.openness,
            conscientiousness: personality.conscientiousness,
            extraversion: personality.extraversion,
            agreeableness: personality.agreeableness,
            neuroticism: personality.neuroticism,
            confidence: personality.confidenceScore,
          }
        : null,
      memoriesByCategory: memories.reduce(
        (acc, m) => {
          if (!m.supersededById) {
            acc[m.category] = (acc[m.category] || 0) + 1;
          }
          return acc;
        },
        {} as Record<string, number>
      ),
      avgScoreByParameter: scores.reduce(
        (acc, s) => {
          if (!acc[s.parameterId]) {
            acc[s.parameterId] = { sum: 0, count: 0, name: s.parameter?.name || s.parameterId };
          }
          acc[s.parameterId].sum += s.score;
          acc[s.parameterId].count += 1;
          return acc;
        },
        {} as Record<string, { sum: number; count: number; name: string }>
      ),
    };

    // Convert avgScoreByParameter to final form
    const avgScores: Record<string, { avg: number; count: number; name: string }> = {};
    for (const [key, val] of Object.entries(summary.avgScoreByParameter)) {
      avgScores[key] = {
        avg: val.sum / val.count,
        count: val.count,
        name: val.name,
      };
    }

    const snapshot = {
      // Metadata
      _meta: {
        version: "1.0",
        snapshotAt: new Date().toISOString(),
        label: label || undefined,
        callerId,
        callerName: caller.name || caller.email || callerId,
        domain: caller.domain?.slug || null,
        playbook: playbookInfo,
      },

      // Summary for quick comparison
      summary: {
        ...summary,
        avgScoreByParameter: avgScores,
      },

      // Core data
      caller: {
        id: caller.id,
        name: caller.name,
        email: caller.email,
        phone: caller.phone,
        externalId: caller.externalId,
        createdAt: caller.createdAt,
        domain: caller.domain,
      },

      // Personality
      personality: {
        aggregate: personality,
        profiles: personalityProfiles,
        observations: observations.map((o) => ({
          ...o,
          call: o.call
            ? {
                id: o.call.id,
                externalId: o.call.externalId,
                createdAt: o.call.createdAt,
              }
            : null,
        })),
      },

      // Memory
      memory: {
        summary: memorySummary,
        items: memories.map((m) => ({
          id: m.id,
          category: m.category,
          key: m.key,
          value: m.value,
          evidence: m.evidence,
          confidence: m.confidence,
          extractedAt: m.extractedAt,
          expiresAt: m.expiresAt,
          supersededById: m.supersededById,
          callId: m.callId,
          callExternalId: m.call?.externalId,
        })),
      },

      // Calls with their scores
      calls: calls.map((call) => ({
        id: call.id,
        source: call.source,
        externalId: call.externalId,
        createdAt: call.createdAt,
        // #1344 Slice 4 — `callSequence` gone; surface from Session.
        callSequence: call.session?.learnerFacingNumber ?? null,
        transcript: (call as any).transcript || undefined,
        scoreCount: call._count?.scores || 0,
        scores: (scoresByCall.get(call.id) || []).map((s) => ({
          parameterId: s.parameterId,
          parameterName: s.parameter?.name,
          parameterType: s.parameter?.parameterType,
          score: s.score,
          confidence: s.confidence,
          evidence: s.evidence,
          reasoning: s.reasoning,
          scoredBy: s.scoredBy,
          scoredAt: s.scoredAt,
          specSlug: s.analysisSpec?.slug,
          specName: s.analysisSpec?.name,
        })),
      })),

      // Identities
      identities: identities.map((i) => ({
        id: i.id,
        name: i.name,
        externalId: i.externalId,
        segmentName: i.segment?.name,
        nextPrompt: i.nextPrompt,
        nextPromptComposedAt: i.nextPromptComposedAt,
      })),

      // Recent composed prompts
      composedPrompts: composedPrompts.map((p) => ({
        id: p.id,
        prompt: p.prompt,
        inputs: p.inputs,
        composedAt: p.composedAt,
      })),
    };

    // Return as downloadable JSON
    const filename = `caller-snapshot-${caller.name || caller.email || callerId}-${new Date().toISOString().split("T")[0]}${label ? `-${label}` : ""}.json`;

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("Error creating snapshot:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create snapshot" },
      { status: 500 }
    );
  }
}
