/**
 * Tests for the conversationArtifacts loader (#1642 — Epic #1606 Group A.5).
 *
 * Pins the BA-decided contract:
 *   - Status filter: DELIVERED + READ only (PENDING, SENT, FAILED excluded)
 *   - Scope: most-recent prior call only (currentCallId excluded)
 *   - Empty path: Call 1 / no prior call / no DELIVERED artifacts on prior call
 */

import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  EMPTY_CONVERSATION_ARTIFACTS,
  loadConversationArtifacts,
} from "@/lib/prompt/composition/loaders/conversationArtifacts";

type MockCall = { id: string; createdAt: Date };
type MockArtifact = {
  id: string;
  type: string;
  title: string;
  content: string;
  confidence: number;
  deliveredAt: Date | null;
};

type LoaderPrisma = Pick<PrismaClient, "call" | "conversationArtifact">;

function makePrisma(opts: {
  priorCall?: MockCall | null;
  artifactRows?: MockArtifact[];
  captureFindFirstArgs?: (args: unknown) => void;
  captureArtifactArgs?: (args: unknown) => void;
}): LoaderPrisma {
  return {
    call: {
      findFirst: vi.fn(async (args: unknown) => {
        opts.captureFindFirstArgs?.(args);
        return opts.priorCall ?? null;
      }),
    },
    conversationArtifact: {
      findMany: vi.fn(async (args: unknown) => {
        opts.captureArtifactArgs?.(args);
        return opts.artifactRows ?? [];
      }),
    },
  } as unknown as LoaderPrisma;
}

describe("loadConversationArtifacts", () => {
  it("returns the empty shape when callerId is missing", async () => {
    const prisma = makePrisma({});
    const result = await loadConversationArtifacts(prisma, { callerId: "" });
    expect(result).toEqual(EMPTY_CONVERSATION_ARTIFACTS);
    expect(prisma.call.findFirst).not.toHaveBeenCalled();
  });

  it("returns the empty shape when there is no prior call (Call 1 path)", async () => {
    const prisma = makePrisma({ priorCall: null });
    const result = await loadConversationArtifacts(prisma, { callerId: "caller-1" });
    expect(result).toEqual(EMPTY_CONVERSATION_ARTIFACTS);
    expect(prisma.conversationArtifact.findMany).not.toHaveBeenCalled();
  });

  it("returns hasArtifacts=false but populates lastCallId when the prior call had no DELIVERED artifacts", async () => {
    const priorCall: MockCall = {
      id: "call-prior",
      createdAt: new Date("2026-06-13T10:00:00Z"),
    };
    const prisma = makePrisma({ priorCall, artifactRows: [] });
    const result = await loadConversationArtifacts(prisma, { callerId: "caller-1" });
    expect(result.hasArtifacts).toBe(false);
    expect(result.lastCallId).toBe("call-prior");
    expect(result.lastCallAt).toBe("2026-06-13T10:00:00.000Z");
    expect(result.artifacts).toEqual([]);
  });

  it("returns DELIVERED + READ artifacts shaped for the prompt", async () => {
    const priorCall: MockCall = {
      id: "call-prior",
      createdAt: new Date("2026-06-13T10:00:00Z"),
    };
    const artifactRows: MockArtifact[] = [
      {
        id: "art-1",
        type: "KEY_FACT",
        title: "Pythagoras",
        content: "a² + b² = c²",
        confidence: 0.92,
        deliveredAt: new Date("2026-06-13T10:15:00Z"),
      },
      {
        id: "art-2",
        type: "STUDY_NOTE",
        title: "Right triangle",
        content: "Use Pythagoras to find hypotenuse",
        confidence: 0.8,
        deliveredAt: new Date("2026-06-13T10:14:00Z"),
      },
    ];
    const prisma = makePrisma({ priorCall, artifactRows });
    const result = await loadConversationArtifacts(prisma, { callerId: "caller-1" });

    expect(result.hasArtifacts).toBe(true);
    expect(result.lastCallId).toBe("call-prior");
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]).toMatchObject({
      id: "art-1",
      type: "KEY_FACT",
      title: "Pythagoras",
      snippet: "a² + b² = c²",
      confidence: 0.92,
      deliveredAt: "2026-06-13T10:15:00.000Z",
    });
  });

  it("scopes the Prisma artifact query to status IN ['DELIVERED','READ']", async () => {
    const priorCall: MockCall = {
      id: "call-prior",
      createdAt: new Date("2026-06-13T10:00:00Z"),
    };
    const capture = vi.fn();
    const prisma = makePrisma({
      priorCall,
      artifactRows: [],
      captureArtifactArgs: capture,
    });
    await loadConversationArtifacts(prisma, { callerId: "caller-1" });

    expect(capture).toHaveBeenCalledOnce();
    const args = capture.mock.calls[0][0] as { where: { status: { in: string[] } } };
    expect(args.where.status.in).toEqual(["DELIVERED", "READ"]);
  });

  it("excludes currentCallId from the prior-call lookup", async () => {
    const capture = vi.fn();
    const prisma = makePrisma({
      priorCall: null,
      captureFindFirstArgs: capture,
    });
    await loadConversationArtifacts(prisma, {
      callerId: "caller-1",
      currentCallId: "call-current",
    });

    const args = capture.mock.calls[0][0] as {
      where: { id?: { not: string } };
    };
    expect(args.where.id).toEqual({ not: "call-current" });
  });

  it("omits the id-not filter when currentCallId is absent", async () => {
    const capture = vi.fn();
    const prisma = makePrisma({
      priorCall: null,
      captureFindFirstArgs: capture,
    });
    await loadConversationArtifacts(prisma, { callerId: "caller-1" });

    const args = capture.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where.id).toBeUndefined();
  });

  it("truncates long content to a snippet (≤200 chars) with an ellipsis", async () => {
    const priorCall: MockCall = {
      id: "call-prior",
      createdAt: new Date("2026-06-13T10:00:00Z"),
    };
    const longContent = "x".repeat(500);
    const prisma = makePrisma({
      priorCall,
      artifactRows: [
        {
          id: "art-1",
          type: "STUDY_NOTE",
          title: "Long one",
          content: longContent,
          confidence: 0.8,
          deliveredAt: null,
        },
      ],
    });
    const result = await loadConversationArtifacts(prisma, { callerId: "caller-1" });

    expect(result.artifacts[0].snippet.length).toBeLessThanOrEqual(200);
    expect(result.artifacts[0].snippet.endsWith("…")).toBe(true);
  });
});
