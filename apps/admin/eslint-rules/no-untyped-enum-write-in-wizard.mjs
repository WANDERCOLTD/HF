/**
 * Story #1995 — block `as string` casts on enum-bearing wizard config
 * fields inside the chat-wizard tool executor + admin-tools.
 *
 * Born of the live IELTS Speaking Practice incident on hf_sandbox
 * 2026-06-18: the AI wrote `teachingMode = "directive"` (a value from
 * the `interactionPattern` union) and the executor cast it to `string`
 * before merging into `Playbook.config`. Crashed every ComposedPrompt
 * build for new learners.
 *
 * PR #1993 added read-side defensive fallback; this rule is the
 * write-side structural guard. The matching guards in
 * `lib/content-trust/resolve-config.ts` (`isTeachingMode`,
 * `isInteractionPattern`, …) MUST be invoked before assignment; this
 * rule blocks the bare-cast pattern that bypassed the guards.
 *
 * ## What the rule checks
 *
 * Fires when, inside a guarded file, an object-property assignment of
 * the form
 *
 *   <object>.<enumField> = <expr> as string
 *
 * OR
 *
 *   { <enumField>: <expr> as string }
 *
 * appears, where `<enumField>` is the name of a known enum-bearing
 * wizard input field. The expectation is that the executor must
 * either (a) drop the `as string` cast (the field is already typed
 * narrowly post-#1995) or (b) route through one of the `is*` type
 * guards before the assignment.
 *
 * Allow-list:
 *   - Files outside the guarded fragments below — no enforcement
 *     (most of the codebase) so the rule's blast radius matches the
 *     surface that re-introduced the bug.
 *
 * Field allow-list (NOT enum-bearing — bare `as string` is fine):
 *   `welcomeMessage`, `subjectDiscipline`, `courseContext`,
 *   `physicalMaterials`. These are free-form strings.
 *
 * @see lib/wizard/enum-sets.ts
 * @see lib/content-trust/resolve-config.ts (type guards)
 * @see .claude/rules/wizard-enum-coverage.md
 */

const GUARDED_FILE_FRAGMENTS = [
  "lib/chat/wizard-tool-executor/",
  "lib/chat/admin-tools.ts",
  "lib/chat/admin-tool-handlers.ts",
];

/**
 * Fields whose value MUST be validated via a type guard before write.
 * Mirrored from `lib/wizard/enum-sets.ts` constants. Any change here
 * requires the same change in the coverage vitest
 * (`tests/lib/chat/wizard-enum-validation.test.ts`).
 */
const ENUM_BEARING_FIELDS = new Set([
  "interactionPattern",
  "teachingMode",
  "audience",
  "planEmphasis",
  "emphasis",
  "lessonPlanModel",
  "firstCallMode",
  "progressionMode",
]);

function isGuardedFile(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  for (const fragment of GUARDED_FILE_FRAGMENTS) {
    if (normalised.includes(fragment)) return true;
  }
  return false;
}

function isTestFile(filename) {
  if (!filename) return false;
  const normalised = filename.replace(/\\/g, "/");
  return (
    normalised.includes("/tests/") ||
    normalised.includes("/__tests__/") ||
    normalised.endsWith(".test.ts") ||
    normalised.endsWith(".test.tsx") ||
    normalised.endsWith(".spec.ts")
  );
}

/**
 * Detect `<expr> as string` (TS `TSAsExpression` with a `TSStringKeyword`
 * type annotation). Matches the bare-string-cast pattern that bypassed
 * the type-guard discipline in the pre-#1995 merge helpers.
 */
function isBareStringCast(node) {
  if (!node) return false;
  if (node.type !== "TSAsExpression") return false;
  const ann = node.typeAnnotation;
  if (!ann) return false;
  return ann.type === "TSStringKeyword";
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `as string` casts on enum-bearing wizard config fields inside lib/chat/wizard-tool-executor/** and admin-tools / admin-tool-handlers. Route through a runtime type guard (isTeachingMode / isInteractionPattern / …) instead — see lib/content-trust/resolve-config.ts.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-untyped-enum-write-in-wizard",
    },
    schema: [],
    messages: {
      bareEnumCast:
        "Bare `as string` cast on enum-bearing wizard field '{{field}}'. Route through the matching type guard from lib/content-trust/resolve-config.ts (isInteractionPattern / isTeachingMode / isAudience / isPlanEmphasis / isLessonPlanModel / isFirstCallMode / isProgressionMode) before writing. Story #1995 — the live IELTS Speaking Practice incident on hf_sandbox 2026-06-18 had `teachingMode = \"directive\"` reach the DB via this exact pattern.",
    },
  },
  create(context) {
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (!isGuardedFile(filename)) return {};
    if (isTestFile(filename)) return {};

    return {
      // Pattern A: `obj.field = (expr as string)` — assignment expression
      AssignmentExpression(node) {
        if (!node.left || node.left.type !== "MemberExpression") return;
        const prop = node.left.property;
        if (!prop || prop.type !== "Identifier") return;
        if (!ENUM_BEARING_FIELDS.has(prop.name)) return;
        if (!isBareStringCast(node.right)) return;
        context.report({
          node: node.right,
          messageId: "bareEnumCast",
          data: { field: prop.name },
        });
      },
      // Pattern B: `{ field: expr as string }` — object literal property
      Property(node) {
        if (node.computed) return;
        const key = node.key;
        if (!key) return;
        let name = null;
        if (key.type === "Identifier") name = key.name;
        else if (key.type === "Literal" && typeof key.value === "string") name = key.value;
        if (!name || !ENUM_BEARING_FIELDS.has(name)) return;
        if (!isBareStringCast(node.value)) return;
        context.report({
          node: node.value,
          messageId: "bareEnumCast",
          data: { field: name },
        });
      },
      // Pattern C: `const x = (input.field as string)` — VariableDeclarator
      // where the BoundIdentifier name itself names an enum-bearing field.
      // This catches the pre-#1995 idiom in `_new-config-merge.ts`:
      //   const newTeachingMode = (input.teachingMode as string) || (...);
      // by matching on the cast's source property name when the left-hand
      // identifier is also recognisable.
      VariableDeclarator(node) {
        if (!node.init) return;
        // Walk into LogicalExpression LHS: `(x as string) || (y as string)`
        const candidates = [];
        const walk = (n) => {
          if (!n) return;
          if (n.type === "TSAsExpression") candidates.push(n);
          else if (n.type === "LogicalExpression") {
            walk(n.left);
            walk(n.right);
          } else if (n.type === "ConditionalExpression") {
            walk(n.consequent);
            walk(n.alternate);
          }
        };
        walk(node.init);
        for (const cand of candidates) {
          if (!isBareStringCast(cand)) continue;
          // Inspect the cast's source: `<input|setupData>.<fieldName>`
          // Unwrap optional-chain: `setupData?.teachingMode` parses as
          // ChainExpression → MemberExpression.
          let source = cand.expression;
          if (source && source.type === "ChainExpression") {
            source = source.expression;
          }
          if (!source || source.type !== "MemberExpression") continue;
          const prop = source.property;
          if (!prop || prop.type !== "Identifier") continue;
          if (!ENUM_BEARING_FIELDS.has(prop.name)) continue;
          context.report({
            node: cand,
            messageId: "bareEnumCast",
            data: { field: prop.name },
          });
        }
      },
    };
  },
};

export default rule;
