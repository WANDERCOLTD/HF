import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensurePrimaryPlaybookLink } from "@/lib/curriculum/ensure-primary-playbook-link";

describe("ensurePrimaryPlaybookLink", () => {
  let tx: { playbookCurriculum: { upsert: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    tx = {
      playbookCurriculum: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
  });

  it("upserts with create=primary, update={} for canonical idempotent write", async () => {
    await ensurePrimaryPlaybookLink(
      tx as never,
      "pb-1",
      "curr-1",
    );

    expect(tx.playbookCurriculum.upsert).toHaveBeenCalledTimes(1);
    expect(tx.playbookCurriculum.upsert).toHaveBeenCalledWith({
      where: {
        playbookId_curriculumId: { playbookId: "pb-1", curriculumId: "curr-1" },
      },
      create: { playbookId: "pb-1", curriculumId: "curr-1", role: "primary" },
      update: {},
    });
  });

  it("does NOT clobber an existing row's role (update is {})", async () => {
    // If a row already exists as role='linked' (variant), the upsert update={}
    // means we leave it alone. This is the load-bearing invariant for CC-A.
    await ensurePrimaryPlaybookLink(tx as never, "pb-1", "curr-1");
    const call = tx.playbookCurriculum.upsert.mock.calls[0][0];
    expect(call.update).toEqual({});
  });

  it("throws when playbookId is empty", async () => {
    await expect(
      ensurePrimaryPlaybookLink(tx as never, "", "curr-1"),
    ).rejects.toThrow(/playbookId and curriculumId required/);
    expect(tx.playbookCurriculum.upsert).not.toHaveBeenCalled();
  });

  it("throws when curriculumId is empty", async () => {
    await expect(
      ensurePrimaryPlaybookLink(tx as never, "pb-1", ""),
    ).rejects.toThrow(/playbookId and curriculumId required/);
    expect(tx.playbookCurriculum.upsert).not.toHaveBeenCalled();
  });
});
