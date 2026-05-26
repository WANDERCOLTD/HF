/**
 * Regression — AI must not be able to escalate caller roles or move
 * callers across institutions via the chat assistant.
 *
 * Triggered by 2026-05-26 sandbox demo: a user typed "change Brynn's role
 * to admin" in the Assistant tab and the `update_caller` tool fired
 * because its input_schema declared `role` with the full enum. The
 * handler unconditionally wrote `data.role = input.role` to prisma.
 *
 * Defence is layered:
 *   1. Schema-level: `role` and `domainId` are NOT in
 *      `update_caller.input_schema.properties`, so the model can't pass
 *      them in a tool call.
 *   2. Handler-level: even if a future schema adds them back, or a
 *      malformed call slips through, the handler ignores both fields and
 *      logs a warning.
 *
 * This test exercises both layers without needing the full Prisma mock
 * harness used by admin-tools.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ADMIN_TOOLS } from "../../lib/chat/admin-tools";

describe("update_caller — no role escalation, no cross-tenant move", () => {
  describe("schema layer", () => {
    const updateCaller = ADMIN_TOOLS.find((t) => t.name === "update_caller");

    it("update_caller tool exists in the catalogue", () => {
      expect(updateCaller).toBeDefined();
    });

    it("update_caller schema does NOT expose `role`", () => {
      const props = updateCaller?.input_schema.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty("role");
    });

    it("update_caller schema does NOT expose `domainId`", () => {
      const props = updateCaller?.input_schema.properties as Record<string, unknown>;
      expect(props).not.toHaveProperty("domainId");
    });

    it("update_caller description warns that role + domainId are deliberately excluded", () => {
      expect(updateCaller?.description).toMatch(/role.*not.*AI-accessible/i);
    });
  });

  describe("handler layer — defence in depth", () => {
    const updateMock = vi.fn();
    const findUniqueMock = vi.fn();

    beforeEach(() => {
      updateMock.mockReset();
      findUniqueMock.mockReset();
      findUniqueMock.mockResolvedValue({ id: "c-1", name: "Brynn" });
      updateMock.mockResolvedValue({
        id: "c-1",
        name: "Brynn",
        email: null,
        phone: null,
        role: "STUDENT",
        archivedAt: null,
        domainId: "d-1",
        cohortGroupId: null,
      });

      vi.doMock("@/lib/prisma", () => ({
        prisma: {
          caller: { findUnique: findUniqueMock, update: updateMock },
        },
        db: (tx?: unknown) => tx ?? { caller: { findUnique: findUniqueMock, update: updateMock } },
      }));
    });

    it("strips `role` and `domainId` from prisma update payload even if passed in tool input", async () => {
      const mod = await import("../../lib/chat/admin-tool-handlers");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await mod.executeAdminTool(
        "update_caller",
        {
          caller_id: "c-1",
          name: "Brynn M.",
          role: "ADMIN",
          domainId: "different-tenant",
          reason: "regression test",
        },
        "OPERATOR",
      );

      // The handler must have called prisma.caller.update without role/domainId
      expect(updateMock).toHaveBeenCalledTimes(1);
      const updateArgs = updateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(updateArgs.data).not.toHaveProperty("role");
      expect(updateArgs.data).not.toHaveProperty("domainId");
      expect(updateArgs.data).toHaveProperty("name", "Brynn M.");
      // Warning was logged so an operator-watching-logs can spot anomalies.
      expect(warn).toHaveBeenCalled();
      const warning = String(warn.mock.calls[0]?.[0] ?? "");
      expect(warning).toMatch(/role/);
      expect(warning).toMatch(/domainId/);
      // Result is still ok=true (name update succeeded) — the privileged
      // fields are silently dropped, not the whole operation.
      const parsed = JSON.parse(String(result));
      expect(parsed.ok).toBe(true);
      warn.mockRestore();
    });
  });
});
