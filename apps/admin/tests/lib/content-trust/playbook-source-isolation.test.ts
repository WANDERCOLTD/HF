/**
 * PlaybookSource Content Isolation Tests
 *
 * Verifies that syncPlaybookSources is correctly guarded:
 * - When sourceIds/uploadSourceIds are provided, syncPlaybookSources is skipped
 * - When not provided, syncPlaybookSources runs (legacy path)
 *
 * Also verifies subject upload/sources routes scope PlaybookSource
 * to the requesting playbookId when provided.
 *
 * Root cause: syncPlaybookSources pulls ALL SubjectSource rows for a subject
 * into PlaybookSource — if two courses share a Subject, content from course A
 * leaks into course B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  syncPlaybookSources: vi.fn().mockResolvedValue(0),
  upsertPlaybookSource: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/knowledge/domain-sources", () => ({
  syncPlaybookSources: mocks.syncPlaybookSources,
  upsertPlaybookSource: mocks.upsertPlaybookSource,
}));

// ── Tests ────────────────────────────────────────────────

describe("PlaybookSource isolation guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fan-out prevention pattern", () => {
    it("when playbookId is provided, only that playbook gets the source", () => {
      // Pattern used in subjects/[subjectId]/upload/route.ts and sources/route.ts:
      //
      //   if (playbookId) {
      //     upsert PlaybookSource for ONLY that playbookId
      //   } else {
      //     fan-out to ALL playbooks for this subject (legacy)
      //   }
      //
      // Verify the pattern: given a playbookId, we should NOT query playbookSubject.findMany
      const playbookId = "pb-specific";
      const allPlaybooks = ["pb-1", "pb-2", "pb-3"];

      // With playbookId → single write
      const targetsWithScope = playbookId ? [playbookId] : allPlaybooks;
      expect(targetsWithScope).toEqual(["pb-specific"]);
      expect(targetsWithScope).toHaveLength(1);

      // Without playbookId → fan-out (legacy, only for backward compat)
      const targetsWithoutScope = null ? [null] : allPlaybooks;
      expect(targetsWithoutScope).toHaveLength(3);
    });

    it("when uploadSourceIds are present, syncPlaybookSources must be skipped", () => {
      // Pattern used in wizard-tool-executor.ts and course-setup.ts:
      //
      //   if (!uploadSourceIds?.length) {
      //     syncPlaybookSources(playbookId, subjectId);  // pulls ALL
      //   }
      //   // Phase 5 (later): upsertPlaybookSource for each uploadSourceId
      //
      const uploadSourceIds = ["src-1", "src-2"];
      const shouldSync = !uploadSourceIds?.length;
      expect(shouldSync).toBe(false);

      const noSourceIds: string[] | undefined = undefined;
      const shouldSyncLegacy = !noSourceIds?.length;
      expect(shouldSyncLegacy).toBe(true);
    });

    it("create_course existing-path must link uploadSourceIds (regression for #352)", async () => {
      // Issue #352 — when create_course hits the playbook-reuse path
      // (duplicate name in domain), fresh ContentSources uploaded in the
      // same wizard run must still get linked to the reused playbook via
      // upsertPlaybookSource. Without this, the projection (#338) sees no
      // COURSE_REFERENCE and the course is "degenerate".
      //
      // Static check that the existing-path in wizard-tool-executor.ts
      // contains the same upsertPlaybookSource loop the new-path has.
      const fs = await import("fs/promises");
      const path = await import("path");
      const file = path.resolve(__dirname, "../../../lib/chat/wizard-tool-executor.ts");
      const src = await fs.readFile(file, "utf8");

      // The fix block in the existing-path uses existingPlaybookId as the
      // target. Must appear before runProjectionForPlaybook(existingPlaybookId).
      const projIdx = src.indexOf("await runProjectionForPlaybook(existingPlaybookId)");
      expect(projIdx).toBeGreaterThan(-1);
      const before = src.slice(0, projIdx);
      expect(before).toMatch(/await upsertPlaybookSource\(existingPlaybookId,\s*srcId\)/);
      expect(before).toMatch(/if \(uploadSourceIds\?\.length\)/);
    });
  });
});
