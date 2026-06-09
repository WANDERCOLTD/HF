/**
 * Tests for `POST /api/voice/calls/start` body schema (#1391).
 *
 * Pins the schema-level contract for the WebRTC picker pipe-through:
 *
 *   - `requestedModuleId` is optional (not required for legacy callers)
 *   - when present, it's a 1–128-char string forwarded to
 *     `createCallEnteringPipeline` (`callerId,requestedModuleId` cascade)
 *   - bad shapes are rejected:
 *       - empty string  (min(1))
 *       - >128 chars    (max(128))
 *       - non-string    (z.string())
 *   - strict() rejects unknown fields, so an accidental misspelling
 *     (`moduleId` etc.) doesn't silently pass through
 *
 * This is the unit gate — the route's behavioural test (the builder
 * actually receives the field) is covered by manual smoke until a
 * route-level integration suite lands.
 */

import { describe, expect, it } from "vitest";
import { bodySchema } from "@/app/api/voice/calls/start/route";

describe("POST /api/voice/calls/start — body schema (#1391)", () => {
  it("accepts a body without requestedModuleId (back-compat)", () => {
    const r = bodySchema.safeParse({ callerId: "abc" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.requestedModuleId).toBeUndefined();
    }
  });

  it("accepts a body with requestedModuleId as a slug", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      requestedModuleId: "part-1-familiar-topics",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.requestedModuleId).toBe("part-1-familiar-topics");
    }
  });

  it("accepts a body with requestedModuleId as a UUID-shaped id", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      requestedModuleId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty-string requestedModuleId (min length 1)", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      requestedModuleId: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a requestedModuleId >128 chars", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      requestedModuleId: "x".repeat(129),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-string requestedModuleId", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      requestedModuleId: 42 as unknown as string,
    });
    expect(r.success).toBe(false);
  });

  it("strict() blocks `moduleId` misspelling (catches future typos)", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      moduleId: "part-1-familiar-topics",
    });
    expect(r.success).toBe(false);
  });

  it("strict() blocks `requested_module_id` snake_case (wrong casing)", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      requested_module_id: "part-1-familiar-topics",
    });
    expect(r.success).toBe(false);
  });

  it("requestedModuleId combines with intent + overrideProviderSlug", () => {
    const r = bodySchema.safeParse({
      callerId: "abc",
      intent: "chat",
      overrideProviderSlug: "vapi",
      requestedModuleId: "module-2",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({
        callerId: "abc",
        intent: "chat",
        overrideProviderSlug: "vapi",
        requestedModuleId: "module-2",
      });
    }
  });
});
