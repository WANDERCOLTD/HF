/**
 * Course Instructions Transform
 *
 * Renders COURSE_REFERENCE assertions as structured tutor instructions.
 * These are rules for HOW to teach, not WHAT to teach.
 *
 * Categories come from the COURSE_REFERENCE extraction config in resolve-config.ts:
 * teaching_rule, session_flow, scaffolding_technique, skill_framework,
 * communication_rule, assessment_approach, differentiation, edge_case.
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, CourseInstructionData } from "../types";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";

/** Match a session range string (e.g., "1", "1-3", "final") against a call number. */
function matchesSessionRange(range: unknown, callNumber: number, totalSessions?: number): boolean {
  if (typeof range !== "string") return true; // non-string section → include
  const trimmed = range.trim().toLowerCase();
  if (!trimmed) return true;
  if (trimmed === "final" || trimmed === "last") {
    return totalSessions ? callNumber >= totalSessions : false;
  }
  if (trimmed.includes("-")) {
    const [startStr, endStr] = trimmed.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!isNaN(start) && !isNaN(end)) return callNumber >= start && callNumber <= end;
  }
  const exact = parseInt(trimmed, 10);
  if (!isNaN(exact)) return callNumber === exact;
  return true; // unparseable → include
}

const CATEGORY_LABELS: Record<string, string> = {
  teaching_rule: "TEACHING RULES",
  session_flow: "SESSION FLOW",
  scaffolding_technique: "SCAFFOLDING TECHNIQUES",
  skill_framework: "SKILLS FRAMEWORK",
  communication_rule: "COMMUNICATION RULES",
  assessment_approach: "ASSESSMENT APPROACH",
  differentiation: "DIFFERENTIATION",
  edge_case: "EDGE CASES",
  learner_model: "LEARNER MODEL",
  session_override: "SESSION-SPECIFIC INSTRUCTIONS",
  content_strategy: "CONTENT STRATEGY",
};

const CATEGORY_ORDER: readonly string[] = INSTRUCTION_CATEGORIES;

registerTransform("renderCourseInstructions", (
  _rawData: any,
  context: AssembledContext,
) => {
  const instructions = context.loadedData.courseInstructions || [];

  // If instructions are already synced into the course identity spec overlay,
  // skip standalone rendering to avoid duplication in the prompt
  const identityConfig = context.resolvedSpecs.identitySpec?.config as Record<string, unknown> | null;
  if (identityConfig?._syncedFromAssertions) {
    return {
      hasCourseInstructions: false,
      totalInstructions: 0,
      courseRules: null,
      categories: {},
    };
  }

  if (instructions.length === 0) {
    return {
      hasCourseInstructions: false,
      totalInstructions: 0,
      courseRules: null,
    };
  }

  // Session-aware filtering for session_override assertions.
  // Only include overrides whose sessionRange matches the current call number.
  const callNumber = (context.sharedState as Record<string, unknown>)?.currentSessionNumber as number | undefined;
  const totalSessions = (context.sharedState as Record<string, unknown>)?.totalSessions as number | undefined;
  const filtered = instructions.filter((inst) => {
    if (inst.category !== "session_override") return true;
    if (!callNumber || !inst.section) return true; // no session context → include all
    return matchesSessionRange(inst.section, callNumber, totalSessions);
  });

  // Group by category
  const grouped = new Map<string, CourseInstructionData[]>();
  for (const inst of filtered) {
    const cat = inst.category || "teaching_rule";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(inst);
  }

  // Render as markdown
  const lines: string[] = [];
  lines.push("## COURSE RULES");
  lines.push("These are course-specific teaching instructions. Follow them in every session.\n");

  // Render known categories in order
  for (const cat of CATEGORY_ORDER) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;

    const label = CATEGORY_LABELS[cat] || cat.toUpperCase();
    lines.push(`### ${label}`);
    for (const item of items) {
      lines.push(`- ${item.assertion}`);
    }
    lines.push("");
  }

  // Render any unknown categories
  for (const [cat, items] of grouped) {
    if (CATEGORY_ORDER.includes(cat)) continue;
    const label = cat.toUpperCase().replace(/_/g, " ");
    lines.push(`### ${label}`);
    for (const item of items) {
      lines.push(`- ${item.assertion}`);
    }
    lines.push("");
  }

  const courseRules = lines.join("\n");

  // Count per category
  const categories: Record<string, number> = {};
  for (const [cat, items] of grouped) {
    categories[cat] = items.length;
  }

  return {
    hasCourseInstructions: true,
    totalInstructions: instructions.length,
    courseRules,
    categories,
  };
});
