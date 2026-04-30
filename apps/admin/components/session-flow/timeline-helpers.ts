/**
 * Pure helpers for SessionFlowTimeline rendering. Extracted so they can
 * be unit-tested without a React renderer (the project has no
 * @testing-library setup yet).
 *
 * @see SessionFlowTimeline.tsx
 */

import type { JourneyStop, JourneyStopTrigger, SessionFlowResolved } from "@/lib/types/json-fields";

export function sourceLabel(src: SessionFlowResolved["source"]["onboarding"]): string {
  switch (src) {
    case "new-shape": return "course (sessionFlow)";
    case "playbook-legacy": return "course (legacy)";
    case "domain": return "domain default";
    case "init001": return "system default";
  }
}

export function kcSummary(kc: SessionFlowResolved["intake"]["knowledgeCheck"]): string {
  if (!kc.enabled) return "Disabled — no probe, no MCQ";
  const mode = kc.deliveryMode ?? "mcq";
  return mode === "mcq"
    ? "MCQ batch fires after Call 1"
    : "Socratic probe inside first call";
}

export function isPreTest(s: JourneyStop): boolean {
  return s.kind === "assessment" && triggerKind(s.trigger) === "pre";
}

export function isMidTest(s: JourneyStop): boolean {
  return s.kind === "assessment" && triggerKind(s.trigger) === "mid";
}

export function isPostTest(s: JourneyStop): boolean {
  return s.kind === "assessment" && triggerKind(s.trigger) === "post";
}

export function triggerKind(t: JourneyStopTrigger): "pre" | "mid" | "post" | "other" {
  if (t.type === "after_session" && t.index === 1) return "pre";
  if (t.type === "midpoint") return "mid";
  if (t.type === "course_complete") return "post";
  return "other";
}

export function stopSummary(stop: JourneyStop): string {
  const trig = formatTrigger(stop.trigger);
  if (stop.payload && "source" in stop.payload && stop.payload.source === "mcq-pool") {
    return `${stop.payload.count} MCQs · ${trig}`;
  }
  return trig;
}

export function formatTrigger(t: JourneyStopTrigger): string {
  switch (t.type) {
    case "first_session": return "before first call";
    case "before_session": return `before session ${t.index}`;
    case "after_session": return `after session ${t.index}`;
    case "midpoint": return "midpoint";
    case "mastery_reached": return `mastery ≥ ${t.threshold}%`;
    case "session_count": return `after ${t.count} session${t.count === 1 ? "" : "s"}`;
    case "course_complete": return "course complete";
  }
}

export function quoted(s: string): string {
  const trimmed = s.length > 60 ? s.slice(0, 57) + "…" : s;
  return `"${trimmed}"`;
}

/**
 * Produce a compact text representation of the timeline for tests.
 * Snapshot-friendly format — one row per line.
 */
export function timelineSnapshot(input: {
  sessionFlow: SessionFlowResolved;
  mode: "continuous" | "structured";
  teachingMode?: string | null;
  sessionCount?: number | null;
}): string {
  const { sessionFlow, mode, teachingMode, sessionCount } = input;
  const lines: string[] = [];
  lines.push(`HEADER mode=${mode} type=${teachingMode ?? "?"}`);

  lines.push("BEFORE");
  lines.push(`  Onboarding: ${sessionFlow.onboarding.phases.length} phases (${sourceLabel(sessionFlow.source.onboarding)})`);
  lines.push(`  WelcomeMessage: ${sessionFlow.welcomeMessage ?? "<generic>"}`);
  lines.push(`  Goals: ${sessionFlow.intake.goals.enabled ? "ON" : "OFF"}`);
  lines.push(`  AboutYou: ${sessionFlow.intake.aboutYou.enabled ? "ON" : "OFF"}`);
  lines.push(`  KnowledgeCheck: ${kcSummary(sessionFlow.intake.knowledgeCheck)}`);
  lines.push(`  AIIntroCall: ${sessionFlow.intake.aiIntroCall.enabled ? "ON" : "OFF"}`);
  for (const s of sessionFlow.stops.filter(isPreTest)) lines.push(`  Pre-test: ${stopSummary(s)}`);

  lines.push("DURING");
  lines.push(`  Sessions: ${mode === "continuous" ? "scheduler-driven" : `${sessionCount ?? "?"} sessions`}`);
  for (const s of sessionFlow.stops.filter(isMidTest)) lines.push(`  Mid-test: ${stopSummary(s)}`);

  lines.push("AFTER");
  for (const s of sessionFlow.stops.filter(isPostTest)) lines.push(`  Post-test: ${stopSummary(s)}`);
  for (const s of sessionFlow.stops.filter(s => s.kind === "nps")) lines.push(`  NPS: ${stopSummary(s)}`);
  lines.push(`  Offboarding: ${sessionFlow.offboarding.phases.length} phases, trigger after ${sessionFlow.offboarding.triggerAfterCalls} calls`);

  return lines.join("\n");
}
