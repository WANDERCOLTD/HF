/**
 * mockDiagnostic transform (#492 Slice 3.6)
 *
 * Renders the {@link MockDiagnosticData} loaded by `loaders/mockDiagnostic.ts`
 * into the prompt block the tutor will see. The block is intentionally
 * NEUTRAL / INSTRUCTIONAL — it describes what the diagnostic showed and
 * asks the tutor to guide the learner accordingly, NOT "you're bad at X".
 *
 * Returns `null` when there's no diagnostic to surface so the executor's
 * "strip undefined" pass drops the section entirely (combined with
 * fallback.action="omit").
 *
 * Output shape (consumed by the LLM prompt assembler):
 *   {
 *     hasDiagnostic: true,
 *     heading: "Recent mock diagnostic (3 days ago)",
 *     body: "## Recent mock diagnostic (3 days ago)\n\n...",
 *     summary: "...",
 *     strengthTitle: "Part 3" | null,
 *     focusTitles: ["Part 1", "Part 2"],
 *     weakSkill: "fluency" | null,
 *     ageInDays: 3 | null,
 *   }
 *
 * @see loaders/mockDiagnostic.ts
 */

import { registerTransform } from "../TransformRegistry";
import type {
  AssembledContext,
  CompositionSectionDef,
} from "../types";
import type { MockDiagnosticData } from "../loaders/mockDiagnostic";

export interface MockDiagnosticSection {
  hasDiagnostic: boolean;
  /** Markdown heading text. */
  heading: string;
  /** Fully assembled markdown block — heading + body. */
  body: string;
  summary: string | null;
  strengthTitle: string | null;
  focusTitles: string[];
  weakSkill: string | null;
  ageInDays: number | null;
}

function formatAge(ageInDays: number | null): string {
  if (ageInDays === null) return "recently";
  if (ageInDays <= 0) return "today";
  if (ageInDays === 1) return "yesterday";
  return `${ageInDays} days ago`;
}

function buildHeading(ageInDays: number | null): string {
  return `Recent mock diagnostic (${formatAge(ageInDays)})`;
}

/**
 * Compose the markdown block. Order matches the slice 3.6 contract:
 *
 *   ## Recent mock diagnostic ({age})
 *
 *   {summary}
 *
 *   Your strongest area: {strengthTitle}
 *   To improve, focus on: {focusTitles.join(", ")}
 *   Weakest skill: {weakSkill}
 *
 * Lines without data are omitted so the block never reads like "Your
 * strongest area: undefined".
 */
function buildBody(args: {
  heading: string;
  summary: string | null;
  strengthTitle: string | null;
  focusTitles: string[];
  weakSkill: string | null;
}): string {
  const { heading, summary, strengthTitle, focusTitles, weakSkill } = args;
  const lines: string[] = [`## ${heading}`, ""];
  if (summary) {
    lines.push(summary, "");
  }
  if (strengthTitle) {
    lines.push(`Your strongest area: ${strengthTitle}`);
  }
  if (focusTitles.length > 0) {
    lines.push(`To improve, focus on: ${focusTitles.join(", ")}`);
  }
  if (weakSkill) {
    lines.push(`Weakest skill: ${weakSkill}`);
  }
  // Trim trailing blank lines.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

registerTransform("renderMockDiagnostic", (
  rawData: MockDiagnosticData | null | undefined,
  _context: AssembledContext,
  _sectionDef: CompositionSectionDef,
): MockDiagnosticSection | null => {
  if (!rawData || !rawData.hasDiagnostic) {
    return null;
  }
  // Defensive: when EVERY field is empty there is nothing to say. Drop the
  // section rather than emit a heading with no content.
  const strengthTitle = rawData.strengthModule?.title ?? null;
  const focusTitles = rawData.focusModules.map((m) => m.title);
  if (!rawData.summary && !strengthTitle && focusTitles.length === 0 && !rawData.weakSkill) {
    return null;
  }
  const heading = buildHeading(rawData.ageInDays);
  const body = buildBody({
    heading,
    summary: rawData.summary,
    strengthTitle,
    focusTitles,
    weakSkill: rawData.weakSkill,
  });
  return {
    hasDiagnostic: true,
    heading,
    body,
    summary: rawData.summary,
    strengthTitle,
    focusTitles,
    weakSkill: rawData.weakSkill,
    ageInDays: rawData.ageInDays,
  };
});
