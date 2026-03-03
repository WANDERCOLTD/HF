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

const CATEGORY_LABELS: Record<string, string> = {
  teaching_rule: "TEACHING RULES",
  session_flow: "SESSION FLOW",
  scaffolding_technique: "SCAFFOLDING TECHNIQUES",
  skill_framework: "SKILLS FRAMEWORK",
  communication_rule: "COMMUNICATION RULES",
  assessment_approach: "ASSESSMENT APPROACH",
  differentiation: "DIFFERENTIATION",
  edge_case: "EDGE CASES",
};

const CATEGORY_ORDER: readonly string[] = INSTRUCTION_CATEGORIES;

registerTransform("renderCourseInstructions", (
  _rawData: any,
  context: AssembledContext,
) => {
  const instructions = context.loadedData.courseInstructions || [];

  if (instructions.length === 0) {
    return {
      hasCourseInstructions: false,
      totalInstructions: 0,
      courseRules: null,
    };
  }

  // Group by category
  const grouped = new Map<string, CourseInstructionData[]>();
  for (const inst of instructions) {
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
