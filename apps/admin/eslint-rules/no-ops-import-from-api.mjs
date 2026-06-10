/**
 * #1395 / #1423 — Block imports of the 5 `lib/ops/*` files that instantiate
 * their own `new PrismaClient()` from any `app/api/**` route, with one
 * exception for the dedicated ops endpoint.
 *
 * Why this matters:
 *   The five files below each create a *separate* PrismaClient instance,
 *   bypassing the shared singleton in `lib/prisma.ts`. The Tech Lead surfaced
 *   this in #1395 (RLS log-only) as the Phase-2 enforcement blocker: any
 *   per-request `$extends` hook on the singleton will not fire for these
 *   paths, so tenant-context-injection and Phase-2 enforcement will be
 *   silently understated. The fix is to unify these onto the singleton, but
 *   in the meantime new code must not deepen the problem.
 *
 *   The coupling-graph (#1423) made the cost visible: `lib/prisma.ts` is
 *   imported by 600 files; each new ops-style bypass is a hidden 601st
 *   surface that won't honour any future Prisma extension.
 *
 * Why path-restricted:
 *   `app/api/ops/route.ts` IS the ops endpoint — invoking these by design.
 *   Carving it out makes the rule pass on today's main while still blocking
 *   *new* routes from sneaking imports in.
 */

const BYPASS_FILES = new Set([
  "compose-next-prompt",
  "compute-reward",
  "knowledge-ingest",
  "transcripts-process",
  "update-targets",
]);

// Paths allowed to import bypass files (the only legitimate ops surface).
const ALLOWED_SOURCE_FRAGMENTS = [
  "/app/api/ops/route.ts",
];

const importRe = /^(?:@\/lib\/ops|(?:\.\.\/)+(?:.*\/)?lib\/ops)\/(?<file>[a-z0-9-]+?)(?:\.(?:ts|tsx|js|mjs))?$/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow API routes from importing the 5 lib/ops/* files that instantiate their own PrismaClient (bypass the singleton). See #1395 / #1423.",
      // KB pointer — why this guard exists + survives-hardening class.
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-ops-import-from-api",
    },
    schema: [],
    messages: {
      opsImportFromApi:
        "API routes must not import `{{file}}` from `lib/ops/` — this file instantiates its own PrismaClient and bypasses the singleton. Tenant-context injection (#1395 RLS) will not fire. Refactor lib/ops/{{file}} to use the shared `prisma` singleton from `@/lib/prisma`, OR move the orchestration into `app/api/ops/route.ts` (the only carved-out surface).",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || "";
    // Only fire inside app/api/** (any route handler).
    if (!filename.includes("/app/api/")) return {};
    // Carve out the legitimate ops surface.
    if (ALLOWED_SOURCE_FRAGMENTS.some((frag) => filename.endsWith(frag) || filename.includes(frag))) return {};

    function check(node, specifier) {
      const m = importRe.exec(specifier);
      if (!m) return;
      const file = m.groups?.file ?? "";
      if (BYPASS_FILES.has(file)) {
        context.report({ node, messageId: "opsImportFromApi", data: { file } });
      }
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === "string") check(node, node.source.value);
      },
      // Dynamic `import('@/lib/ops/...')`
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string") {
          check(node, node.source.value);
        }
      },
    };
  },
};
