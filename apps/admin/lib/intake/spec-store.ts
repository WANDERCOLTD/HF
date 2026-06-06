// #1140 Phase 2a — IntakeSpec read/write helpers.
//
// All callers go through this module. Direct prisma.intakeSpec.* writes
// from elsewhere bypass the application-layer immutability checks; the
// DB trigger `intake_spec_published_immutable_trigger` is the structural
// fallback (see migration). Both layers must hold.
//
// Storage shape:
//   - source: TS code authored via @tallyseal/admin-editor; canonical
//     authoring form. Parsed by spec-emitter into EditableSpec at
//     editor mount. Nullable for Phase 2a rows that pre-date #1194 —
//     re-seed populates.
//   - body: JSON cache projected from source (list page reads body
//     without spec-emitter parse). Stays in sync via the adapter.
//   - status: DRAFT (mutable) | PUBLISHED (immutable post-publish)
//   - (key, version) is unique
//
// Authoring lifecycle:
//   1. createDraft(key, version) — new spec, status=DRAFT
//   2. updateDraft(id, body) — mutate body while DRAFT
//   3. publish(id, userId) — DRAFT → PUBLISHED, sets publishedAt + publishedById
//   4. Once PUBLISHED, only `status` reads pass; mutations refused by the
//      trigger AND by application-layer guards here.
//
// Consumer reads:
//   - findPublished(key) — latest PUBLISHED row for a key (consumer entry point)
//   - findById(id) — direct lookup for the editor UI

import type { IntakeSpec, IntakeSpecStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type IntakeSpecBody = Prisma.JsonValue;

export interface CreateDraftInput {
  key: string;
  version: string;
  body: IntakeSpecBody;
  source?: string | null;
  parentKey?: string | null;
  createdById?: string | null;
}

export async function createDraft(input: CreateDraftInput): Promise<IntakeSpec> {
  return prisma.intakeSpec.create({
    data: {
      key: input.key,
      version: input.version,
      body: input.body as Prisma.InputJsonValue,
      source: input.source ?? null,
      status: "DRAFT",
      parentKey: input.parentKey ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

export interface UpdateDraftInput {
  id: string;
  body: IntakeSpecBody;
  source?: string | null;
}

export async function updateDraft(input: UpdateDraftInput): Promise<IntakeSpec> {
  const existing = await prisma.intakeSpec.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new Error(`IntakeSpec ${input.id} not found`);
  }
  if (existing.status !== "DRAFT") {
    throw new Error(
      `IntakeSpec ${existing.key}/${existing.version} is ${existing.status}; only DRAFT rows are mutable`,
    );
  }
  return prisma.intakeSpec.update({
    where: { id: input.id },
    data: {
      body: input.body as Prisma.InputJsonValue,
      ...(input.source !== undefined ? { source: input.source } : {}),
    },
  });
}

export interface PublishInput {
  id: string;
  publishedById?: string | null;
}

export async function publish(input: PublishInput): Promise<IntakeSpec> {
  const existing = await prisma.intakeSpec.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new Error(`IntakeSpec ${input.id} not found`);
  }
  if (existing.status === "PUBLISHED") {
    return existing;
  }
  return prisma.intakeSpec.update({
    where: { id: input.id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      publishedById: input.publishedById ?? null,
    },
  });
}

export async function findPublished(key: string): Promise<IntakeSpec | null> {
  return prisma.intakeSpec.findFirst({
    where: { key, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
  });
}

export async function findById(id: string): Promise<IntakeSpec | null> {
  return prisma.intakeSpec.findUnique({ where: { id } });
}

export async function findByKeyVersion(
  key: string,
  version: string,
): Promise<IntakeSpec | null> {
  return prisma.intakeSpec.findUnique({ where: { key_version: { key, version } } });
}

export interface ListFilter {
  status?: IntakeSpecStatus;
  key?: string;
}

export interface SpecSummary {
  id: string;
  key: string;
  version: string;
  status: IntakeSpecStatus;
  fieldCount: number;
  parentKey: string | null;
  updatedAt: Date;
  publishedAt: Date | null;
}

export async function list(filter: ListFilter = {}): Promise<SpecSummary[]> {
  const rows = await prisma.intakeSpec.findMany({
    where: {
      status: filter.status,
      key: filter.key,
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  return rows.map(toSummary);
}

function toSummary(row: IntakeSpec): SpecSummary {
  const body = row.body as { fields?: Record<string, unknown> } | null;
  const fieldCount =
    body && typeof body === "object" && body.fields && typeof body.fields === "object"
      ? Object.keys(body.fields).length
      : 0;
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    status: row.status,
    fieldCount,
    parentKey: row.parentKey,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}
