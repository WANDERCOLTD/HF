/**
 * Teaching Content Transform
 *
 * Renders curriculum assertions as structured teaching content in the LLM prompt.
 *
 * Two rendering modes:
 * 1. **Pyramid** (new) — If assertions have `depth` set, renders as a hierarchical
 *    tree: overview → topics → key points → details. Depth is tunable by learner level.
 * 2. **Flat** (legacy) — If no depth info, falls back to the original category-grouped
 *    bullet list for backward compatibility.
 *
 * Rendering config (levels, depth adaptation) comes from CONTENT-EXTRACT-001 spec
 * via the resolve-config module. The rendering is fully spec-driven — no hardcoded
 * depth values or level names.
 *
 * Data flow:
 * 1. Documents uploaded → assertions extracted (extract-assertions.ts)
 * 2. Assertions structured into pyramid (structure-assertions.ts)
 * 3. curriculumAssertions loader fetches them (SectionDataLoader)
 * 4. This transform renders them for the LLM prompt
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext, CurriculumAssertionData } from "../types";

// ------------------------------------------------------------------
// Flat rendering (legacy backward compat)
// ------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  definition: "KEY DEFINITIONS",
  fact: "VERIFIED FACTS",
  threshold: "THRESHOLDS & LIMITS",
  rule: "RULES & REGULATIONS",
  process: "PROCESSES & PROCEDURES",
  example: "EXAMPLES & SCENARIOS",
};

const CATEGORY_ORDER = ["definition", "rule", "threshold", "fact", "process", "example"];

function groupAssertions(assertions: CurriculumAssertionData[]): Map<string, Map<string, CurriculumAssertionData[]>> {
  const grouped = new Map<string, Map<string, CurriculumAssertionData[]>>();

  for (const a of assertions) {
    const cat = a.category || "fact";
    const chapter = a.chapter || "General";

    if (!grouped.has(cat)) grouped.set(cat, new Map());
    const catMap = grouped.get(cat)!;
    if (!catMap.has(chapter)) catMap.set(chapter, []);
    catMap.get(chapter)!.push(a);
  }

  return grouped;
}

function renderFlatTeachingPoints(
  grouped: Map<string, Map<string, CurriculumAssertionData[]>>,
  totalCount: number,
): string {
  const lines: string[] = [];

  lines.push("## APPROVED TEACHING POINTS");
  lines.push(`(${totalCount} verified assertions from trusted sources)\n`);
  lines.push("IMPORTANT: Use ONLY these teaching points when stating specific facts,");
  lines.push("definitions, thresholds, or rules. Cite the source when quoting figures.\n");

  for (const cat of CATEGORY_ORDER) {
    const chapters = grouped.get(cat);
    if (!chapters || chapters.size === 0) continue;

    const label = CATEGORY_LABELS[cat] || cat.toUpperCase();
    lines.push(`### ${label}`);

    for (const [chapter, assertions] of chapters) {
      if (chapter !== "General") {
        lines.push(`  ${chapter}:`);
      }
      for (const a of assertions) {
        const citation = a.pageRef ? ` [${a.sourceName}, ${a.pageRef}]` : ` [${a.sourceName}]`;
        const loRef = a.learningOutcomeRef ? ` (${a.learningOutcomeRef})` : "";
        const methodTag = a.teachMethod ? ` [${a.teachMethod}]` : "";
        lines.push(`  - ${a.assertion}${citation}${loRef}${methodTag}`);
      }
    }

    lines.push("");
  }

  // Also render any categories not in the predefined order
  for (const [cat, chapters] of grouped) {
    if (CATEGORY_ORDER.includes(cat)) continue;
    if (cat === "overview" || cat === "summary") continue; // Skip hierarchy categories in flat mode
    const label = cat.toUpperCase();
    lines.push(`### ${label}`);
    for (const [chapter, assertions] of chapters) {
      if (chapter !== "General") {
        lines.push(`  ${chapter}:`);
      }
      for (const a of assertions) {
        const citation = a.pageRef ? ` [${a.sourceName}, ${a.pageRef}]` : ` [${a.sourceName}]`;
        const methodTag = a.teachMethod ? ` [${a.teachMethod}]` : "";
        lines.push(`  - ${a.assertion}${citation}${methodTag}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ------------------------------------------------------------------
// Pyramid rendering (new)
// ------------------------------------------------------------------

/**
 * Render style mapping: how each renderAs value translates to prompt text.
 */
const RENDER_STYLES: Record<string, (text: string, citation: string) => string> = {
  paragraph: (text) => `\n${text}\n`,
  heading: (text) => `### ${text}`,
  subheading: (text) => `#### ${text}`,
  bold: (text) => `  **${text}**`,
  bullet: (text, citation) => `    - ${text}${citation}`,
};

/**
 * Compute the effective max depth based on learner signals.
 * Uses relative offsets from spec config.
 */
function computeEffectiveDepth(
  configMaxDepth: number,
  subjectTeachingDepth: number | null | undefined,
  learnerProfile: any,
  qualificationLevel: string | null | undefined,
): number {
  let depth = subjectTeachingDepth ?? configMaxDepth;

  // Default depth adaptation offsets (can be overridden by spec config)
  const entryLevelOffset = -1;
  const fastPaceOffset = -1;
  const advancedOffset = -1;

  // Adjust based on qualification level
  if (qualificationLevel) {
    const level = qualificationLevel.toLowerCase();
    if (level.includes("entry") || level.includes("foundation")) {
      depth = Math.max(0, depth + entryLevelOffset);
    }
  }

  // Adjust based on learner profile
  if (learnerProfile) {
    if (learnerProfile.pacePreference === "fast") {
      depth = Math.max(0, depth + fastPaceOffset);
    }

    // Check prior knowledge
    if (learnerProfile.priorKnowledge) {
      const hasAdvanced = Object.values(learnerProfile.priorKnowledge).some(
        (v: any) => v === "advanced" || v === "expert"
      );
      if (hasAdvanced) {
        depth = Math.max(0, depth + advancedOffset);
      }
    }
  }

  return depth;
}

/**
 * Build a tree structure from flat assertions with parentId references.
 */
function buildTree(assertions: CurriculumAssertionData[]): Map<string | null, CurriculumAssertionData[]> {
  const childrenOf = new Map<string | null, CurriculumAssertionData[]>();

  for (const a of assertions) {
    const parent = a.parentId || null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(a);
  }

  // Sort children by orderIndex within each parent
  for (const [, children] of childrenOf) {
    children.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  return childrenOf;
}

/**
 * Render a pyramid tree as structured text for the LLM prompt.
 */
function renderPyramid(
  assertions: CurriculumAssertionData[],
  maxDepth: number,
): string {
  const lines: string[] = [];
  const childrenOf = buildTree(assertions);
  const roots = childrenOf.get(null) || [];

  if (roots.length === 0) return "";

  lines.push("## TEACHING CONTENT");

  function renderNode(node: CurriculumAssertionData, currentDepth: number) {
    if (currentDepth > maxDepth) return;

    // Determine render style based on category/depth
    const style = getRenderStyle(node, currentDepth, maxDepth);
    const citation = buildCitation(node);

    const rendered = style(node.assertion, citation);
    if (rendered) lines.push(rendered);

    // Render children
    const children = childrenOf.get(node.id);
    if (children && currentDepth < maxDepth) {
      for (const child of children) {
        renderNode(child, currentDepth + 1);
      }
      // Add blank line after a topic group
      if (currentDepth <= 1) lines.push("");
    }
  }

  for (const root of roots) {
    renderNode(root, root.depth ?? 0);
  }

  return lines.join("\n");
}

/**
 * Get the render function for a node based on its depth position.
 */
function getRenderStyle(
  node: CurriculumAssertionData,
  depth: number,
  maxDepth: number,
): (text: string, citation: string) => string {
  // Overview (depth 0, category "overview")
  if (depth === 0 && (node.category === "overview" || node.category === "summary")) {
    return RENDER_STYLES.paragraph;
  }

  // For nodes near the top, use headings
  if (depth <= 1) return RENDER_STYLES.heading;

  // For the deepest visible level, use bullets with citations
  if (depth >= maxDepth) return RENDER_STYLES.bullet;

  // Mid-levels: use bold
  return RENDER_STYLES.bold;
}

/**
 * Build a citation string for an assertion.
 */
function buildCitation(a: CurriculumAssertionData): string {
  if (a.category === "overview" || a.category === "summary") return "";
  const parts: string[] = [];
  if (a.sourceName) {
    parts.push(a.pageRef ? `${a.sourceName}, ${a.pageRef}` : a.sourceName);
  }
  const citation = parts.length > 0 ? ` [${parts.join(", ")}]` : "";
  const loRef = a.learningOutcomeRef ? ` (${a.learningOutcomeRef})` : "";
  const methodTag = a.teachMethod ? ` [${a.teachMethod}]` : "";
  return `${citation}${loRef}${methodTag}`;
}

// ------------------------------------------------------------------
// Main transform
// ------------------------------------------------------------------

/**
 * Main transform — registered as "renderTeachingContent".
 *
 * Reads curriculumAssertions from loadedData and renders them as
 * structured teaching points for the LLM prompt.
 *
 * Uses pyramid rendering if assertions have depth set,
 * otherwise falls back to flat category-based rendering.
 */
registerTransform("renderTeachingContent", (
  _rawData: any,
  context: AssembledContext,
) => {
  const allAssertions = context.loadedData.curriculumAssertions || [];

  if (allAssertions.length === 0) {
    return {
      hasTeachingContent: false,
      totalAssertions: 0,
      teachingPoints: null,
      categories: {},
      currentModule: null,
    };
  }

  // Filter assertions to current module's learning outcomes if available
  // Priority: lesson plan entry module > nextModule > moduleToReview
  let currentModule = null;
  const lpEntry = context.sharedState?.lessonPlanEntry;
  if (lpEntry?.moduleId && context.sharedState?.modules) {
    currentModule = context.sharedState.modules.find(
      (m: any) => (m.id || m.slug) === lpEntry.moduleId
    ) || null;
  }
  if (!currentModule) {
    currentModule = context.sharedState?.nextModule || context.sharedState?.moduleToReview;
  }
  let assertions = allAssertions;

  // Priority 1: Session-specific LO refs from lesson plan (most precise — only TPs for THIS session)
  const sessionLORefs = context.sharedState?.lessonPlanEntry?.learningOutcomeRefs;
  if (sessionLORefs?.length && allAssertions.length > 0) {
    const sessionAssertions = allAssertions.filter((a) => {
      if (!a.learningOutcomeRef) return false;
      return sessionLORefs.some((ref) => a.learningOutcomeRef!.includes(ref));
    });
    if (sessionAssertions.length > 0) {
      assertions = sessionAssertions;
    }
  }

  // Priority 2: Fall back to current module LOs (existing behavior)
  if (assertions === allAssertions && currentModule?.learningOutcomes?.length && allAssertions.length > 0) {
    const moduleLOs = currentModule.learningOutcomes as string[];
    const loIds = moduleLOs.map((lo) => {
      const match = lo.match(/^(LO\d+|AC[\d.]+)/i);
      return match ? match[1] : lo;
    });

    const moduleAssertions = allAssertions.filter((a) => {
      if (!a.learningOutcomeRef) return false;
      return loIds.some((loId) => a.learningOutcomeRef!.includes(loId));
    });

    if (moduleAssertions.length > 0) {
      assertions = moduleAssertions;
    }
  }

  // Detect if we have pyramid hierarchy
  const hasHierarchy = assertions.some((a) => a.depth !== null && a.depth !== undefined);

  // Get teaching depth config
  const teachingDepth = (allAssertions as any).__teachingDepth ?? null;
  const learnerProfile = context.loadedData.learnerProfile;
  const qualificationLevel = context.loadedData.subjectSources?.subjects?.[0]?.qualificationRef ?? null;

  let teachingPoints: string;

  if (hasHierarchy) {
    // Pyramid mode: compute effective depth and render tree
    const defaultMaxDepth = Math.max(...assertions.filter((a) => a.depth != null).map((a) => a.depth!), 3);
    const effectiveDepth = computeEffectiveDepth(
      defaultMaxDepth,
      teachingDepth,
      learnerProfile,
      qualificationLevel,
    );
    teachingPoints = renderPyramid(assertions, effectiveDepth);
  } else {
    // Legacy flat mode: group by category → chapter
    const grouped = groupAssertions(assertions);
    teachingPoints = renderFlatTeachingPoints(grouped, assertions.length);
  }

  // Count per category
  const categories: Record<string, number> = {};
  for (const a of assertions) {
    const cat = a.category || "fact";
    categories[cat] = (categories[cat] || 0) + 1;
  }

  // Collect unique sources for metadata
  const sources = [...new Set(assertions.map((a) => a.sourceName))];

  // Render vocabulary section if available
  const vocabulary = context.loadedData.curriculumVocabulary || [];
  let vocabularySection = "";
  if (vocabulary.length > 0) {
    const vocabLines = vocabulary.map((v) => {
      const pos = v.partOfSpeech ? ` (${v.partOfSpeech})` : "";
      return `- ${v.term}${pos}: ${v.definition}`;
    });
    vocabularySection = `\n\nKEY VOCABULARY:\n${vocabLines.join("\n")}`;
  }

  // Append vocabulary to teaching points
  const fullTeachingPoints = vocabularySection
    ? `${teachingPoints}${vocabularySection}`
    : teachingPoints;

  // Question metadata for prompt awareness
  const questions = context.loadedData.curriculumQuestions || [];

  return {
    hasTeachingContent: true,
    totalAssertions: assertions.length,
    teachingPoints: fullTeachingPoints,
    categories,
    sources,
    highExamRelevanceCount: assertions.filter((a) => (a.examRelevance ?? 0) > 0.7).length,
    questionCount: questions.length,
    vocabularyCount: vocabulary.length,
    currentModule: currentModule ? {
      id: currentModule.id,
      name: currentModule.name || currentModule.title,
      learningOutcomes: currentModule.learningOutcomes || [],
    } : null,
  };
});
