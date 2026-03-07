/**
 * Assertion Structuring Engine
 *
 * Takes flat assertions for a content source and organizes them into a
 * pedagogical pyramid using AI. The pyramid shape (levels, branching factor)
 * is fully configurable via CONTENT-EXTRACT spec.
 *
 * Flow:
 * 1. Load flat assertions for a source
 * 2. Resolve extraction config (system + domain)
 * 3. Build structuring prompt from spec levels config
 * 4. Send assertions to AI for hierarchical organization
 * 5. Parse tree result and apply to DB (create parent nodes, link children)
 */

import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import {
  resolveExtractionConfig,
  getMaxDepth,
  type ExtractionConfig,
  type PyramidLevel,
  type DocumentType,
} from "./resolve-config";
import crypto from "crypto";

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

/** Minimum assertions needed to justify AI structuring cost */
const MIN_ASSERTIONS_FOR_STRUCTURE = 15;

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/** A node in the structured pyramid returned by AI */
export interface PyramidNode {
  text: string;
  slug?: string;
  children?: PyramidNode[];
  /** For leaf nodes: content hashes of existing assertions */
  detailHashes?: string[];
}

/** Full structuring result */
export interface StructuringResult {
  ok: boolean;
  tree: PyramidNode | null;
  stats: {
    levelsCreated: number;
    nodesCreated: number;
    assertionsLinked: number;
    orphanAssertions: number;
  };
  warnings: string[];
  error?: string;
}

/** Preview result (no DB changes) */
export interface StructurePreview {
  ok: boolean;
  tree: PyramidNode;
  stats: {
    totalAssertions: number;
    proposedNodes: number;
    levelsUsed: number;
  };
  warnings: string[];
  error?: string;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex").substring(0, 16);
}

/**
 * Build the structuring prompt from spec config levels.
 * Dynamically generates the expected output schema based on how many levels exist.
 */
function buildStructuringPrompt(
  extractionConfig: ExtractionConfig,
  assertions: { assertion: string; contentHash: string; category: string }[],
): string {
  const { structuring } = extractionConfig;
  const levels = structuring.levels;
  const maxDepth = getMaxDepth(extractionConfig);

  // Build level descriptions
  const levelDescriptions = levels.map((l) => {
    const desc = l.description || l.label;
    return `  Level ${l.depth} (${l.label}): ${desc}. Max ${l.maxChildren} children.`;
  }).join("\n");

  // Build the expected JSON schema description
  const schemaDescription = buildSchemaDescription(levels, 0);

  const assertionList = assertions.map((a) =>
    `[${a.contentHash}] (${a.category}) ${a.assertion}`
  ).join("\n");

  return `PYRAMID LEVELS:
${levelDescriptions}

Target children per node: ~${structuring.targetChildCount}
Total levels: ${levels.length} (depth 0 to ${maxDepth})

EXISTING ASSERTIONS TO ORGANIZE (${assertions.length} total):
${assertionList}

OUTPUT FORMAT:
Return a JSON object matching this structure:
${schemaDescription}

IMPORTANT:
- Reference existing assertions by their hash (the [hash] prefix) at the leaf level using "detailHashes"
- Create synthesized text for all non-leaf levels (overview paragraphs, topic names, key point summaries)
- Every existing assertion hash MUST appear in exactly one "detailHashes" array
- Use kebab-case for slug values
- Return ONLY valid JSON (no markdown code fences)`;
}

/**
 * Recursively build a JSON schema description for the expected output.
 */
function buildSchemaDescription(levels: PyramidLevel[], currentIndex: number): string {
  if (currentIndex >= levels.length) return "";

  const level = levels[currentIndex];
  const isLeaf = currentIndex === levels.length - 1;
  const indent = "  ".repeat(currentIndex);

  if (currentIndex === 0 && levels.length === 1) {
    // Single level: just a list
    return `{
  "text": "overview text",
  "slug": "overview",
  "detailHashes": ["hash1", "hash2", ...]
}`;
  }

  if (currentIndex === 0) {
    // Root node
    const childSchema = buildSchemaDescription(levels, currentIndex + 1);
    return `{
  "text": "${level.label} text (synthesized)",
  "slug": "${level.label}",
  "children": [
    ${childSchema}
  ]
}`;
  }

  if (isLeaf) {
    // Leaf level: references assertion hashes
    return `${indent}{
${indent}  "text": "${level.label} name",
${indent}  "slug": "${level.label}-slug",
${indent}  "detailHashes": ["hash1", "hash2", "hash3"]
${indent}}`;
  }

  // Mid-level: has children
  const childSchema = buildSchemaDescription(levels, currentIndex + 1);
  return `${indent}{
${indent}  "text": "${level.label} name (synthesized)",
${indent}  "slug": "${level.label}-slug",
${indent}  "children": [
${indent}    ${childSchema}
${indent}  ]
${indent}}`;
}

// ------------------------------------------------------------------
// AI structuring
// ------------------------------------------------------------------

/**
 * Send assertions to AI for hierarchical organization.
 */
async function structureWithAI(
  extractionConfig: ExtractionConfig,
  assertions: { assertion: string; contentHash: string; category: string }[],
): Promise<{ tree: PyramidNode | null; warnings: string[] }> {
  const warnings: string[] = [];
  const { structuring } = extractionConfig;

  const userPrompt = buildStructuringPrompt(extractionConfig, assertions);

  try {
    // @ai-call content-trust.structure — Organize assertions into pedagogical pyramid | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "content-trust.structure",
        messages: [
          { role: "system", content: structuring.systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      { sourceOp: "content-trust:structure" }
    );

    logAssistantCall(
      {
        callPoint: "content-trust.structure",
        userMessage: `Structure ${assertions.length} assertions`,
        metadata: { assertionCount: assertions.length },
      },
      { response: "Structured assertions into pyramid", success: true }
    );

    // Parse JSON response
    let text = result.content.trim();
    // Handle markdown code fences
    if (!text.startsWith("{") && !text.startsWith("[")) {
      text = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    }
    // Remove trailing commas
    text = text.replace(/,\s*([\]}])/g, "$1");

    const tree = JSON.parse(text) as PyramidNode;
    return { tree, warnings };
  } catch (err: any) {
    console.error("[structure-assertions] AI structuring failed:", err.message);
    warnings.push(`AI structuring failed: ${err.message}`);
    return { tree: null, warnings };
  }
}

// ------------------------------------------------------------------
// Preview (no DB changes)
// ------------------------------------------------------------------

/**
 * Preview the proposed pyramid structure without saving.
 */
export async function previewStructure(sourceId: string): Promise<StructurePreview> {
  const warnings: string[] = [];

  // Load source to get documentType
  const source = await prisma.contentSource.findUnique({
    where: { id: sourceId },
    select: { documentType: true },
  });

  // Load assertions for this source
  const assertions = await prisma.contentAssertion.findMany({
    where: { sourceId },
    select: { assertion: true, contentHash: true, category: true },
    orderBy: [{ category: "asc" }, { chapter: "asc" }],
  });

  if (assertions.length === 0) {
    return { ok: false, tree: { text: "", children: [] }, stats: { totalAssertions: 0, proposedNodes: 0, levelsUsed: 0 }, warnings: [], error: "No assertions found for this source" };
  }

  // Resolve config (with document type overrides)
  const extractionConfig = await resolveExtractionConfig(sourceId, source?.documentType as DocumentType | undefined);

  // Run AI structuring
  const { tree, warnings: aiWarnings } = await structureWithAI(
    extractionConfig,
    assertions.map((a) => ({
      assertion: a.assertion,
      contentHash: a.contentHash || hashText(a.assertion),
      category: a.category,
    })),
  );

  warnings.push(...aiWarnings);

  if (!tree) {
    return { ok: false, tree: { text: "", children: [] }, stats: { totalAssertions: assertions.length, proposedNodes: 0, levelsUsed: 0 }, warnings, error: "AI structuring failed" };
  }

  // Count nodes in tree
  let nodeCount = 0;
  let maxDepthSeen = 0;
  function countNodes(node: PyramidNode, depth: number) {
    nodeCount++;
    maxDepthSeen = Math.max(maxDepthSeen, depth);
    if (node.children) {
      for (const child of node.children) {
        countNodes(child, depth + 1);
      }
    }
  }
  countNodes(tree, 0);

  return {
    ok: true,
    tree,
    stats: {
      totalAssertions: assertions.length,
      proposedNodes: nodeCount,
      levelsUsed: maxDepthSeen + 1,
    },
    warnings,
  };
}

// ------------------------------------------------------------------
// Apply (save to DB)
// ------------------------------------------------------------------

/**
 * Apply the pyramid structure to the database.
 * Creates new higher-level nodes, links existing assertions as leaves.
 */
export async function applyStructure(sourceId: string): Promise<StructuringResult> {
  const warnings: string[] = [];

  // Load source to get documentType
  const source = await prisma.contentSource.findUnique({
    where: { id: sourceId },
    select: { documentType: true },
  });

  // Load existing assertions
  const assertions = await prisma.contentAssertion.findMany({
    where: { sourceId },
    select: { id: true, assertion: true, contentHash: true, category: true },
  });

  if (assertions.length === 0) {
    return { ok: false, tree: null, stats: { levelsCreated: 0, nodesCreated: 0, assertionsLinked: 0, orphanAssertions: 0 }, warnings: [], error: "No assertions found" };
  }

  // Build hash → id lookup
  const hashToId = new Map<string, string>();
  for (const a of assertions) {
    const hash = a.contentHash || hashText(a.assertion);
    hashToId.set(hash, a.id);
  }

  // Resolve config (with document type overrides) and run AI structuring
  const extractionConfig = await resolveExtractionConfig(sourceId, source?.documentType as DocumentType | undefined);
  const maxDepth = getMaxDepth(extractionConfig);

  const { tree, warnings: aiWarnings } = await structureWithAI(
    extractionConfig,
    assertions.map((a) => ({
      assertion: a.assertion,
      contentHash: a.contentHash || hashText(a.assertion),
      category: a.category,
    })),
  );

  warnings.push(...aiWarnings);

  if (!tree) {
    return { ok: false, tree: null, stats: { levelsCreated: 0, nodesCreated: 0, assertionsLinked: 0, orphanAssertions: 0 }, warnings, error: "AI structuring failed" };
  }

  // Clear existing hierarchy nodes (depth < maxDepth, i.e. non-leaf parent nodes we created)
  await prisma.contentAssertion.deleteMany({
    where: {
      sourceId,
      depth: { not: null, lt: maxDepth },
      // Only delete nodes we created (overview/summary categories)
      category: { in: ["overview", "summary"] },
    },
  });

  // Reset parentId on all existing assertions
  await prisma.contentAssertion.updateMany({
    where: { sourceId },
    data: { parentId: null, depth: maxDepth, orderIndex: 0, topicSlug: null },
  });

  // Recursively create hierarchy nodes and link assertions
  let nodesCreated = 0;
  let assertionsLinked = 0;
  const levelsUsed = new Set<number>();
  const allReferencedHashes = new Set<string>();

  async function createNode(
    node: PyramidNode,
    depth: number,
    parentId: string | null,
    orderIndex: number,
    topicSlug: string | null,
  ): Promise<string | null> {
    const level = extractionConfig.structuring.levels.find((l) => l.depth === depth);
    const category = depth === 0 ? "overview" : "summary";
    const slug = node.slug || topicSlug;
    levelsUsed.add(depth);

    // Check if this is a leaf level with detailHashes
    if (node.detailHashes && node.detailHashes.length > 0) {
      // This node references existing assertions — create a parent node
      const parent = await prisma.contentAssertion.create({
        data: {
          sourceId,
          assertion: node.text,
          category,
          depth,
          parentId,
          orderIndex,
          topicSlug: slug,
          tags: [],
          contentHash: hashText(node.text),
        },
      });
      nodesCreated++;

      // Link detail assertions to this parent
      for (let i = 0; i < node.detailHashes.length; i++) {
        const hash = node.detailHashes[i];
        allReferencedHashes.add(hash);
        const assertionId = hashToId.get(hash);
        if (assertionId) {
          await prisma.contentAssertion.update({
            where: { id: assertionId },
            data: {
              parentId: parent.id,
              depth: depth + 1,
              orderIndex: i,
              topicSlug: slug,
            },
          });
          assertionsLinked++;
        }
      }

      return parent.id;
    }

    // Non-leaf node with children
    if (node.children && node.children.length > 0) {
      const parent = await prisma.contentAssertion.create({
        data: {
          sourceId,
          assertion: node.text,
          category,
          depth,
          parentId,
          orderIndex,
          topicSlug: slug,
          tags: [],
          contentHash: hashText(node.text),
        },
      });
      nodesCreated++;

      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const childSlug = child.slug || slug;
        await createNode(child, depth + 1, parent.id, i, childSlug);
      }

      return parent.id;
    }

    // Leaf text node (no children, no hashes) — treat as a standalone assertion
    const parent = await prisma.contentAssertion.create({
      data: {
        sourceId,
        assertion: node.text,
        category,
        depth,
        parentId,
        orderIndex,
        topicSlug: slug,
        tags: [],
        contentHash: hashText(node.text),
      },
    });
    nodesCreated++;
    return parent.id;
  }

  // Create the tree starting from root
  await createNode(tree, 0, null, 0, tree.slug || null);

  // Count orphan assertions (not referenced by any hash)
  const orphanAssertions = assertions.filter(
    (a) => !allReferencedHashes.has(a.contentHash || hashText(a.assertion))
  ).length;

  if (orphanAssertions > 0) {
    warnings.push(`${orphanAssertions} assertions were not referenced in the pyramid structure`);
  }

  return {
    ok: true,
    tree,
    stats: {
      levelsCreated: levelsUsed.size,
      nodesCreated,
      assertionsLinked,
      orphanAssertions,
    },
    warnings,
  };
}

// ------------------------------------------------------------------
// Auto-structuring helper (fire-and-forget after extraction)
// ------------------------------------------------------------------

/**
 * Structure a source's assertions into a pyramid IF eligible.
 * Checks minimum assertion count and idempotency (skips if already structured).
 * Designed to be called fire-and-forget after extraction completes.
 */
export async function structureSourceIfEligible(sourceId: string): Promise<void> {
  const count = await prisma.contentAssertion.count({ where: { sourceId } });
  if (count < MIN_ASSERTIONS_FOR_STRUCTURE) {
    console.log(`[structure] Skipping ${sourceId}: ${count} assertions < ${MIN_ASSERTIONS_FOR_STRUCTURE} minimum`);
    return;
  }

  // Idempotency: skip if already structured
  const structured = await prisma.contentAssertion.count({
    where: { sourceId, depth: { not: null } },
  });
  if (structured > 0) {
    console.log(`[structure] Skipping ${sourceId}: already structured (${structured} nodes with depth)`);
    return;
  }

  console.log(`[structure] Auto-structuring ${sourceId} (${count} assertions)`);
  await applyStructure(sourceId);
}
