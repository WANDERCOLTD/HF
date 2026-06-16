/**
 * Block JOURNEY_SETTINGS entries without `menuGroupKey` — #1738.
 *
 * History: Slice C of epic #1675 (#1721) reshaped the Journey LH menu
 * from 45 setting rows to 13 educator-intent buckets. Every entry in
 * the journey registry now carries a `menuGroupKey: JourneyMenuBucketId`
 * field so the LH knows which bucket to mount the setting under.
 *
 * The registry-completeness vitest pins this at test time. This
 * ESLint rule catches the regression at edit time so a new entry can't
 * even land in a PR without a bucket assignment — the dev sees the
 * red squiggle as they type.
 *
 * Fires on any object literal inside `lib/journey/setting-contracts.entries.ts`
 * that has an `id` property whose value is a string Literal AND lacks
 * a `menuGroupKey` property. Treats the inverse case (a `menuGroupKey`
 * whose value isn't one of the 13 IDs) as a separate concern handled
 * by the existing TS type system.
 *
 * Greenlit (no fire):
 *   - `lib/settings/voice-setting-contracts.ts` — the voice sibling
 *     registry uses the same `JourneySettingContract` shape but its
 *     entries belong to the Settings tab voice group (S1_voice), not a
 *     journey bucket. The path-fragment allow-list skips voice entries
 *     entirely.
 *   - Test files (`*.test.ts`, `*.spec.ts`, `__tests__/`, `tests/`) —
 *     fixtures intentionally exercise contract shapes without bucket
 *     assignments to pin error-path behaviour.
 *
 * Severity: `error` from day 1. No pre-existing offences in the
 * journey registry (vitest pins this — see
 * `tests/lib/journey/registry-completeness.test.ts`).
 *
 * Companion: `lib/journey/setting-contracts.ts::JourneyMenuBucketId`,
 * `lib/journey/menu-items.ts`, `docs/CONTRACTS-JOURNEY.md` §17.
 */

// Allow-list: legitimate sites for contracts without menuGroupKey.
const ALLOWLIST_PATH_FRAGMENTS = [
  "/lib/settings/voice-setting-contracts.",
  ".test.",
  ".spec.",
  "/__tests__/",
  "/tests/",
];

function isAllowlistedFile(filename) {
  if (!filename) return false;
  return ALLOWLIST_PATH_FRAGMENTS.some((p) => filename.includes(p));
}

const messages = {
  missingBucket:
    'Journey setting `"{{id}}"` has no `menuGroupKey`. Add a `menuGroupKey: ' +
    '"<bucket id>"` field — pick one of the 13 buckets from ' +
    "`lib/journey/menu-items.ts::JOURNEY_MENU_BUCKET_IDS`. " +
    "See `docs/CONTRACTS-JOURNEY.md` §17 (Slice C bucket model) and " +
    "`docs/decisions/2026-06-16-journey-bucket-shape.md`.",
};

/**
 * Resolve an object property by name. Accepts both Identifier
 * (`menuGroupKey: ...`) and Literal (`"menuGroupKey": ...`) key forms.
 */
function getPropByName(objNode, name) {
  for (const prop of objNode.properties ?? []) {
    if (prop.type !== "Property") continue;
    if (prop.key.type === "Identifier" && prop.key.name === name) return prop;
    if (prop.key.type === "Literal" && prop.key.value === name) return prop;
  }
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require `menuGroupKey` on every JOURNEY_SETTINGS entry so the Slice C bucket-grained LH menu can mount it.",
      url: "https://github.com/WANDERCOLTD/HF/blob/main/docs/kb/guard-registry.md#guard-no-bucketless-journey-setting",
    },
    schema: [],
    messages,
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (isAllowlistedFile(filename)) {
      return {};
    }
    // Only run on the journey registry file. The voice registry is
    // already path-excluded above; restricting to the journey file
    // avoids accidentally firing on unrelated object literals
    // elsewhere that happen to have an `id` property.
    if (!filename || !filename.includes("/lib/journey/setting-contracts.entries")) {
      return {};
    }
    return {
      ObjectExpression(node) {
        const idProp = getPropByName(node, "id");
        if (!idProp) return;
        if (!idProp.value || idProp.value.type !== "Literal") return;
        if (typeof idProp.value.value !== "string") return;
        // Skip nested objects (e.g. autoEnableLinks entries which also
        // have an `id`-like key). Only top-level JourneySettingContract
        // literals carry these specific co-located fields: educatorLabel,
        // storagePath, composeImpact. Use those as the discriminator.
        const educatorLabel = getPropByName(node, "educatorLabel");
        const storagePath = getPropByName(node, "storagePath");
        if (!educatorLabel || !storagePath) return;

        const menuGroup = getPropByName(node, "menuGroupKey");
        if (menuGroup) return; // present — pass

        context.report({
          node: idProp,
          messageId: "missingBucket",
          data: { id: idProp.value.value },
        });
      },
    };
  },
};

export default rule;
