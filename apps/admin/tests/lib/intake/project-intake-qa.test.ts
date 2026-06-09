// project-intake-qa unit tests — epic #1338 Slice 2 (#1343).

import { describe, it, expect, vi } from "vitest";
import {
  buildIntakeQAProjections,
  writeIntakeQAProjections,
} from "@/lib/intake/project-intake-qa";

describe("buildIntakeQAProjections", () => {
  it("emits q:/a: pairs for captured fields with spec labels", () => {
    const projections = buildIntakeQAProjections({
      firstName: "Bertie",
      lastName: "Tallstaff",
      email: "bertie@example.com",
    });
    expect(projections.length).toBe(6); // 3 fields × 2 rows
    // q: rows carry the human-readable label from the spec
    expect(projections).toContainEqual({
      key: "q:firstName",
      scope: "INTAKE_CHAT",
      stringValue: "First name",
    });
    expect(projections).toContainEqual({
      key: "a:firstName",
      scope: "INTAKE_CHAT",
      stringValue: "Bertie",
    });
    expect(projections).toContainEqual({
      key: "q:email",
      scope: "INTAKE_CHAT",
      stringValue: "Email",
    });
    expect(projections).toContainEqual({
      key: "a:email",
      scope: "INTAKE_CHAT",
      stringValue: "bertie@example.com",
    });
  });

  it("skips internal fields (classroomToken, processesArt9, etc.)", () => {
    const projections = buildIntakeQAProjections({
      firstName: "Bertie",
      classroomToken: "secret-token-abc",
      processesArt9: false,
    });
    expect(projections.length).toBe(2); // only firstName q/a
    expect(projections.every((p) => !p.key.includes("classroomToken"))).toBe(true);
    expect(projections.every((p) => !p.key.includes("processesArt9"))).toBe(true);
  });

  it("skips null, undefined, and empty-string values", () => {
    const projections = buildIntakeQAProjections({
      firstName: "Bertie",
      lastName: "",
      email: null,
      phone: undefined,
    });
    expect(projections.length).toBe(2); // only firstName q/a
  });

  it("trims surrounding whitespace from string values", () => {
    const projections = buildIntakeQAProjections({
      firstName: "  Bertie  ",
    });
    expect(projections).toContainEqual({
      key: "a:firstName",
      scope: "INTAKE_CHAT",
      stringValue: "Bertie",
    });
  });

  it("falls back to the bare key for fields with no spec label", () => {
    const projections = buildIntakeQAProjections({
      unknownField: "value",
    });
    expect(projections).toContainEqual({
      key: "q:unknownField",
      scope: "INTAKE_CHAT",
      stringValue: "unknownField",
    });
  });

  it("serialises booleans and numbers to strings", () => {
    const projections = buildIntakeQAProjections({
      marketingOptIn: true,
      timezone: "Europe/London",
    });
    const ans = projections.filter((p) => p.key.startsWith("a:"));
    expect(ans).toContainEqual({
      key: "a:marketingOptIn",
      scope: "INTAKE_CHAT",
      stringValue: "true",
    });
    expect(ans).toContainEqual({
      key: "a:timezone",
      scope: "INTAKE_CHAT",
      stringValue: "Europe/London",
    });
  });
});

describe("writeIntakeQAProjections", () => {
  it("upserts each projection idempotently", async () => {
    const upsert = vi.fn(async () => ({}));
    const prismaStub = { callerAttribute: { upsert } } as unknown as Parameters<
      typeof writeIntakeQAProjections
    >[0];

    const count = await writeIntakeQAProjections(prismaStub, "caller-1", {
      firstName: "Bertie",
      email: "bertie@example.com",
    });
    expect(count).toBe(4); // 2 fields × 2 rows
    expect(upsert).toHaveBeenCalledTimes(4);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          callerId_key_scope: expect.objectContaining({
            callerId: "caller-1",
            scope: "INTAKE_CHAT",
          }),
        }),
        create: expect.objectContaining({
          callerId: "caller-1",
          scope: "INTAKE_CHAT",
          valueType: "STRING",
          sourceSpecSlug: "EnrollmentIntake",
        }),
      }),
    );
  });

  it("returns zero when given an empty snapshot", async () => {
    const upsert = vi.fn(async () => ({}));
    const prismaStub = { callerAttribute: { upsert } } as unknown as Parameters<
      typeof writeIntakeQAProjections
    >[0];
    const count = await writeIntakeQAProjections(prismaStub, "caller-1", {});
    expect(count).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
