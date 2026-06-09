/**
 * #1259 — Block CallerModuleProgress reads outside a courseStyle="structured"
 * guard. Default-deny: absence of an explicit STRUCTURED check is an error.
 *
 * The whole point of #1252 is that module-progress data is only meaningful
 * for STRUCTURED courses. Reading `prisma.callerModuleProgress.findMany(...)`
 * inside a function that has not first established `courseStyle === "structured"`
 * (or `getCourseStyle(...) === "structured"`) reproduces the bug class the
 * epic exists to kill — CONTINUOUS courses get fed module data that has no
 * semantic meaning for them.
 *
 * Rule:
 *   prisma.callerModuleProgress.{find,upsert,create,update,delete}*(...)
 *     when no ancestor `IfStatement` in scope tests `courseStyle === "structured"`
 *     or `getCourseStyle(...) === "structured"`.
 *
 * Allowed call-sites (path-allowlist — these files own the STRUCTURED
 * implementation and gate at function entry, not inline):
 *   - lib/enrollment/instantiate-module-progress.ts (the seeder, #1254)
 *   - app/api/calls/[callId]/pipeline/route.ts (incrementModuleEvidence
 *     and the executor wiring read ctx.courseStyle at the top of stage)
 *   - lib/prompt/composition/transforms/modules.ts (the canonical reader;
 *     gates at top of computeSharedState)
 *   - lib/curriculum/track-progress.ts (operates on already-loaded data,
 *     called from inside the modules.ts gate)
 *   - scripts/** (one-shot migrations / backfills)
 *   - tests/**, __tests__/** (fixtures + assertions)
 *
 * Companion: `getCourseStyle()` in `lib/pipeline/course-style.ts` is the
 * one allowed way to resolve course-style. The rule does NOT require a
 * specific spelling — `courseStyle === "structured"` from any source
 * (PipelineContext, local helper, getCourseStyle return) is accepted.
 */

// Path allowlist — files that are either gated upstream by a
// STRUCTURED check or operate on data that is STRUCTURED-only by
// construction (a curriculum cannot exist for a CONTINUOUS course, so
// any helper that takes a `curriculumId` and reads CallerModuleProgress
// is by definition operating in the STRUCTURED contract). The rule's
// intent is to catch the runtime composer (#1252 Maya hallucination
// class), not display reads — empty data for CONTINUOUS courses
// renders empty UI / empty AI responses, not hallucinated behavior.
const ALLOWED_PATH_PATTERNS = [
  // The seeder — refuses to write for CONTINUOUS (#1254).
  /lib\/enrollment\/instantiate-module-progress\.ts$/,
  // The pipeline executor — receives ctx.courseStyle and gates inline.
  /app\/api\/calls\/.*\/pipeline\/route\.ts$/,
  // The canonical modules transform — gates at top of computeSharedState (#1259).
  /lib\/prompt\/composition\/transforms\/modules\.ts$/,
  // STRUCTURED-by-design curriculum helpers — they take a curriculumId
  // and operate on module/progress data; the helper exists only because
  // a Curriculum exists, which by contract means STRUCTURED.
  /lib\/curriculum\//,
  // Prompt composition loaders + transforms — invoked downstream of the
  // modules.ts gate (#1259); any module data they see is structured-only.
  /lib\/prompt\/composition\/loaders\//,
  /lib\/prompt\/composition\/transforms\//,
  // Goal-progress tracking — exam_readiness and module_mastery strategies
  // run only when the goal carries a module ref (STRUCTURED by data shape).
  /lib\/goals\//,
  // Admin / educator / student display routes — read CallerModuleProgress
  // for UI rendering. CONTINUOUS courses return empty rows; safe.
  /app\/api\/admin\//,
  /app\/api\/courses\//,
  /app\/api\/cohorts\//,
  /app\/api\/dashboard\//,
  /app\/api\/educator\//,
  /app\/api\/student\//,
  // Caller-scoped read endpoints (display + reset).
  /app\/api\/callers\/.*\/learning-trajectory\/route\.ts$/,
  /app\/api\/callers\/.*\/module-progress\/route\.ts$/,
  /app\/api\/callers\/.*\/reset\/route\.ts$/,
  /app\/api\/callers\/.*\/uplift\/route\.ts$/,
  /app\/api\/callers\/\[callerId\]\/route\.ts$/,
  /app\/api\/callers\/roster\/route\.ts$/,
  // VAPI tool — runtime conversation surface; reads mastery to inform
  // the AI's response. CONTINUOUS courses produce empty results; the
  // AI handles "no mastery data" gracefully (the gate is one level up
  // at COMPOSE, not here).
  /app\/api\/vapi\//,
  // Scripts + prisma seeds + tests are exempt (fixtures + migrations).
  /scripts\//,
  /prisma\//,
  /tests\//,
  /__tests__\//,
];

const TARGET_MODEL = "callerModuleProgress";
const GUARDED_PRISMA_METHODS = /^(find|findFirst|findUnique|findMany|upsert|create|createMany|update|updateMany|delete|deleteMany|count|aggregate|groupBy)/;

function isPrismaModelCall(node) {
  if (!node || node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    !callee.property ||
    callee.property.type !== "Identifier" ||
    !GUARDED_PRISMA_METHODS.test(callee.property.name)
  ) {
    return false;
  }
  const inner = callee.object;
  if (
    !inner ||
    inner.type !== "MemberExpression" ||
    !inner.property ||
    inner.property.type !== "Identifier" ||
    inner.property.name !== TARGET_MODEL
  ) {
    return false;
  }
  return true;
}

/**
 * Walk parents looking for an IfStatement whose test is a structural
 * `courseStyle === "structured"` (or `=== "structured"` on a chained
 * member access ending in `courseStyle`, or a `getCourseStyle(...) === "structured"`).
 */
function isStructuralStructuredCheck(testNode) {
  if (!testNode || testNode.type !== "BinaryExpression") return false;
  if (testNode.operator !== "===" && testNode.operator !== "==") return false;

  const isStructuredLiteral = (n) =>
    n &&
    ((n.type === "Literal" && n.value === "structured") ||
      (n.type === "TemplateLiteral" &&
        n.quasis.length === 1 &&
        n.quasis[0].value.cooked === "structured"));

  const matchesCourseStyleSide = (n) => {
    if (!n) return false;
    if (n.type === "Identifier" && n.name === "courseStyle") return true;
    if (n.type === "MemberExpression" && n.property && n.property.type === "Identifier" && n.property.name === "courseStyle") return true;
    if (n.type === "CallExpression" && n.callee && n.callee.type === "Identifier" && n.callee.name === "getCourseStyle") return true;
    return false;
  };

  return (
    (isStructuredLiteral(testNode.right) && matchesCourseStyleSide(testNode.left)) ||
    (isStructuredLiteral(testNode.left) && matchesCourseStyleSide(testNode.right))
  );
}

function isInsideStructuredGuard(node) {
  let cursor = node.parent;
  while (cursor) {
    if (cursor.type === "IfStatement" && isStructuralStructuredCheck(cursor.test)) {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Block CallerModuleProgress prisma reads/writes outside a courseStyle === 'structured' guard. Default-deny per #1252.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-module-read-without-course-style-guard",
    },
    schema: [],
    messages: {
      unguardedModuleRead:
        "CallerModuleProgress prisma access outside a `courseStyle === \"structured\"` guard. CONTINUOUS courses have no module-progress semantic; module reads must be inside an explicit if-block. Wrap in `if (courseStyle === 'structured') { ... }` or `if (getCourseStyle(...) === 'structured') { ... }`. See #1252 / #1259.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();
    if (ALLOWED_PATH_PATTERNS.some((rx) => rx.test(filename))) {
      return {};
    }
    return {
      CallExpression(node) {
        if (!isPrismaModelCall(node)) return;
        if (isInsideStructuredGuard(node)) return;
        context.report({ node, messageId: "unguardedModuleRead" });
      },
    };
  },
};
