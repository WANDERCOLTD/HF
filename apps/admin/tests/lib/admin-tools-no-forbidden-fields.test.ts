/**
 * META-GUARD — every AI tool's input_schema is checked against the
 * central `AI_FORBIDDEN_FIELDS` registry. Fails CI if a new tool exposes
 * `role`, `domainId`, or any other field flagged as privilege-escalation,
 * cross-tenant, or destructive.
 *
 * This is the structural answer to the 2026-05-26 incident where
 * `update_caller` shipped with `role` in its schema and an AI privilege-
 * escalation primitive went live in sandbox. Removing `role` from one
 * tool doesn't prevent the next over-permissive tool — this test does.
 */

import { describe, it, expect } from "vitest";
import { ADMIN_TOOLS } from "../../lib/chat/admin-tools";
import {
  AI_FORBIDDEN_FIELDS,
  toolNameToEntityKey,
} from "../../lib/chat/ai-forbidden-fields";

describe("ADMIN_TOOLS — no schema exposes globally forbidden fields", () => {
  for (const tool of ADMIN_TOOLS) {
    const entityKey = toolNameToEntityKey(tool.name);
    if (!entityKey) continue;
    const forbidden = AI_FORBIDDEN_FIELDS[entityKey];
    if (!forbidden) continue;

    for (const field of forbidden) {
      it(`${tool.name} does NOT expose forbidden field \`${field}\` (entity: ${entityKey})`, () => {
        const props = (tool.input_schema?.properties ?? {}) as Record<string, unknown>;
        expect(
          props,
          `Tool "${tool.name}" exposes "${field}" in its input_schema.properties. ` +
            `${field} is in AI_FORBIDDEN_FIELDS["${entityKey}"]. ` +
            `Either remove the field from the tool schema OR (if the field genuinely should be AI-writable) ` +
            `remove it from AI_FORBIDDEN_FIELDS with a comment explaining why. ` +
            `Do NOT relax this rule silently — privilege escalation, cross-tenant moves, and hard deletes ` +
            `should always be human-only.`,
        ).not.toHaveProperty(field);
      });
    }
  }

  it("AI_FORBIDDEN_FIELDS registry has at least the canonical entries (sanity check)", () => {
    expect(AI_FORBIDDEN_FIELDS.caller).toContain("role");
    expect(AI_FORBIDDEN_FIELDS.caller).toContain("domainId");
    expect(AI_FORBIDDEN_FIELDS.playbook).toContain("domainId");
    expect(AI_FORBIDDEN_FIELDS.playbook).toContain("status");
    expect(AI_FORBIDDEN_FIELDS.domain).toContain("ownerId");
    expect(AI_FORBIDDEN_FIELDS.spec).toContain("isLocked");
  });
});

/**
 * RBAC structural guard — every tool in the catalogue must declare a
 * minimum role. A tool without a `TOOL_MIN_ROLE` entry falls through the
 * per-tool RBAC check at `admin-tool-handlers.ts:121-124` silently and
 * runs with no auth gate (in the AI context — the API route's own
 * `requireAuth` still gates the request itself, but the per-tool tier is
 * lost). This test ensures every new tool added to ADMIN_TOOLS has a
 * conscious decision about who can call it.
 *
 * To add a new tool: add it to ADMIN_TOOLS *and* set TOOL_MIN_ROLE[name].
 * If the new tool should be SUPERADMIN-only (e.g. system_ini_check),
 * state it explicitly — don't default to OPERATOR.
 */
describe("ADMIN_TOOLS — every tool has a minimum-role entry (RBAC structural)", () => {
  // We export TOOL_MIN_ROLE indirectly via a probe: call executeAdminTool
  // with a deliberately-low role (DEMO=0) for each tool and expect either
  // "Insufficient permissions" (RBAC fired) or "Unknown tool" (the tool
  // isn't actually wired in the dispatch yet). Anything else — including a
  // successful execution attempt — means RBAC is missing.
  //
  // Note: this is a meta-test on the *enforcement path*, not just the
  // table. A row in TOOL_MIN_ROLE without a matching switch case in
  // dispatch returns "Unknown tool", which is also acceptable here (the
  // tool isn't callable at all).
  for (const tool of ADMIN_TOOLS) {
    it(`${tool.name} blocks DEMO-tier callers (per-tool RBAC fires)`, async () => {
      const { executeAdminTool } = await import("../../lib/chat/admin-tool-handlers");
      // Pass a minimal-but-shape-valid input — we don't care about
      // result correctness, only that the RBAC check fires before any
      // handler runs.
      const result = await executeAdminTool(
        tool.name,
        { reason: "rbac probe" },
        "DEMO" as never,
      );
      const parsed = JSON.parse(String(result));
      const err = String(parsed.error ?? "");
      const acceptable =
        /Insufficient permissions/.test(err) || /Unknown tool/.test(err);
      expect(
        acceptable,
        `Tool "${tool.name}" did NOT block a DEMO-tier caller. ` +
          `Expected "Insufficient permissions" or "Unknown tool", got: ${err || JSON.stringify(parsed)}. ` +
          `Either add an entry to TOOL_MIN_ROLE in apps/admin/lib/chat/admin-tool-handlers.ts ` +
          `OR remove the tool from ADMIN_TOOLS until it has a conscious RBAC tier.`,
      ).toBe(true);
    });
  }
});
