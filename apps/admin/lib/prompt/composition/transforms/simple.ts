/**
 * Simple Transforms
 * Small helpers that don't warrant their own file.
 * Extracted from route.ts lines 1387-1395, 1727-1744, 1860-1900, 1903-1920
 */

import { registerTransform } from "../TransformRegistry";
import { classifyValue, getAttributeValue } from "../types";
import type { AssembledContext, RecentCallData, CallerAttributeData, GoalData } from "../types";

/**
 * Build call history summary.
 * Extracted from route.ts lines 1387-1395, 1922-1926.
 */
registerTransform("computeCallHistory", (
  rawData: { recentCalls: RecentCallData[]; callCount: number },
  context: AssembledContext,
) => {
  const { recentCalls, callCount } = rawData;
  const { thresholds } = context.sharedState;

  const callHistory = recentCalls.map((call) => ({
    callId: call.id,
    date: call.createdAt.toISOString().split("T")[0],
    scores: call.scores.map((s) => ({
      parameter: s.parameter?.name || s.parameterId,
      score: s.score,
      level: classifyValue(s.score, thresholds),
    })),
  }));

  return {
    totalCalls: callCount,
    mostRecent: callHistory[0] || null,
    recent: callHistory.slice(0, 3),
  };
});

/**
 * Filter session-related attributes.
 * Extracted from route.ts lines 1860-1887.
 */
registerTransform("filterSessionAttributes", (
  rawData: CallerAttributeData[],
  _context: AssembledContext,
) => {
  const attributes = rawData || [];
  const sessionAttrs = attributes.filter(a =>
    a.key.includes("session_") ||
    a.key.includes("arc_") ||
    a.key.includes("continuity") ||
    a.key.includes("thread") ||
    a.sourceSpecSlug?.includes("SESSION")
  );

  return {
    hasData: sessionAttrs.length > 0,
    context: sessionAttrs.map(a => ({
      key: a.key,
      value: getAttributeValue(a),
      confidence: a.confidence,
    })),
  };
});

/**
 * Map learner goals into output format.
 * Extracted from route.ts lines 1889-1900.
 */
registerTransform("mapGoals", (
  rawData: GoalData[],
  _context: AssembledContext,
) => {
  const goals = rawData || [];
  return {
    hasData: goals.length > 0,
    goals: goals.map(g => ({
      type: g.type,
      name: g.name,
      description: g.description,
      status: g.status,
      progress: g.progress,
      priority: g.priority,
      isPlaybookGoal: g.playbookId !== null,
      isAssessmentTarget: g.isAssessmentTarget,
      assessmentConfig: g.assessmentConfig,
    })),
  };
});

/**
 * Compute domain context from caller domain + attributes.
 * Extracted from route.ts lines 1903-1920.
 */
registerTransform("computeDomainContext", (
  rawData: { callerDomain: any; callerAttributes: CallerAttributeData[] },
  _context: AssembledContext,
) => {
  const callerDomain = rawData.callerDomain;
  const callerAttributes = rawData.callerAttributes || [];

  if (!callerDomain) return null;

  return {
    name: callerDomain.name,
    description: callerDomain.description,
    domainSpecificData: callerAttributes
      .filter(a => a.scope === "DOMAIN" && a.domain === callerDomain.name)
      .map(a => ({
        key: a.key,
        value: getAttributeValue(a),
      })),
  };
});

/**
 * Pass through learner profile (with null check).
 * Extracted from route.ts lines 1727-1744.
 */
registerTransform("mapLearnerProfile", (
  rawData: any,
  _context: AssembledContext,
) => {
  const lp = rawData;
  if (!lp) return null;

  const hasAnyData =
    lp.learningStyle ||
    lp.pacePreference ||
    lp.interactionStyle ||
    lp.preferredModality ||
    lp.questionFrequency ||
    lp.feedbackStyle ||
    Object.keys(lp.priorKnowledge || {}).length > 0;

  if (!hasAnyData) return null;

  return {
    learningStyle: lp.learningStyle,
    pacePreference: lp.pacePreference,
    interactionStyle: lp.interactionStyle,
    preferredModality: lp.preferredModality,
    questionFrequency: lp.questionFrequency,
    feedbackStyle: lp.feedbackStyle,
    priorKnowledge: lp.priorKnowledge || {},
    lastUpdated: lp.lastUpdated,
  };
});
