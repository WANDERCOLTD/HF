/**
 * reconcile-child-parent.ts
 *
 * Generic child→parent linkage utility. Issue #163.
 *
 * The HF codebase has multiple AI-extracted child entities that need to be
 * linked back to parent entities created at a different time:
 *
 *   ContentAssertion.learningObjectiveId → LearningObjective
 *   ContentQuestion.assertionId          → ContentAssertion
 *   ContentVocabulary.assertionId        → ContentAssertion
 *
 * All three fail for the same reason: the child is extracted at time T1
 * without knowing about parent entities that exist at time T2. This file
 * is the reusable primitive that both the assertion→LO reconciler and the
 * question→assertion reconciler call into.
 *
 * Algorithm — one AI call per batch:
 *   1. Build a prompt with the full parent list + the orphan children
 *   2. Ask for `{ childId: parentRef | null, ... }` JSON output
 *   3. Validate every returned ref against the real parent whitelist
 *   4. Write FK + linkConfidence per accepted row
 *
 * ai-to-db guard: refs not in the parent whitelist are rejected. The AI
 * cannot write a bad FK.
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { parseJsonResponse } from "./extractors/base-extractor";

/** Default confidence written for an AI-retag match. Lands in the "ok" band. */
const DEFAULT_CONFIDENCE = 0.8;

/** Default batch size — caps prompt input size per call. */
const DEFAULT_BATCH_SIZE = 80;

export interface ReconcileChildParentOptions<Child, Parent> {
  /** Orphan child rows that need a parent FK set. Already filtered to NULL-FK. */
  children: Child[];

  /** Full parent set the AI should choose from. */
  parents: Parent[];

  /** Stable unique id of the child (used as the key in the AI's JSON output). */
  getChildId: (c: Child) => string;

  /** Human-readable text describing the child — shown to the AI. */
  getChildText: (c: Child) => string;

  /** Optional short category/hint tag shown alongside child text. */
  getChildCategory?: (c: Child) => string | null | undefined;

  /** Stable parent ref string — what the AI returns in its JSON output. */
  getParentRef: (p: Parent) => string;

  /** Parent description shown in the prompt so the AI can disambiguate. */
  getParentDescription: (p: Parent) => string;

  /** Optional parent "group" label — e.g. module title for LOs. */
  getParentGroup?: (p: Parent) => string | null | undefined;

  /** Stable parent unique id the writeFk callback will receive. */
  getParentId: (p: Parent) => string;

  /**
   * Write the FK + confidence for one child→parent pair. The generic utility
   * has no Prisma model knowledge; the caller wires the update.
   */
  writeFk: (childId: string, parentId: string, confidence: number) => Promise<void>;

  /** AI callPoint string for metering + logs. */
  aiCallPoint: string;

  /** For prompt phrasing, e.g. "teaching points" or "questions". */
  childLabel: string;

  /** For prompt phrasing, e.g. "learning outcomes" or "teaching points". */
  parentLabel: string;

  /** Override the default 0.80 confidence written on match. */
  confidenceOnMatch?: number;

  /** Override the default batch size (80). */
  batchSize?: number;
}

export interface ReconcileChildParentResult {
  /** Total children offered to Pass 2 */
  scanned: number;
  /** Children where the AI returned a valid parent ref that matched the whitelist */
  matched: number;
  /** Children where the AI returned null, whitespace, or a ref the guard rejected */
  unmatched: number;
  /** Subcount of unmatched: AI returned a ref that was not in the parent whitelist */
  invalidRefs: number;
  /** Per-parent-ref match count, for caller reporting / logging */
  byRef: Record<string, number>;
}

/**
 * Run the AI retag pass for a child→parent relationship. Batched by
 * `batchSize`. Writes via `writeFk` per successful match. Safe to call with
 * an empty `children` array — it's a no-op that returns zeros.
 */
export async function reconcileChildToParent<Child, Parent>(
  opts: ReconcileChildParentOptions<Child, Parent>,
): Promise<ReconcileChildParentResult> {
  const result: ReconcileChildParentResult = {
    scanned: opts.children.length,
    matched: 0,
    unmatched: 0,
    invalidRefs: 0,
    byRef: {},
  };

  if (opts.children.length === 0 || opts.parents.length === 0) {
    result.unmatched = opts.children.length;
    return result;
  }

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const confidence = opts.confidenceOnMatch ?? DEFAULT_CONFIDENCE;

  // Build parent lookup maps — the whitelist guard is based on normalised refs.
  const validRefs = new Set(opts.parents.map((p) => opts.getParentRef(p).toUpperCase()));
  const parentByRef = new Map(
    opts.parents.map((p) => [opts.getParentRef(p).toUpperCase(), p] as const),
  );

  const parentList = opts.parents
    .map((p) => {
      const group = opts.getParentGroup?.(p);
      const groupPrefix = group ? `(${group}) ` : "";
      return `- ${opts.getParentRef(p)}: ${groupPrefix}${opts.getParentDescription(p)}`;
    })
    .join("\n");

  for (let i = 0; i < opts.children.length; i += batchSize) {
    const batch = opts.children.slice(i, i + batchSize);

    const childBlock = batch
      .map((c) => {
        const cat = opts.getChildCategory?.(c);
        const catTag = cat ? ` [${cat}]` : "";
        return `${opts.getChildId(c)}${catTag} ${opts.getChildText(c)}`;
      })
      .join("\n");

    const systemPrompt = `You are a curriculum mapping assistant. You receive a list of ${opts.parentLabel} from a course, and a list of ${opts.childLabel} that are currently unassigned. Your job is to map each ${opts.childLabel.replace(/s$/, "")} to the single best-matching ${opts.parentLabel.replace(/s$/, "")}, or to "null" if no good match exists.

Rules:
- Return ONLY a JSON object of the form { "<childId>": "<parentRef>" | null, ... }
- Every input id MUST appear as a key in the output
- Values must be either an exact parent ref from the provided list or null
- Prefer null over a weak guess — it is better to leave a ${opts.childLabel.replace(/s$/, "")} unassigned than to mis-tag it
- A ${opts.childLabel.replace(/s$/, "")} can match at most one ${opts.parentLabel.replace(/s$/, "")} — pick the single best one
- Do not invent parent refs not in the provided list`;

    const userPrompt = `${opts.parentLabel.charAt(0).toUpperCase() + opts.parentLabel.slice(1)}:
${parentList}

Unassigned ${opts.childLabel} (format: <id> [<category>] <text>):
${childBlock}

Return the JSON mapping now.`;

    let response;
    try {
      response = await getConfiguredMeteredAICompletion(
        {
          callPoint: opts.aiCallPoint,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
        { sourceOp: opts.aiCallPoint },
      );
    } catch (err) {
      const droppedIds = batch.map(opts.getChildId);
      console.error(
        `[${opts.aiCallPoint}] batch ${i / batchSize} failed — ${batch.length} item(s) left unmatched:`,
        { droppedIds, err },
      );
      result.unmatched += batch.length;
      continue;
    }

    let parsed: Record<string, string | null>;
    try {
      const raw = parseJsonResponse(response.content.trim());
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("not an object");
      }
      parsed = raw as Record<string, string | null>;
    } catch (err) {
      console.error(`[${opts.aiCallPoint}] parse failed for batch ${i / batchSize}:`, err);
      result.unmatched += batch.length;
      continue;
    }

    for (const c of batch) {
      const childId = opts.getChildId(c);
      const rawRef = parsed[childId];
      if (rawRef == null || rawRef === "") {
        result.unmatched++;
        continue;
      }
      if (typeof rawRef !== "string") {
        result.invalidRefs++;
        result.unmatched++;
        continue;
      }
      const normalised = rawRef.trim().toUpperCase();
      if (!validRefs.has(normalised)) {
        // ai-to-db guard: AI hallucinated a ref outside the whitelist
        result.invalidRefs++;
        result.unmatched++;
        continue;
      }
      const parent = parentByRef.get(normalised);
      if (!parent) {
        result.invalidRefs++;
        result.unmatched++;
        continue;
      }

      try {
        await opts.writeFk(childId, opts.getParentId(parent), confidence);
        result.matched++;
        const ref = opts.getParentRef(parent);
        result.byRef[ref] = (result.byRef[ref] ?? 0) + 1;
      } catch (err) {
        console.error(`[${opts.aiCallPoint}] writeFk failed for ${childId}:`, err);
        result.unmatched++;
      }
    }
  }

  return result;
}
