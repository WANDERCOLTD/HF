import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { composeContentSection } from "@/lib/prompt/compose-content-section";
import { getLearnerProfile } from "@/lib/learner/profile";
import { requireEntityAccess, isEntityAuthError } from "@/lib/access-control";
import { deleteCallerData } from "@/lib/gdpr/delete-caller-data";
import { auditLog, AuditAction } from "@/lib/audit";
import type { CallerRole } from "@prisma/client";
import type { PlaybookConfig } from "@/lib/types/json-fields";

/**
 * @api GET /api/callers/:callerId
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers
 * @description Get comprehensive caller data including profile, personality, memories, calls, scores, goals, curriculum, and learner profile
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, caller: object, personalityProfile: object, observations: Array, memories: Array, memorySummary: object, calls: Array, identities: Array, scores: Array, callerTargets: Array, curriculum: object, learnerProfile: object, goals: Array, counts: object }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: string }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireEntityAccess("callers", "R");
    if (isEntityAuthError(authResult)) return authResult.error;

    const { callerId } = await params;

    // Fetch all caller data in parallel
    const [caller, personalityProfile, observations, memories, memorySummary, calls, identities, scores, callerTargets, curriculum, learnerProfile, goals] = await Promise.all([
      // Basic caller info
      prisma.caller.findUnique({
        where: { id: callerId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          externalId: true,
          role: true,
          createdAt: true,
          domainId: true,
          cohortGroupId: true,
          archivedAt: true,
          domain: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
          cohortGroup: {
            select: {
              id: true,
              name: true,
              owner: { select: { id: true, name: true } },
            },
          },
          cohortMemberships: {
            select: {
              cohortGroup: {
                select: {
                  id: true,
                  name: true,
                  owner: { select: { id: true, name: true } },
                },
              },
              joinedAt: true,
              role: true,
            },
          },
          ownedCohorts: {
            select: {
              id: true,
              name: true,
              _count: { select: { members: true } },
            },
          },
        },
      }),

      // Personality profile - ALL parameters (not hardcoded)
      // parameterValues contains Big Five, VARK, and all other personality traits
      // Frontend uses registry to determine which params to display
      prisma.callerPersonalityProfile.findUnique({
        where: { callerId: callerId },
        select: {
          parameterValues: true,
          lastUpdatedAt: true,
        },
      }),

      // Personality observations
      // Note: PersonalityObservation table still has hardcoded Big Five fields
      // TODO: Migrate to dynamic storage like CallerPersonalityProfile
      prisma.personalityObservation.findMany({
        where: { callerId: callerId },
        orderBy: { observedAt: "desc" },
        take: 50,
        select: {
          id: true,
          callId: true,
          openness: true,
          conscientiousness: true,
          extraversion: true,
          agreeableness: true,
          neuroticism: true,
          confidence: true,
          observedAt: true,
        },
      }),

      // Active memories (not superseded, not expired), deduplicated by normalizedKey
      prisma.callerMemory.findMany({
        where: {
          callerId: callerId,
          supersededById: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        orderBy: [{ category: "asc" }, { confidence: "desc" }],
        take: 200, // fetch extra to allow dedup
        select: {
          id: true,
          category: true,
          key: true,
          value: true,
          normalizedKey: true,
          evidence: true,
          confidence: true,
          decayFactor: true,
          extractedAt: true,
          expiresAt: true,
        },
      }).then(raw => {
        // Deduplicate by normalizedKey — keep highest confidence per key
        const seen = new Map<string, typeof raw[0]>();
        for (const m of raw) {
          const dedup = m.normalizedKey || m.key;
          const existing = seen.get(dedup);
          if (!existing || (m.confidence ?? 0) > (existing.confidence ?? 0)) {
            seen.set(dedup, m);
          }
        }
        return Array.from(seen.values()).slice(0, 100);
      }),

      // Memory summary
      prisma.callerMemorySummary.findUnique({
        where: { callerId: callerId },
        select: {
          factCount: true,
          preferenceCount: true,
          eventCount: true,
          topicCount: true,
          keyFacts: true,
          preferences: true,
          topTopics: true,
        },
      }),

      // Calls with analysis status
      prisma.call.findMany({
        where: { callerId: callerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          source: true,
          externalId: true,
          transcript: true,
          createdAt: true,
          endedAt: true,
          callSequence: true,
          curriculumModuleId: true,
          curriculumModule: {
            select: { slug: true, title: true },
          },
          _count: {
            select: {
              scores: true,
              behaviorMeasurements: true,
            },
          },
          rewardScore: {
            select: { id: true },
          },
        },
      }),

      // Caller identities (phone numbers, external IDs, etc.)
      prisma.callerIdentity.findMany({
        where: { callerId: callerId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          externalId: true,
          nextPrompt: true,
          nextPromptComposedAt: true,
          nextPromptInputs: true,
          segmentId: true,
          segment: {
            select: { name: true },
          },
        },
      }),

      // Call scores
      prisma.callScore.findMany({
        where: {
          call: { callerId: callerId },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          callId: true,
          parameterId: true,
          score: true,
          confidence: true,
          evidence: true,
          reasoning: true,
          scoredBy: true,
          scoredAt: true,
          analysisSpecId: true,
          createdAt: true,
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
              outputType: true,
            },
          },
          call: {
            select: {
              createdAt: true,
            },
          },
        },
      }),

      // CallerTargets - personalized behavior targets computed by ADAPT specs
      prisma.callerTarget.findMany({
        where: { callerId: callerId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          parameterId: true,
          targetValue: true,
          callsUsed: true,
          confidence: true,
          decayHalfLife: true,
          lastUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
          parameter: {
            select: {
              name: true,
              definition: true,
              interpretationLow: true,
              interpretationHigh: true,
              domainGroup: true,
            },
          },
        },
      }),

      // Curriculum progress - loads from CONTENT specs using contract-based system
      (async () => {
        try {
          // First fetch caller to get domain
          const callerData = await prisma.caller.findUnique({
            where: { id: callerId },
            select: {
              domain: {
                select: { name: true }
              }
            },
          });

          if (callerData?.domain?.name) {
            return await composeContentSection(callerId, callerData.domain.name);
          }
          return null;
        } catch (error) {
          console.error('[caller-api] Failed to load curriculum:', error);
          return null;
        }
      })(),

      // Learner profile - inferred learning preferences from behavior
      (async () => {
        try {
          return await getLearnerProfile(callerId);
        } catch (error) {
          console.error('[caller-api] Failed to load learner profile:', error);
          return null;
        }
      })(),

      // Goals for this caller
      prisma.goal.findMany({
        where: { callerId },
        include: {
          playbook: {
            select: { id: true, name: true, version: true },
          },
          contentSpec: {
            select: { id: true, slug: true, name: true },
          },
        },
        orderBy: [
          { status: 'asc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
    ]);

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Get counts
    const [callCount, memoryCount, observationCount, measurementsCount, artifactCount, actionsPendingCount, keyFactCount] = await Promise.all([
      prisma.call.count({ where: { callerId: callerId } }),
      prisma.callerMemory.count({
        where: {
          callerId: callerId,
          supersededById: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      }),
      prisma.personalityObservation.count({ where: { callerId: callerId } }),
      prisma.behaviorMeasurement.findMany({
        where: {
          call: { callerId: callerId },
        },
        distinct: ['parameterId'],
        select: { parameterId: true },
      }).then(results => results.length),
      prisma.conversationArtifact.count({ where: { callerId: callerId } }),
      prisma.callAction.count({ where: { callerId: callerId, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
      prisma.conversationArtifact.count({ where: { callerId: callerId, type: "KEY_FACT" } }),
    ]);

    // Get behavior targets count for this caller
    // First get caller's identity and find the published playbook for their domain
    const [callerIdentity, publishedPlaybook] = await Promise.all([
      prisma.callerIdentity.findFirst({
        where: { callerId: callerId },
        select: {
          id: true,
          segmentId: true,
        },
      }),
      // Find the published playbook for the caller's domain with its templates
      caller.domainId
        ? prisma.playbook.findFirst({
            where: {
              domainId: caller.domainId,
              status: "PUBLISHED",
            },
            select: {
              id: true,
              items: {
                where: { isEnabled: true, itemType: "PROMPT_TEMPLATE" },
                select: {
                  promptTemplate: {
                    select: {
                      slug: true,
                      name: true,
                      systemPrompt: true,
                      contextTemplate: true,
                    },
                  },
                },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    // Count targets at various levels (SYSTEM is always available)
    let targetsCount = 0;
    const [systemTargets, segmentTargets, callerScopeTargets, playbookTargets] = await Promise.all([
      prisma.behaviorTarget.count({
        where: { scope: "SYSTEM", effectiveUntil: null },
      }),
      callerIdentity?.segmentId
        ? prisma.behaviorTarget.count({
            where: { scope: "SEGMENT", segmentId: callerIdentity.segmentId, effectiveUntil: null },
          })
        : Promise.resolve(0),
      callerIdentity?.id
        ? prisma.behaviorTarget.count({
            where: { scope: "CALLER", callerIdentityId: callerIdentity.id, effectiveUntil: null },
          })
        : Promise.resolve(0),
      // Use the published playbook from the caller's domain for PLAYBOOK scope
      publishedPlaybook?.id
        ? prisma.behaviorTarget.count({
            where: { scope: "PLAYBOOK", playbookId: publishedPlaybook.id, effectiveUntil: null },
          })
        : Promise.resolve(0),
    ]);
    targetsCount = systemTargets + segmentTargets + callerScopeTargets + playbookTargets;

    // Get memory counts per call for status
    const memoryCountsByCall = await prisma.callerMemory.groupBy({
      by: ["callId"],
      where: {
        callerId: callerId,
        supersededById: null,
        callId: { not: null },
      },
      _count: { id: true },
    });
    const memoryCountMap = new Map(
      memoryCountsByCall.map((m) => [m.callId, m._count.id])
    );

    // Get prompt status per call (which calls triggered a prompt)
    const promptsByCall = await prisma.composedPrompt.findMany({
      where: {
        callerId: callerId,
        triggerCallId: { not: null },
      },
      select: {
        triggerCallId: true,
      },
    });
    const promptedCallIds = new Set(promptsByCall.map((p) => p.triggerCallId));

    // Transform calls to include analysis status
    const callsWithStatus = calls.map((call) => ({
      id: call.id,
      source: call.source,
      externalId: call.externalId,
      transcript: call.transcript,
      createdAt: call.createdAt,
      callSequence: call.callSequence,
      // Analysis status flags
      hasScores: call._count.scores > 0,
      hasMemories: (memoryCountMap.get(call.id) || 0) > 0,
      hasBehaviorMeasurements: call._count.behaviorMeasurements > 0,
      hasRewardScore: !!call.rewardScore,
      // Prompt status
      hasPrompt: promptedCallIds.has(call.id),
      // Module context
      curriculumModuleId: call.curriculumModuleId || null,
      curriculumModule: call.curriculumModule || null,
    }));

    // Extract available slug variable names from playbook templates
    const availableSlugNames = new Set<string>();
    if (publishedPlaybook?.items) {
      // Regex to match {slug.variable_name} patterns
      const slugPattern = /\{slug\.([a-zA-Z0-9_]+)\}/g;

      for (const item of publishedPlaybook.items) {
        if (item.promptTemplate) {
          const templates = [
            item.promptTemplate.systemPrompt,
            item.promptTemplate.contextTemplate,
          ].filter(Boolean);

          for (const template of templates) {
            let match;
            while ((match = slugPattern.exec(template as string)) !== null) {
              availableSlugNames.add(match[1]);
            }
          }
        }
      }
    }

    // Enrich assessment target goals with pending completion signals
    const assessmentGoalIds = goals.filter((g: any) => g.isAssessmentTarget).map((g: any) => g.id);
    const pendingSignals = assessmentGoalIds.length > 0
      ? await prisma.callerAttribute.findMany({
          where: {
            callerId,
            scope: "GOAL_EVENT",
            key: { in: assessmentGoalIds.map((id: string) => `goal_completion_signal:${id}`) },
            booleanValue: null, // pending only
          },
          select: { id: true, key: true, textValue: true, createdAt: true },
        })
      : [];
    const signalByGoalId = new Map(
      pendingSignals.map((s: any) => [s.key.replace("goal_completion_signal:", ""), s])
    );
    const goalsWithSignals = goals.map((g: any) => {
      const signal = signalByGoalId.get(g.id);
      return signal
        ? { ...g, pendingSignal: { id: signal.id, evidence: signal.textValue, createdAt: signal.createdAt } }
        : g;
    });

    return NextResponse.json({
      ok: true,
      caller: {
        ...caller,
        personalityProfile,
        _count: {
          calls: callCount,
          memories: memoryCount,
          personalityObservations: observationCount,
        },
      },
      personalityProfile,
      observations,
      memories,
      memorySummary,
      calls: callsWithStatus,
      identities,
      scores,
      callerTargets,
      curriculum,
      learnerProfile,
      goals: goalsWithSignals,
      publishedPlaybookId: publishedPlaybook?.id ?? null,
      availableSlugNames: Array.from(availableSlugNames).sort(),
      counts: {
        calls: callCount,
        memories: memoryCount,
        observations: observationCount,
        prompts: promptedCallIds.size,
        targets: targetsCount,
        callerTargets: callerTargets.length,
        measurements: measurementsCount,
        artifacts: artifactCount,
        actions: actionsPendingCount,
        curriculumModules: curriculum?.totalModules || 0,
        curriculumCompleted: curriculum?.completedCount || 0,
        goals: goals.length,
        activeGoals: goals.filter(g => g.status === 'ACTIVE').length,
        keyFacts: keyFactCount,
      },
    });
  } catch (error: any) {
    console.error("Error fetching caller:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch caller" },
      { status: 500 }
    );
  }
}

/**
 * @api PATCH /api/callers/:callerId
 * @visibility public
 * @scope callers:write
 * @auth session
 * @tags callers
 * @description Update caller profile fields. Domain changes trigger goal archival and new goal creation from playbook.
 * @pathParam callerId string - The caller ID
 * @body name string - Caller display name
 * @body email string - Caller email
 * @body phone string - Caller phone number
 * @body domainId string - New domain ID (triggers domain switch if different)
 * @body role string - Caller role (LEARNER, TEACHER, TUTOR, PARENT, MENTOR)
 * @body archive boolean - Set true to archive, false to unarchive
 * @response 200 { ok: true, caller: object, goalsCreated?: string[] }
 * @response 400 { ok: false, error: "Domain not found" }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: string }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireEntityAccess("callers", "U");
    if (isEntityAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const body = await req.json();

    // Allowed fields to update
    const { name, email, phone, domainId, role, archive } = body;

    // Check if domain is changing (for domain-switch logic)
    const currentCaller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: { domainId: true, domainSwitchCount: true },
    });

    if (!currentCaller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    const isDomainSwitch = domainId !== undefined && domainId !== currentCaller.domainId;

    // Build update data
    const updateData: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      role?: CallerRole;
      domainId?: string | null;
      previousDomainId?: string | null;
      domainSwitchCount?: number;
      archivedAt?: Date | null;
    } = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (domainId !== undefined) updateData.domainId = domainId;
    if (archive !== undefined) updateData.archivedAt = archive ? new Date() : null;

    // Track domain switches
    if (isDomainSwitch) {
      updateData.previousDomainId = currentCaller.domainId;
      updateData.domainSwitchCount = (currentCaller.domainSwitchCount || 0) + 1;
      console.log(`[caller-api] Domain switch detected: ${currentCaller.domainId} → ${domainId} (switch #${updateData.domainSwitchCount})`);
    }

    // If domainId provided, verify it exists
    if (domainId) {
      const domain = await prisma.domain.findUnique({
        where: { id: domainId },
      });
      if (!domain) {
        return NextResponse.json(
          { ok: false, error: "Domain not found" },
          { status: 400 }
        );
      }
    }

    const updatedCaller = await prisma.caller.update({
      where: { id: callerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        externalId: true,
        role: true,
        createdAt: true,
        domainId: true,
        previousDomainId: true,
        domainSwitchCount: true,
        archivedAt: true,
        domain: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
      },
      data: updateData,
    });

    // If domain was changed, instantiate goals from playbook and create OnboardingSession
    const goalsCreated: string[] = [];
    if (isDomainSwitch && domainId) {
      // Archive old goals (don't delete, preserve history)
      await prisma.goal.updateMany({
        where: {
          callerId,
          status: { in: ['ACTIVE', 'PAUSED'] },
        },
        data: { status: 'ARCHIVED' },
      });

      // Create OnboardingSession for new domain (for re-onboarding tracking)
      await prisma.onboardingSession.upsert({
        where: {
          callerId_domainId: {
            callerId,
            domainId,
          },
        },
        create: {
          callerId,
          domainId,
          isComplete: false,
          wasSkipped: false,
          discoveredGoals: 0,
        },
        update: {
          // If session exists, reset it for re-onboarding
          isComplete: false,
          wasSkipped: false,
          currentPhase: null,
          completedAt: null,
        },
      });
      console.log(`[caller-api] Created OnboardingSession for domain switch to ${domainId}`);

      // Find published playbook for new domain
      const playbook = await prisma.playbook.findFirst({
        where: {
          domainId,
          status: 'PUBLISHED',
        },
        select: {
          id: true,
          name: true,
          config: true,
        },
      });

      if (playbook?.config) {
        const config = playbook.config as PlaybookConfig;
        const goals = config.goals || [];

        // Create goal instances for caller
        for (const goalConfig of goals) {
          // Find contentSpec if it's a LEARN goal
          let contentSpecId = null;
          if (goalConfig.type === 'LEARN' && goalConfig.contentSpecSlug) {
            const contentSpec = await prisma.analysisSpec.findFirst({
              where: {
                slug: { contains: goalConfig.contentSpecSlug.toLowerCase().replace(/_/g, '-') },
                isActive: true,
              },
              select: { id: true },
            });
            contentSpecId = contentSpec?.id || null;
          }

          // Create goal
          const goal = await prisma.goal.create({
            data: {
              callerId,
              playbookId: playbook.id,
              type: goalConfig.type,
              name: goalConfig.name,
              description: goalConfig.description || null,
              contentSpecId,
              isAssessmentTarget: goalConfig.isAssessmentTarget || false,
              assessmentConfig: goalConfig.assessmentConfig || undefined,
              status: 'ACTIVE',
              priority: goalConfig.priority || 5,
              startedAt: new Date(),
            },
          });

          goalsCreated.push(goal.name);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      caller: updatedCaller,
      goalsCreated: goalsCreated.length > 0 ? goalsCreated : undefined,
    });
  } catch (error: any) {
    console.error("Error updating caller:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to update caller" },
      { status: 500 }
    );
  }
}

/**
 * @api DELETE /api/callers/:callerId
 * @visibility public
 * @scope callers:delete
 * @auth session
 * @tags callers
 * @description Delete a caller and all associated data. Optionally exclude their identifiers from future imports.
 * @pathParam callerId string - The caller ID to delete
 * @body exclude boolean - Add phone/externalId to ExcludedCaller table (default: false)
 * @response 200 { ok: true, message: string, excluded: boolean }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: string }
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ callerId: string }> }
) {
  try {
    const authResult = await requireEntityAccess("callers", "D");
    if (isEntityAuthError(authResult)) return authResult.error;

    const { callerId } = await params;
    const body = await req.json().catch(() => ({}));
    const { exclude = false } = body;

    // Find the caller first
    const caller = await prisma.caller.findUnique({
      where: { id: callerId },
      select: {
        id: true,
        name: true,
        phone: true,
        externalId: true,
      },
    });

    if (!caller) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // If exclude option is set, add to ExcludedCaller table
    if (exclude && (caller.phone || caller.externalId)) {
      // Create exclusion record(s)
      if (caller.phone) {
        await prisma.excludedCaller.upsert({
          where: { phone: caller.phone },
          create: {
            phone: caller.phone,
            reason: `Deleted caller: ${caller.name || caller.phone}`,
          },
          update: {
            reason: `Deleted caller: ${caller.name || caller.phone}`,
          },
        });
      }
      if (caller.externalId) {
        await prisma.excludedCaller.upsert({
          where: { externalId: caller.externalId },
          create: {
            externalId: caller.externalId,
            reason: `Deleted caller: ${caller.name || caller.externalId}`,
          },
          update: {
            reason: `Deleted caller: ${caller.name || caller.externalId}`,
          },
        });
      }
    }

    // Delete all related records via shared utility
    const deletionCounts = await deleteCallerData(callerId);
    const excluded = exclude && !!(caller.phone || caller.externalId);

    // Audit trail (non-blocking, non-throwing)
    auditLog({
      userId: authResult.session.user.id,
      userEmail: authResult.session.user.email,
      action: AuditAction.DELETED_CALLER,
      entityType: "Caller",
      entityId: callerId,
      metadata: { excluded, deletionCounts },
    });

    return NextResponse.json({
      ok: true,
      message: `Deleted caller ${caller.name || caller.phone || callerId}`,
      excluded,
    });
  } catch (error: any) {
    console.error("Error deleting caller:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to delete caller" },
      { status: 500 }
    );
  }
}
