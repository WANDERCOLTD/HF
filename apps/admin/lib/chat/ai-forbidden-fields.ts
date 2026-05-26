/**
 * AI-FORBIDDEN FIELDS — the global whitelist that says
 * "no AI tool may declare these fields in its input_schema, period".
 *
 * Why this exists (2026-05-26):
 *   The `update_caller` tool exposed `role` and `domainId` in its
 *   input_schema. An operator typed "change Brynn's role to admin" into
 *   the Cmd+K Assistant; the model fired `update_caller({role: "ADMIN"})`
 *   and Brynn's role was written to the DB. The handler had no guard, the
 *   schema had no scrub, and no central rule said "role is off-limits for
 *   AI". Each tool is its own whitelist — nobody was reviewing them
 *   against a global forbidden list.
 *
 * The model is:
 *   - Per-entity list of fields the AI must not be able to write.
 *   - Three classes:
 *       a. Privilege escalation (role, isSuperAdmin, etc.)
 *       b. Cross-tenant moves (domainId, institutionId, ownerId)
 *       c. Hard delete / lifecycle flags that bypass soft-delete
 *          (deletedAt unless gated, isPublished gates, etc.)
 *   - The accompanying meta-test
 *     (`tests/lib/admin-tools-no-forbidden-fields.test.ts`) walks
 *     `ADMIN_TOOLS` and fails CI if any tool schema exposes a forbidden
 *     field. Adding a new entry here automatically protects every AI
 *     tool — past, present, and future.
 *
 * Entity key naming convention:
 *   Tools are named `<verb>_<entity>` (e.g. `update_caller`,
 *   `update_playbook_config`, `update_domain`). The meta-test matches
 *   the entity suffix to the key here, falling back to a no-op when the
 *   tool name doesn't fit the pattern (the failure mode is permissive,
 *   not strict — but the test prints a warning so misnamed tools surface).
 */

export const AI_FORBIDDEN_FIELDS: Record<string, readonly string[]> = {
  // Caller — User-like role enum, cross-tenant move, hard FK to a User.
  // Note: `archive` IS allowed (soft-delete via archivedAt is reversible
  // and is the documented learner-lifecycle action). `cohortGroupId` is
  // allowed (per-cohort moves are non-privileged organisational changes).
  caller: ["role", "domainId", "userId", "deletedAt"],

  // Playbook — institution boundary + publication gating.
  // `update_playbook_meta` and `update_playbook_config` both write to
  // Playbook rows; both must be blocked from these fields. Publish/unpublish
  // is a human-only flow (status enum DRAFT ↔ PUBLISHED through the UI).
  playbook: ["domainId", "status", "publishedAt", "deletedAt"],

  // Domain — tenant ownership, billing, and the user→domain admin link.
  // `update_domain` exists for cosmetic edits (name, description);
  // ownership and tier moves are human-only via the platform admin UI.
  domain: ["ownerId", "billingTier", "deletedAt", "createdById"],

  // AnalysisSpec — locked rows are the canonical seed; AI must not flip
  // isLocked off to mutate them. isActive can be toggled (it's the
  // documented enable/disable flow). scope/specRole are seeds that drive
  // pipeline behaviour and should not be re-typed at runtime.
  spec: ["isLocked", "scope", "specRole", "deletedAt"],

  // CurriculumModule — slug is the per-parent identity used by AGGREGATE
  // mastery keys (#411/#614). Renaming via AI would orphan downstream
  // `lo_mastery:{moduleId}:*` keys.
  curriculum_module: ["slug", "curriculumId", "deletedAt"],

  // LearningObjective — ref is the per-module identity used by
  // ContentAssertion soft-FK; changing it through AI would silently
  // break assertion linkage.
  learning_objective: ["ref", "moduleId", "deletedAt"],

  // SystemSetting — global / cross-tenant configuration. No AI tool
  // currently writes to this table; this entry is a tripwire so any future
  // `update_system_setting`-style tool that exposes one of these keys to
  // the model gets caught by the meta-test. (#599 Slice 1.)
  //
  // `prior_call_recap.allowlist` gates which playbooks receive the
  // AI-synthesized recap path — it must remain an ops-admin-only knob so
  // synthesis cannot be unblocked from the chat surface. See the loader
  // gate in lib/prompt/composition/loaders/priorCallFeedback.ts.
  system_setting: ["prior_call_recap.allowlist"],
};

/**
 * Map a tool name to an entity key. Convention: `<verb>_<entity>` with
 * snake_case entity. Multi-word entities like `playbook_config` collapse
 * to `playbook` (the table being written), `analysis_spec` to `spec`.
 *
 * Returns null when the tool doesn't follow the naming convention —
 * callers should treat that as "no rule registered, allow" but the
 * meta-test logs a warning.
 */
export function toolNameToEntityKey(toolName: string): string | null {
  const m = toolName.match(/^(?:update|delete|create|set|add|remove|archive|restore)_(.+)$/);
  if (!m) return null;
  const entity = m[1];

  // Collapse known multi-word tools to the table they write to.
  if (entity === "playbook_config" || entity === "playbook_meta") return "playbook";
  if (entity === "analysis_spec" || entity === "spec_config") return "spec";
  if (entity === "curriculum_metadata") return "curriculum_module";

  return entity;
}
