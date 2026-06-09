import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

/**
 * @api POST /api/callers/merge
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers, merge
 * @description Merge multiple source callers into a single target caller. Moves all data (calls, memories, observations, scores, identities, composed prompts, slug selections) from source callers to the target. Handles unique constraints by merging personality, personality profiles, memory summaries, caller targets, and caller attributes using weighted averages. Re-sequences calls chronologically. Deletes source callers after merge.
 * @body targetCallerId string - The caller ID that will receive all merged data (required)
 * @body sourceCallerIds string[] - Array of caller IDs to merge from; these callers will be deleted (required, at least one)
 * @response 200 { ok: true, message: string, merged: { calls, memories, observations, scores, identities, composedPrompts, callerTargets, attributes, promptSlugSelections, personality, personalityProfile, memorySummary }, deletedCallers: number, targetCaller: { id, name, email } }
 * @response 400 { ok: false, error: "Target caller ID required" }
 * @response 400 { ok: false, error: "At least one source caller required" }
 * @response 400 { ok: false, error: "Target caller cannot be in source list" }
 * @response 404 { ok: false, error: "Callers not found: ..." }
 * @response 500 { ok: false, error: "Failed to merge callers" }
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { targetCallerId, sourceCallerIds } = await req.json();

    // Validation
    if (!targetCallerId || typeof targetCallerId !== "string") {
      return NextResponse.json(
        { ok: false, error: "Target caller ID required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(sourceCallerIds) || sourceCallerIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one source caller required" },
        { status: 400 }
      );
    }

    if (sourceCallerIds.includes(targetCallerId)) {
      return NextResponse.json(
        { ok: false, error: "Target caller cannot be in source list" },
        { status: 400 }
      );
    }

    // Verify all callers exist
    const allCallerIds = [targetCallerId, ...sourceCallerIds];
    const existingCallers = await prisma.caller.findMany({
      where: { id: { in: allCallerIds } },
      select: {
        id: true,
        name: true,
        email: true,
        externalId: true,
        _count: {
          select: {
            calls: true,
            memories: true,
            personalityObservations: true,
          },
        },
      },
    });

    if (existingCallers.length !== allCallerIds.length) {
      const foundIds = existingCallers.map((c) => c.id);
      const missing = allCallerIds.filter((id) => !foundIds.includes(id));
      return NextResponse.json(
        { ok: false, error: `Callers not found: ${missing.join(", ")}` },
        { status: 404 }
      );
    }

    const targetCaller = existingCallers.find((c) => c.id === targetCallerId)!;
    const sourceCallersData = existingCallers.filter((c) =>
      sourceCallerIds.includes(c.id)
    );

    // Clear externalId on sources that have one (to avoid unique constraint violation)
    const sourcesWithExternalId = sourceCallersData.filter((c) => c.externalId);

    const result = await prisma.$transaction(async (tx) => {
      const counts = {
        calls: 0,
        memories: 0,
        observations: 0,
        scores: 0,
        identities: 0,
        composedPrompts: 0,
        callerTargets: 0,
        attributes: 0,
        promptSlugSelections: 0,
        personality: false,
        personalityProfile: false,
        memorySummary: false,
      };

      // Clear externalId on source callers to avoid unique constraint issues
      if (sourcesWithExternalId.length > 0) {
        await tx.caller.updateMany({
          where: { id: { in: sourcesWithExternalId.map((c) => c.id) } },
          data: { externalId: null },
        });
      }

      // === 1. MOVE SIMPLE FK RELATIONS ===

      // Move calls
      counts.calls = (
        await tx.call.updateMany({
          where: { callerId: { in: sourceCallerIds } },
          data: { callerId: targetCallerId },
        })
      ).count;

      // Move memories
      counts.memories = (
        await tx.callerMemory.updateMany({
          where: { callerId: { in: sourceCallerIds } },
          data: { callerId: targetCallerId },
        })
      ).count;

      // Move personality observations
      counts.observations = (
        await tx.personalityObservation.updateMany({
          where: { callerId: { in: sourceCallerIds } },
          data: { callerId: targetCallerId },
        })
      ).count;

      // Move call scores
      counts.scores = (
        await tx.callScore.updateMany({
          where: { callerId: { in: sourceCallerIds } },
          data: { callerId: targetCallerId },
        })
      ).count;

      // Move caller identities
      counts.identities = (
        await tx.callerIdentity.updateMany({
          where: { callerId: { in: sourceCallerIds } },
          data: { callerId: targetCallerId },
        })
      ).count;

      // Move composed prompts
      counts.composedPrompts = (
        await tx.composedPrompt.updateMany({
          where: { callerId: { in: sourceCallerIds } },
          data: { callerId: targetCallerId },
        })
      ).count;

      // Move prompt slug selections
      counts.promptSlugSelections = (
        await tx.promptSlugSelection.updateMany({
          where: { callerId: { in: sourceCallerIds } },
          data: { callerId: targetCallerId },
        })
      ).count;

      // === 2. HANDLE UNIQUE CONSTRAINTS ===

      // --- CallerPersonality ---
      const targetPersonality = await tx.callerPersonality.findUnique({
        where: { callerId: targetCallerId },
      });
      const sourcePersonalities = await tx.callerPersonality.findMany({
        where: { callerId: { in: sourceCallerIds } },
      });

      if (sourcePersonalities.length > 0) {
        if (targetPersonality) {
          // Merge using weighted average
          const allPersonalities = [targetPersonality, ...sourcePersonalities];
          const totalObs = allPersonalities.reduce(
            (sum, p) => sum + (p.observationsUsed || 1),
            0
          );

          const weightedAvg = (field: keyof typeof targetPersonality) => {
            let sum = 0;
            let weight = 0;
            for (const p of allPersonalities) {
              const val = p[field];
              if (typeof val === "number" && val !== null) {
                const w = p.observationsUsed || 1;
                sum += val * w;
                weight += w;
              }
            }
            return weight > 0 ? sum / weight : null;
          };

          await tx.callerPersonality.update({
            where: { callerId: targetCallerId },
            data: {
              openness: weightedAvg("openness"),
              conscientiousness: weightedAvg("conscientiousness"),
              extraversion: weightedAvg("extraversion"),
              agreeableness: weightedAvg("agreeableness"),
              neuroticism: weightedAvg("neuroticism"),
              confidenceScore: weightedAvg("confidenceScore"),
              observationsUsed: totalObs,
              lastAggregatedAt: new Date(),
            },
          });
        } else {
          // No target personality - move the first source's and delete rest
          const [first, ...rest] = sourcePersonalities;
          await tx.callerPersonality.update({
            where: { id: first.id },
            data: { callerId: targetCallerId },
          });
          if (rest.length > 0) {
            await tx.callerPersonality.deleteMany({
              where: { id: { in: rest.map((p) => p.id) } },
            });
          }
        }
        // Delete remaining source personalities
        await tx.callerPersonality.deleteMany({
          where: { callerId: { in: sourceCallerIds } },
        });
        counts.personality = true;
      }

      // --- CallerPersonalityProfile ---
      const targetProfile = await tx.callerPersonalityProfile.findUnique({
        where: { callerId: targetCallerId },
      });
      const sourceProfiles = await tx.callerPersonalityProfile.findMany({
        where: { callerId: { in: sourceCallerIds } },
      });

      if (sourceProfiles.length > 0) {
        if (targetProfile) {
          // Merge parameterValues JSON
          let mergedValues =
            (targetProfile.parameterValues as Record<string, unknown>) || {};
          let totalCalls = targetProfile.callsUsed || 0;
          let totalSpecs = targetProfile.specsUsed || 0;

          for (const sp of sourceProfiles) {
            const vals = (sp.parameterValues as Record<string, unknown>) || {};
            mergedValues = { ...mergedValues, ...vals };
            totalCalls += sp.callsUsed || 0;
            totalSpecs += sp.specsUsed || 0;
          }

          await tx.callerPersonalityProfile.update({
            where: { callerId: targetCallerId },
            data: {
              parameterValues: mergedValues as any,
              callsUsed: totalCalls,
              specsUsed: totalSpecs,
              lastUpdatedAt: new Date(),
            },
          });
        } else {
          // Move first source profile
          const [first, ...rest] = sourceProfiles;
          await tx.callerPersonalityProfile.update({
            where: { id: first.id },
            data: { callerId: targetCallerId },
          });
          if (rest.length > 0) {
            await tx.callerPersonalityProfile.deleteMany({
              where: { id: { in: rest.map((p) => p.id) } },
            });
          }
        }
        await tx.callerPersonalityProfile.deleteMany({
          where: { callerId: { in: sourceCallerIds } },
        });
        counts.personalityProfile = true;
      }

      // --- CallerMemorySummary ---
      const targetSummary = await tx.callerMemorySummary.findUnique({
        where: { callerId: targetCallerId },
      });
      const sourceSummaries = await tx.callerMemorySummary.findMany({
        where: { callerId: { in: sourceCallerIds } },
      });

      if (sourceSummaries.length > 0) {
        if (targetSummary) {
          // Sum counts and merge arrays
          let factCount = targetSummary.factCount || 0;
          let preferenceCount = targetSummary.preferenceCount || 0;
          let eventCount = targetSummary.eventCount || 0;
          let topicCount = targetSummary.topicCount || 0;
          let keyFacts = (targetSummary.keyFacts as unknown[]) || [];
          let topTopics = (targetSummary.topTopics as unknown[]) || [];
          let preferences =
            (targetSummary.preferences as Record<string, unknown>) || {};

          for (const ss of sourceSummaries) {
            factCount += ss.factCount || 0;
            preferenceCount += ss.preferenceCount || 0;
            eventCount += ss.eventCount || 0;
            topicCount += ss.topicCount || 0;
            keyFacts = [...keyFacts, ...((ss.keyFacts as unknown[]) || [])];
            topTopics = [...topTopics, ...((ss.topTopics as unknown[]) || [])];
            preferences = {
              ...preferences,
              ...((ss.preferences as Record<string, unknown>) || {}),
            };
          }

          await tx.callerMemorySummary.update({
            where: { callerId: targetCallerId },
            data: {
              factCount,
              preferenceCount,
              eventCount,
              topicCount,
              keyFacts: keyFacts as any,
              topTopics: topTopics as any,
              preferences: preferences as any,
              lastAggregatedAt: new Date(),
            },
          });
        } else {
          // Move first source summary
          const [first, ...rest] = sourceSummaries;
          await tx.callerMemorySummary.update({
            where: { id: first.id },
            data: { callerId: targetCallerId },
          });
          if (rest.length > 0) {
            await tx.callerMemorySummary.deleteMany({
              where: { id: { in: rest.map((s) => s.id) } },
            });
          }
        }
        await tx.callerMemorySummary.deleteMany({
          where: { callerId: { in: sourceCallerIds } },
        });
        counts.memorySummary = true;
      }

      // --- CallerTarget (unique on callerId + parameterId) ---
      const targetTargets = await tx.callerTarget.findMany({
        where: { callerId: targetCallerId },
      });
      const sourceTargets = await tx.callerTarget.findMany({
        where: { callerId: { in: sourceCallerIds } },
      });

      if (sourceTargets.length > 0) {
        const targetParamIds = new Set(targetTargets.map((t) => t.parameterId));

        for (const st of sourceTargets) {
          if (targetParamIds.has(st.parameterId)) {
            // Merge with existing - weighted average
            const existing = targetTargets.find(
              (t) => t.parameterId === st.parameterId
            )!;
            const totalCalls =
              (existing.callsUsed || 1) + (st.callsUsed || 1);
            const newValue =
              (existing.targetValue * (existing.callsUsed || 1) +
                st.targetValue * (st.callsUsed || 1)) /
              totalCalls;

            await tx.callerTarget.update({
              where: { id: existing.id },
              data: {
                targetValue: newValue,
                callsUsed: totalCalls,
                lastUpdatedAt: new Date(),
              },
            });
          } else {
            // Move to target
            await tx.callerTarget.update({
              where: { id: st.id },
              data: { callerId: targetCallerId },
            });
            targetParamIds.add(st.parameterId);
          }
        }
        // Delete any remaining source targets
        await tx.callerTarget.deleteMany({
          where: { callerId: { in: sourceCallerIds } },
        });
        counts.callerTargets = sourceTargets.length;
      }

      // --- CallerAttribute (unique on callerId + key + scope + domain) ---
      const targetAttrs = await tx.callerAttribute.findMany({
        where: { callerId: targetCallerId },
      });
      const sourceAttrs = await tx.callerAttribute.findMany({
        where: { callerId: { in: sourceCallerIds } },
      });

      if (sourceAttrs.length > 0) {
        const targetAttrKeys = new Set(
          targetAttrs.map((a) => `${a.key}:${a.scope}:${a.domain || ""}`)
        );

        for (const sa of sourceAttrs) {
          const key = `${sa.key}:${sa.scope}:${sa.domain || ""}`;
          if (targetAttrKeys.has(key)) {
            // Keep target's version (higher confidence or newer)
            // Just delete source
          } else {
            // Move to target
            await tx.callerAttribute.update({
              where: { id: sa.id },
              data: { callerId: targetCallerId },
            });
            targetAttrKeys.add(key);
          }
        }
        await tx.callerAttribute.deleteMany({
          where: { callerId: { in: sourceCallerIds } },
        });
        counts.attributes = sourceAttrs.length;
      }

      // === 3. RE-CHAIN CALLS ===
      // #1344 Slice 4 — `callSequence` column dropped. Session.sequenceNumber
      // is per-(callerId, kind), assigned at session-start by createSession
      // and not safe to renumber here without rewriting the Session rows AND
      // their CallerSequenceCounter. Merge-callers is an admin operation
      // run rarely; downstream consumers tolerate gaps in the merged
      // history because they read createdAt-ordered. Just re-thread the
      // previousCallId chain.
      const allCalls = await tx.call.findMany({
        where: { callerId: targetCallerId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      for (let i = 0; i < allCalls.length; i++) {
        await tx.call.update({
          where: { id: allCalls[i].id },
          data: {
            previousCallId: i > 0 ? allCalls[i - 1].id : null,
          },
        });
      }

      // === 4. DELETE SOURCE CALLERS ===
      // Cascade delete will clean up any remaining references
      await tx.caller.deleteMany({
        where: { id: { in: sourceCallerIds } },
      });

      return counts;
    });

    return NextResponse.json({
      ok: true,
      message: `Successfully merged ${sourceCallerIds.length} caller(s) into ${targetCaller.name || targetCaller.email || targetCallerId}`,
      merged: result,
      deletedCallers: sourceCallerIds.length,
      targetCaller: {
        id: targetCaller.id,
        name: targetCaller.name,
        email: targetCaller.email,
      },
    });
  } catch (error: unknown) {
    console.error("Error merging callers:", error);
    const message =
      error instanceof Error ? error.message : "Failed to merge callers";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
