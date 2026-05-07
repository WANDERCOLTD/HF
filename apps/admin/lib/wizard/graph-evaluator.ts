/**
 * Wizard Graph Evaluator — the Control Component of the Blackboard Architecture.
 *
 * Evaluates the wizard graph against the current blackboard (data bag) state.
 * Called on EVERY API turn to compute which nodes are available, blocked,
 * satisfied, or skipped — and a priority-ordered suggestion list for the AI.
 *
 * Pure functions — no side effects, no DB calls, no React.
 * ~O(N*D) where N = nodes, D = max deps per node. Trivial for 17 nodes.
 */

import type {
  WizardGraphNode,
  NodeStatus,
  SkipCondition,
  GraphEvaluation,
  NodeGroup,
} from "./graph-schema";
import { ALL_NODES, WIZARD_GRAPH_NODES } from "./graph-nodes";

// ── Helpers ───────────────────────────────────────────────

function hasValue(blackboard: Record<string, unknown>, key: string): boolean {
  const v = blackboard[key];
  return v !== undefined && v !== null && v !== "";
}

/**
 * Evaluate a skip condition against the blackboard.
 */
export function evaluateSkipCondition(
  cond: SkipCondition,
  blackboard: Record<string, unknown>,
): boolean {
  switch (cond.type) {
    case "community":
      return blackboard.defaultDomainKind === "COMMUNITY";
    case "equals":
      return blackboard[cond.key] === cond.value;
    case "not-equals":
      return blackboard[cond.key] !== cond.value;
    case "truthy":
      return !!blackboard[cond.key];
    case "falsy":
      return !blackboard[cond.key];
    case "all-falsy":
      return cond.keys.every((k) => !blackboard[k]);
  }
}

/**
 * Check if all dependencies are met.
 * Supports OR operator: "existingDomainId|draftDomainId" means
 * the dependency is satisfied if EITHER key has a value.
 */
export function checkDependencies(
  deps: string[],
  blackboard: Record<string, unknown>,
): boolean {
  for (const dep of deps) {
    if (dep.includes("|")) {
      const alternatives = dep.split("|");
      const anyMet = alternatives.some((alt) => hasValue(blackboard, alt));
      if (!anyMet) return false;
    } else {
      if (!hasValue(blackboard, dep)) return false;
    }
  }
  return true;
}

// ── Priority heuristic ────────────────────────────────────

const WEIGHT_REQUIRED = 200; // Required nodes always rank above optional at same priority
const WEIGHT_PRIORITY_TIER = 100;
const WEIGHT_UNLOCK = 30;
const WEIGHT_AFFINITY = 20;
const WEIGHT_EFFORT = 10;

const EFFORT_SCORES: Record<string, number> = {
  "options": 5,
  "free-text": 3,
  "sliders": 2,
  "file-upload": 1,
  "auto-resolved": 0,
  "derived": 0,
};

/**
 * Priority-order available nodes for natural conversation flow.
 *
 * Scoring:
 * 1. Priority tier (tier 1 = 400, tier 4 = 100)
 * 2. Unlock potential — nodes that unblock the most other nodes
 * 3. Conversational affinity — shared tags with the last user-answered node
 * 4. Effort ease — easy input types first within same priority
 */
function prioritize(
  available: WizardGraphNode[],
  satisfied: WizardGraphNode[],
  allNodes: WizardGraphNode[],
): WizardGraphNode[] {
  // Last USER-ANSWERED node (ignore auto-resolved/derived — they shift
  // affinity away from the conversation thread the user is actually in)
  const userSatisfied = satisfied.filter(
    (n) => n.inputType !== "auto-resolved" && n.inputType !== "derived",
  );
  const lastAnswered = userSatisfied.at(-1) ?? null;

  // Count how many blocked nodes each available node would unblock
  const unlockScores = new Map<string, number>();
  for (const node of available) {
    const wouldUnblock = allNodes.filter(
      (n) =>
        !available.includes(n) &&
        n.dependsOn.some((dep) => {
          if (dep.includes("|")) return dep.split("|").includes(node.key);
          return dep === node.key;
        }),
    ).length;
    unlockScores.set(node.key, wouldUnblock);
  }

  const scored = available.map((node) => {
    let score = 0;
    if (node.required) score += WEIGHT_REQUIRED;
    score += (5 - node.priority) * WEIGHT_PRIORITY_TIER;
    score += (unlockScores.get(node.key) || 0) * WEIGHT_UNLOCK;
    // Affinity: use tags (not group) — nodes sharing more tags bond tighter
    const lastTags = lastAnswered?.affinityTags ?? [];
    const tagOverlap = node.affinityTags.filter((t) => lastTags.includes(t)).length;
    score += tagOverlap * WEIGHT_AFFINITY;
    score += (EFFORT_SCORES[node.inputType] || 0) * WEIGHT_EFFORT;
    return { node, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.node);
}

// ── Main evaluator ────────────────────────────────────────

/**
 * Evaluate the wizard graph against the current blackboard.
 *
 * @param nodes - Graph node definitions (default: ALL_NODES)
 * @param blackboard - Current wizard data bag
 * @returns Full evaluation with statuses, suggestions, readiness
 */
export function evaluateGraph(
  blackboard: Record<string, unknown>,
  nodes: WizardGraphNode[] = ALL_NODES,
): GraphEvaluation {
  const statuses = new Map<string, NodeStatus>();
  const isPostScaffold = hasValue(blackboard, "draftPlaybookId");

  // ── Pass 1: Determine status of each node ──────────────
  for (const node of nodes) {
    // Skip condition?
    if (node.skipWhen && evaluateSkipCondition(node.skipWhen, blackboard)) {
      statuses.set(node.key, "skipped");
      continue;
    }

    // Already has a value (primary key or alternative keys)?
    const hasPrimaryValue = hasValue(blackboard, node.key);
    const hasAlternativeValue = node.satisfiedAlso?.some((k) => hasValue(blackboard, k)) ?? false;
    if (hasPrimaryValue || hasAlternativeValue) {
      if (isPostScaffold && !node.mutablePostScaffold) {
        statuses.set(node.key, "locked");
      } else {
        statuses.set(node.key, "satisfied");
      }
      continue;
    }

    // Dependencies met?
    if (!checkDependencies(node.dependsOn, blackboard)) {
      statuses.set(node.key, "blocked");
      continue;
    }

    // Available
    statuses.set(node.key, "available");
  }

  // ── Pass 2: Partition nodes ────────────────────────────
  const available: WizardGraphNode[] = [];
  const blocked: WizardGraphNode[] = [];
  const satisfied: WizardGraphNode[] = [];
  const skipped: WizardGraphNode[] = [];

  for (const node of nodes) {
    const status = statuses.get(node.key)!;
    switch (status) {
      case "available":
        available.push(node);
        break;
      case "blocked":
        blocked.push(node);
        break;
      case "satisfied":
      case "locked":
        satisfied.push(node);
        break;
      case "skipped":
        skipped.push(node);
        break;
    }
  }

  // ── Pass 3: Priority-ordered suggestions ───────────────
  // Only suggest user-facing nodes (not auto-resolved/derived)
  const userFacingAvailable = available.filter(
    (n) => n.inputType !== "auto-resolved" && n.inputType !== "derived",
  );
  const suggested = prioritize(userFacingAvailable, satisfied, nodes);

  // ── Pass 4: Readiness ──────────────────────────────────
  const userFacingNodes = nodes.filter(
    (n) => n.inputType !== "auto-resolved" && n.inputType !== "derived",
  );
  const activeNonSkipped = userFacingNodes.filter(
    (n) => statuses.get(n.key) !== "skipped",
  );
  const satisfiedCount = activeNonSkipped.filter((n) => {
    const s = statuses.get(n.key);
    return s === "satisfied" || s === "locked";
  }).length;
  const readinessPct =
    activeNonSkipped.length > 0
      ? Math.round((satisfiedCount / activeNonSkipped.length) * 100)
      : 100;

  // Required nodes still missing
  const requiredNodes = userFacingNodes.filter((n) => n.required);
  const missingRequired = requiredNodes.filter((n) => {
    const s = statuses.get(n.key);
    return s === "available" || s === "blocked";
  });

  return {
    nodeStatuses: statuses,
    available,
    suggested,
    blocked,
    satisfied,
    skipped,
    readinessPct,
    missingRequired,
    canLaunch: missingRequired.length === 0,
    activeGroup: suggested[0]?.group ?? null,
  };
}

/**
 * Build the graph-aware section for the wizard system prompt.
 *
 * Replaces the linear formatPhaseRoadmap + "Fields still needed" pattern.
 * The AI sees: collected values, priority-ordered suggestions with hints,
 * required-for-launch list, and resolver context.
 */
export function buildGraphPromptSection(
  evaluation: GraphEvaluation,
  blackboard: Record<string, unknown>,
  resolverContext: string[] = [],
): string {
  const lines: string[] = [];

  lines.push("## Wizard Status");
  lines.push(
    `Readiness: ${evaluation.readinessPct}% | Can launch: ${evaluation.canLaunch ? "YES" : "NO"}`,
  );
  lines.push("");

  // Collected
  const docKeys = new Set((blackboard._docConfigKeys as string[] | undefined) || []);
  if (evaluation.satisfied.length > 0) {
    lines.push("### Already collected");
    for (const node of evaluation.satisfied) {
      if (node.inputType === "auto-resolved") continue; // Don't show IDs
      const val = blackboard[node.key];
      const display =
        typeof val === "object" ? JSON.stringify(val) : String(val);
      const source = docKeys.has(node.key) ? " (from document)" : "";
      lines.push(`  ✓ ${node.label}: ${display}${source}`);
    }
    lines.push("");
  }

  // Skipped
  if (evaluation.skipped.length > 0) {
    const userFacingSkipped = evaluation.skipped.filter(
      (n) => n.inputType !== "auto-resolved" && n.inputType !== "derived",
    );
    if (userFacingSkipped.length > 0) {
      lines.push("### Skipped (not applicable)");
      for (const node of userFacingSkipped) {
        lines.push(`  ○ ${node.label}`);
      }
      lines.push("");
    }
  }

  // What to ask next
  lines.push("### What to ask next (priority order)");
  if (evaluation.suggested.length === 0) {
    if (evaluation.canLaunch) {
      lines.push(
        "  All fields collected! Offer to review the setup and create the course.",
      );
    } else {
      lines.push(
        "  No fields available — waiting for dependencies to resolve.",
      );
    }
  } else {
    // Split required from optional — required ALWAYS shown first with hard gate
    const requiredSuggested = evaluation.suggested.filter((n) => n.required);
    const optionalSuggested = evaluation.suggested.filter((n) => !n.required);

    if (requiredSuggested.length > 0) {
      lines.push("### REQUIRED — handle these BEFORE any optional fields");
      for (const node of requiredSuggested) {
        lines.push(`  ★ ${node.label} [${node.inputType}] — MUST SET before offering to create course`);
        lines.push(`     ${node.promptHint}`);
      }
      lines.push("");
    }

    if (optionalSuggested.length > 0) {
      const top = optionalSuggested.slice(0, 3);
      lines.push("### Optional (after all required fields are set)");
      for (const node of top) {
        lines.push(`  ${node.label} [${node.inputType}]`);
        lines.push(`     ${node.promptHint}`);
      }
      const rest = optionalSuggested.slice(3);
      if (rest.length > 0) {
        lines.push(`  ... and ${rest.length} more optional fields available`);
      }
    }
  }
  lines.push("");

  // Resolver context
  if (resolverContext.length > 0) {
    lines.push("### Just resolved");
    for (const msg of resolverContext) {
      lines.push(`  ${msg}`);
    }
    lines.push("");
  }

  // Upload classifications (not a graph node — inject directly so the AI can see them)
  const classifications = blackboard.lastUploadClassifications;
  if (Array.isArray(classifications) && classifications.length > 0) {
    lines.push("### Uploaded files (from lastUploadClassifications)");
    for (const c of classifications) {
      const conf = typeof c.confidence === "number" ? ` (confidence: ${Math.round(c.confidence * 100)}%)` : "";
      lines.push(`  - ${c.fileName}: ${c.documentType}${conf}`);
      if (c.reasoning) lines.push(`    Reasoning: ${c.reasoning}`);
    }
    lines.push("");
  }

  // Course reference digest (extracted assertions from COURSE_REFERENCE uploads)
  const digest = blackboard.courseRefDigest as {
    categoryBreakdown?: Record<string, number>;
    sampleAssertions?: Array<{ assertion: string; category: string; chapter?: string }>;
    totalCount?: number;
  } | undefined;
  if (digest?.categoryBreakdown && Object.keys(digest.categoryBreakdown).length > 0) {
    const LABELS: Record<string, string> = {
      teaching_rule: "Teaching rules",
      session_flow: "Session flow",
      scaffolding_technique: "Scaffolding techniques",
      skill_framework: "Skills framework",
      communication_rule: "Communication rules",
      assessment_approach: "Assessment approach",
      differentiation: "Differentiation",
      edge_case: "Edge cases",
    };
    lines.push("### Course reference digest (from extracted assertions)");
    lines.push(`Total assertions extracted: ${digest.totalCount || 0}`);
    lines.push("**Categories found:**");
    for (const [cat, count] of Object.entries(digest.categoryBreakdown)) {
      lines.push(`  - ${LABELS[cat] || cat}: ${count} assertions`);
    }
    if (digest.sampleAssertions?.length) {
      lines.push("**Sample assertions (representative examples):**");
      for (const s of digest.sampleAssertions) {
        lines.push(`  - [${LABELS[s.category] || s.category}] ${s.assertion}`);
      }
    }
    lines.push("");
  }

  // Missing required
  if (evaluation.missingRequired.length > 0) {
    lines.push("### Still required for launch");
    for (const node of evaluation.missingRequired) {
      lines.push(`  ✗ ${node.label}`);
    }
  }

  return lines.join("\n");
}

const FIELD_PROMPTS: Record<string, string> = {
  institutionName: "What's the name of your organisation or school?",
  courseName: "What would you like to name your course?",
  subjectDiscipline: "What subject will you be teaching?",
  interactionPattern: "Based on what you've described, I'd recommend [approach] — [1-sentence reason]. Does that work for you?",
  teachingMode: "What's the teaching emphasis for this course?",
  welcomeMessage: "Now let's set up your **welcome message** — this is what students hear when they first call in.",
  sessionCount: "How many sessions would you like in your course?",
  durationMins: "How long should each session be?",
  planEmphasis: "Would you like to focus on breadth or depth?",
  behaviorTargets: "Let's fine-tune your AI tutor's **personality**.",
  lessonPlanModel: "What lesson plan model works best for your course?",
};

/**
 * Build a graph-aware fallback when the AI produces no text.
 *
 * Context-aware: looks at the CURRENT TURN's tool calls to generate a
 * specific acknowledgment (not a dump of the full blackboard).
 * Falls back to graph evaluation for the continuation prompt.
 */
export function buildGraphFallback(
  evaluation: GraphEvaluation,
  blackboard: Record<string, unknown>,
  toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [],
): string {
  const names = new Set(toolCalls.map((tc) => tc.name));

  // ── 1. show_* tools: give contextual text for the panel ────────
  if (names.has("show_actions")) {
    return "Here's a summary of your setup. Ready to create your course?";
  }
  if (names.has("show_upload")) {
    return "Now let's add some **teaching content** — PDFs, Word docs, or text files with the material you want the AI to teach.";
  }
  if (names.has("show_sliders")) {
    return "Let's fine-tune the AI tutor's **personality** — how warm, direct, and encouraging should it be?";
  }
  if (names.has("show_options")) {
    const optionCall = toolCalls.find((tc) => tc.name === "show_options");
    const question = optionCall?.input?.question as string | undefined;
    if (!question) return "Pick an option below.";
    // Full-sentence interrogatives (e.g. "What should students see…?") are returned
    // verbatim — wrapping them in "Choose your … below." produces broken grammar.
    // Short noun-phrase labels (e.g. "audience") still get the wrapping.
    if (question.trim().endsWith("?")) return question;
    return `Choose your **${question.toLowerCase()}** below.`;
  }
  if (names.has("show_suggestions")) {
    const suggCall = toolCalls.find((tc) => tc.name === "show_suggestions");
    const question = suggCall?.input?.question as string | undefined;
    if (question) return question;
    return "";
  }

  // ── 2. Acknowledge what was JUST saved (this turn only) ────────
  const updateCalls = toolCalls.filter((tc) => tc.name === "update_setup");
  const justSaved: Record<string, unknown> = {};
  for (const tc of updateCalls) {
    const fields = tc.input.fields as Record<string, unknown> | undefined;
    if (fields) Object.assign(justSaved, fields);
  }

  const parts: string[] = [];
  if (justSaved.institutionName) parts.push(String(justSaved.institutionName));
  if (justSaved.subjectDiscipline) parts.push(String(justSaved.subjectDiscipline));
  if (justSaved.courseName) parts.push(`${justSaved.courseName} course`);
  if (justSaved.interactionPattern) parts.push(`${justSaved.interactionPattern} approach`);
  if (justSaved.teachingMode) parts.push(`${justSaved.teachingMode} emphasis`);
  if (justSaved.sessionCount) parts.push(`${justSaved.sessionCount} sessions`);
  if (justSaved.durationMins) parts.push(`${justSaved.durationMins} min each`);
  if (justSaved.welcomeMessage) parts.push("welcome message saved");
  if (justSaved.contentSkipped) parts.push("content skipped for now");
  if (justSaved.welcomeSkipped) parts.push("welcome message skipped");
  if (justSaved.tuneSkipped) parts.push("personality defaults kept");

  const ack = parts.length > 0 ? `Got it — ${parts.join(", ")}.` : "";

  // ── 3. Continuation: next suggested field ──────────────────────
  // Even when canLaunch is true, if there are still optional fields
  // the user hasn't been asked about, prompt for them first.
  if (evaluation.suggested.length > 0) {
    const next = evaluation.suggested[0];
    const prompt = FIELD_PROMPTS[next.key] || next.promptHint;
    return ack ? `${ack} ${prompt}` : prompt;
  }

  // ── 4. All fields done — offer to launch ───────────────────────
  if (evaluation.canLaunch) {
    return ack
      ? `${ack} Ready to review your setup and create your course?`
      : "Ready to review your setup and create your course?";
  }

  return ack || "Got it.";
}

/** Convenience: get the display groups and their aggregate status */
export function getGroupStatuses(
  evaluation: GraphEvaluation,
): Map<NodeGroup, "complete" | "active" | "waiting"> {
  const groups: NodeGroup[] = ["institution", "course", "pedagogy", "content", "welcome", "experience", "tune"];
  const result = new Map<NodeGroup, "complete" | "active" | "waiting">();

  for (const group of groups) {
    const userFacingInGroup = WIZARD_GRAPH_NODES.filter((n) => n.group === group);
    const statuses = userFacingInGroup.map((n) => evaluation.nodeStatuses.get(n.key));

    const allDone = statuses.every(
      (s) => s === "satisfied" || s === "locked" || s === "skipped",
    );
    const anyAvailable = statuses.some((s) => s === "available");

    if (allDone) {
      result.set(group, "complete");
    } else if (anyAvailable) {
      result.set(group, "active");
    } else {
      result.set(group, "waiting");
    }
  }

  return result;
}
