import { NextResponse } from "next/server";
import { MemoryCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { resolveCallerScopeForReading, isScopeError } from "@/lib/learner-scope";
import { parsePagination } from "@/lib/api-utils";

/**
 * @api GET /api/memories
 * @visibility public
 * @scope memories:read
 * @auth session
 * @tags memories
 * @description List caller memories with filtering and pagination. By default excludes superseded and expired memories. Supports search across key, value, and evidence fields.
 * @query callerId string - Filter by caller ID (optional)
 * @query category string - Filter by MemoryCategory (FACT | PREFERENCE | EVENT | TOPIC | RELATIONSHIP | CONTEXT) (optional)
 * @query search string - Full-text search across key, value, evidence (optional)
 * @query includeSuperseded string - Include superseded memories ("true" to include, default false)
 * @query limit number - Max results to return (default 100, max 500)
 * @query offset number - Pagination offset (default 0)
 * @response 200 { ok: true, memories: [...], total: number, limit: number, offset: number }
 * @response 500 { ok: false, error: "Failed to fetch memories" }
 */
export async function GET(req: Request) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const url = new URL(req.url);
    const requestedCallerId = url.searchParams.get("callerId");
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search");
    const includeSuperseded = url.searchParams.get("includeSuperseded") === "true";
    const { limit, offset } = parsePagination(url.searchParams);

    const scope = await resolveCallerScopeForReading(authResult.session, requestedCallerId);
    if (isScopeError(scope)) return scope.error;
    const callerId = scope.scopedCallerId;

    const where: any = {};

    // Filter by callerId
    if (callerId) {
      where.callerId = callerId;
    }

    // Filter by category
    if (category && category in MemoryCategory) {
      where.category = category as MemoryCategory;
    }

    // Search in key or value
    if (search) {
      where.OR = [
        { key: { contains: search, mode: "insensitive" } },
        { value: { contains: search, mode: "insensitive" } },
        { evidence: { contains: search, mode: "insensitive" } },
      ];
    }

    // By default, exclude superseded memories
    if (!includeSuperseded) {
      where.supersededById = null;
    }

    // Also exclude expired memories by default
    where.OR = [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ];

    const [memories, total] = await Promise.all([
      prisma.callerMemory.findMany({
        where,
        orderBy: [{ extractedAt: "desc" }],
        take: limit,
        skip: offset,
        include: {
          caller: {
            select: { id: true, name: true, email: true, externalId: true },
          },
          call: {
            select: { id: true, source: true, createdAt: true },
          },
          supersededBy: {
            select: { id: true, key: true, value: true, extractedAt: true },
          },
        },
      }),
      prisma.callerMemory.count({ where }),
    ]);

    return NextResponse.json({
      ok: true,
      memories,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("Error fetching memories:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch memories" },
      { status: 500 }
    );
  }
}

/**
 * @api POST /api/memories
 * @visibility public
 * @scope memories:write
 * @auth session
 * @tags memories
 * @description Create a new memory manually for a caller. Handles deduplication: if a memory with the same normalized key exists, it either supersedes the old value or updates confidence if the value matches.
 * @body callerId string - The caller this memory belongs to (required)
 * @body category string - MemoryCategory enum value (required)
 * @body key string - Memory key/label (required)
 * @body value string - Memory value (required)
 * @body evidence string - Supporting evidence text (optional)
 * @body context string - Context in which the memory was captured (optional)
 * @body confidence number - Confidence score 0-1 (default 0.95 for manual entries)
 * @body expiresInDays number - Auto-expire after N days (optional, null = never)
 * @response 200 { ok: true, memory: {...}, supersededId: string|null }
 * @response 400 { ok: false, error: "callerId is required" }
 * @response 404 { ok: false, error: "Caller not found" }
 * @response 500 { ok: false, error: "Failed to create memory" }
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await req.json();
    const { callerId, category, key, value, evidence, context, confidence, expiresInDays } = body;

    if (!callerId) {
      return NextResponse.json(
        { ok: false, error: "callerId is required" },
        { status: 400 }
      );
    }

    if (!category || !(category in MemoryCategory)) {
      return NextResponse.json(
        { ok: false, error: "Valid category is required (FACT, PREFERENCE, EVENT, TOPIC, RELATIONSHIP, CONTEXT)" },
        { status: 400 }
      );
    }

    if (!key || !value) {
      return NextResponse.json(
        { ok: false, error: "key and value are required" },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await prisma.caller.findUnique({ where: { id: callerId } });
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Caller not found" },
        { status: 404 }
      );
    }

    // Check for existing memory with same normalized key
    const normalizedKey = key.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
    const existing = await prisma.callerMemory.findFirst({
      where: {
        callerId,
        normalizedKey,
        supersededById: null,
      },
    });

    let memory;
    let supersededId = null;

    if (existing && existing.value !== value) {
      // Create new memory and supersede old one
      memory = await prisma.callerMemory.create({
        data: {
          callerId,
          category: category as MemoryCategory,
          source: "CORRECTED", // Manual correction
          key,
          value,
          normalizedKey,
          evidence,
          context,
          confidence: confidence ?? 0.95, // High confidence for manual entries
          expiresAt: expiresInDays
            ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
            : null,
          extractedBy: "manual",
        },
      });

      await prisma.callerMemory.update({
        where: { id: existing.id },
        data: { supersededById: memory.id },
      });

      supersededId = existing.id;
    } else if (existing) {
      // Same value, just update confidence
      memory = await prisma.callerMemory.update({
        where: { id: existing.id },
        data: {
          confidence: Math.max(existing.confidence, confidence ?? 0.95),
          verifiedAt: new Date(),
          verifiedBy: "manual",
        },
      });
    } else {
      // New memory
      memory = await prisma.callerMemory.create({
        data: {
          callerId,
          category: category as MemoryCategory,
          source: "STATED", // Explicit addition
          key,
          value,
          normalizedKey,
          evidence,
          context,
          confidence: confidence ?? 0.95,
          expiresAt: expiresInDays
            ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
            : null,
          extractedBy: "manual",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      memory,
      supersededId,
    });
  } catch (error: any) {
    console.error("Error creating memory:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create memory" },
      { status: 500 }
    );
  }
}
