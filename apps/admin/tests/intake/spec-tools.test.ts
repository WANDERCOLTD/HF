// Spec-driven tool calling — items 12+13 adoption tests.
//
// Validates that:
//  - The `update-setup` tool faithfully reflects the EnrollmentIntake spec
//    (user-facing fields only, internal fields excluded).
//  - applyUpdateSetup writes through the same setValue path as the
//    deterministic FSM, with type + .validates() + enum-options guards.
//  - Multi-field paste captures atomically in a single tool call —
//    fixes the "last name: yes" pre-fix bug class.

import { describe, expect, it } from "vitest";
import {
  applyUpdateSetup,
  specToUpdateSetupTool,
  UPDATE_SETUP_TOOL_NAME,
} from "@/lib/intake/spec-tools";
import { EnrollmentIntake } from "@/lib/intake/specs/enrollment.intent";
import { openSession } from "@/lib/intake/session-store";
import type {
  IntentKey,
  ProjectionName,
  Tenant,
  Actor,
  TenantId,
  ActorId,
  ToolCall,
} from "@/lib/intake/tallyseal";

const INTERNAL = ["processesArt9", "art9Exemption", "classroomToken", "classroomName"] as const;

function fakeSession() {
  return openSession({
    tenant: { id: "test-tenant" as TenantId } as Tenant,
    actor: { id: "test-actor" as ActorId } as Actor,
    key: "EnrollmentIntake" as IntentKey,
    projection: "IntakeApplication" as ProjectionName,
  });
}

function fakeCall(args: Record<string, unknown>): ToolCall {
  return {
    id: `tu_${Math.random().toString(36).slice(2)}` as ToolCall["id"],
    name: UPDATE_SETUP_TOOL_NAME,
    args: args as unknown as ToolCall["args"],
    argsHash: "test" as ToolCall["argsHash"],
  };
}

describe("specToUpdateSetupTool", () => {
  it("derives a tool definition with name 'update-setup' and an object inputSchema", () => {
    const tool = specToUpdateSetupTool(EnrollmentIntake);
    expect(tool.name).toBe(UPDATE_SETUP_TOOL_NAME);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).toBeDefined();
  });

  it("includes the three required EnrollmentIntake fields", () => {
    const tool = specToUpdateSetupTool(EnrollmentIntake);
    const props = tool.inputSchema.properties as Record<string, { type: string }>;
    expect(props.firstName?.type).toBe("string");
    expect(props.lastName?.type).toBe("string");
    expect(props.email?.type).toBe("string");
  });

  it("excludes internal fields when asked", () => {
    const tool = specToUpdateSetupTool(EnrollmentIntake, { excludeFields: INTERNAL });
    const props = tool.inputSchema.properties as Record<string, unknown>;
    for (const k of INTERNAL) expect(props[k]).toBeUndefined();
  });

  it("encodes enum fields with the literal option list", () => {
    const tool = specToUpdateSetupTool(EnrollmentIntake);
    const props = tool.inputSchema.properties as Record<string, { type: string; enum?: string[] }>;
    expect(props.ageRange?.type).toBe("string");
    expect(props.ageRange?.enum).toEqual(
      expect.arrayContaining(["under-18", "18-24", "65-plus", "prefer-not-to-say"]),
    );
    expect(props.preferredContactMethod?.enum).toEqual(["email", "in-app"]);
  });

  it("encodes boolean fields as boolean type", () => {
    const tool = specToUpdateSetupTool(EnrollmentIntake);
    const props = tool.inputSchema.properties as Record<string, { type: string }>;
    expect(props.marketingOptIn?.type).toBe("boolean");
  });
});

describe("applyUpdateSetup", () => {
  it("writes a single field to the session and returns it as captured", () => {
    const session = fakeSession();
    const applied = applyUpdateSetup(
      session,
      fakeCall({ firstName: "Peter" }),
      EnrollmentIntake,
    );
    expect(applied).toEqual([{ field: "firstName", value: "Peter" }]);
    expect(session.values.firstName).toBe("Peter");
  });

  it("writes multiple fields atomically from a single tool call (fixes 'last name: yes')", () => {
    const session = fakeSession();
    const applied = applyUpdateSetup(
      session,
      fakeCall({ firstName: "Peter", lastName: "Jones", email: "peter@example.com" }),
      EnrollmentIntake,
    );
    expect(applied).toHaveLength(3);
    expect(session.values.firstName).toBe("Peter");
    expect(session.values.lastName).toBe("Jones");
    expect(session.values.email).toBe("peter@example.com");
  });

  it("drops args that fail the field's .validates() predicate (bad email)", () => {
    const session = fakeSession();
    const applied = applyUpdateSetup(
      session,
      fakeCall({ email: "not-an-email" }),
      EnrollmentIntake,
    );
    expect(applied).toEqual([]);
    expect(session.values.email).toBeUndefined();
  });

  it("drops args that don't match the field's base type", () => {
    const session = fakeSession();
    const applied = applyUpdateSetup(
      session,
      fakeCall({ marketingOptIn: "yes", ageRange: 25, firstName: 42 }),
      EnrollmentIntake,
    );
    expect(applied).toEqual([]);
    expect(session.values.marketingOptIn).toBeUndefined();
    expect(session.values.firstName).toBeUndefined();
  });

  it("drops enum values that are not in the declared option list", () => {
    const session = fakeSession();
    const applied = applyUpdateSetup(
      session,
      fakeCall({ ageRange: "newborn", preferredContactMethod: "carrier-pigeon" }),
      EnrollmentIntake,
    );
    expect(applied).toEqual([]);
    expect(session.values.ageRange).toBeUndefined();
  });

  it("ignores unknown field keys silently", () => {
    const session = fakeSession();
    const applied = applyUpdateSetup(
      session,
      fakeCall({ unicornHorn: "shiny", firstName: "Peter" }),
      EnrollmentIntake,
    );
    expect(applied).toEqual([{ field: "firstName", value: "Peter" }]);
    expect((session.values as Record<string, unknown>).unicornHorn).toBeUndefined();
  });

  it("respects excludeFields — internal fields cannot be set via tool call", () => {
    const session = fakeSession();
    const applied = applyUpdateSetup(
      session,
      fakeCall({ classroomToken: "evil-token", firstName: "Peter" }),
      EnrollmentIntake,
      { excludeFields: INTERNAL },
    );
    expect(applied).toEqual([{ field: "firstName", value: "Peter" }]);
    expect(session.values.classroomToken).toBeUndefined();
  });

  it("no-ops for tool calls whose name doesn't match update-setup", () => {
    const session = fakeSession();
    const call: ToolCall = {
      ...fakeCall({ firstName: "Peter" }),
      name: "other-tool" as ToolCall["name"],
    };
    const applied = applyUpdateSetup(session, call, EnrollmentIntake);
    expect(applied).toEqual([]);
    expect(session.values.firstName).toBeUndefined();
  });
});
