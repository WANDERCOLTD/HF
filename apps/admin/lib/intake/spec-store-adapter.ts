// #1182 Phase 2b-prep — SpecStore adapter.
//
// Implements the locked SpecStore contract from
// @tallyseal/admin-editor@0.1.0 (TKT-ADMIN-EDITOR-LIB-EXTRACT spec §2)
// against the existing Phase 2a CRUD helpers in
// lib/intake/spec-store.ts.
//
// Contract source: tallyseal docs/notebook/09-operating/
//                  tkt-admin-editor-lib-extract-spec.md §2
//
// The interface is defined INLINE here because
// @tallyseal/admin-editor is not yet vendored (tarball ETA EOD
// Tue 2026-06-09). When the package lands, this inline interface
// gets removed and the adapter implements the imported one. The
// shape is locked, so this is a paste-and-delete swap.
//
// Two HF-locked semantic refinements (tallyseal acknowledged
// 2026-06-06):
//   1. saveDraft(spec) is an upsert against (key, version);
//      PUBLISHED rows are refused with a typed ConflictError.
//   2. publish(specId) accepts a host-synthesised SpecDeployOutcome
//      — HF's V6 wizard publish is a DB state transition, no real
//      remote deploy. The synthesised value uses the `ok` variant
//      with stub PR-specific fields (prUrl: '', prNumber: 0, etc).
//
// Race-condition handling: the upsert is a two-query sequence
// (findByKeyVersion -> create OR update) so concurrent admin tabs
// can both pass the existence check and race to createDraft,
// triggering Postgres P2002 on the (key, version) unique index.
// The adapter catches P2002 and converts to ConflictError.

import { Prisma, type IntakeSpec } from "@prisma/client";
import type { CrawcusSpec } from "@tallyseal/crawcus-spec";
import {
  createDraft,
  updateDraft,
  publish as publishExisting,
  findPublished,
  findById,
  findByKeyVersion,
  list as listExisting,
} from "./spec-store";
import { deserialiseBody, serialiseSpec } from "./crawcus-serde";
import type { SpecDeployOutcome } from "./spec-deploy-outcome";

// ---------------------------------------------------------------------
// SpecStore contract — inline until @tallyseal/admin-editor is vendored.
// ---------------------------------------------------------------------

export interface SpecSummary {
  readonly key: string;
  readonly version: string;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly updatedAt: string; // ISO8601
}

export interface SpecStore {
  load(key: string, version?: string): Promise<CrawcusSpec | null>;
  saveDraft(spec: CrawcusSpec): Promise<{ id: string; version: string }>;
  publish(specId: string): Promise<{ deployOutcome: SpecDeployOutcome }>;
  list(filter?: { status?: "DRAFT" | "PUBLISHED" }): Promise<SpecSummary[]>;
}

// ---------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------

export class ConflictError extends Error {
  readonly code = "CONFLICT" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

// ---------------------------------------------------------------------
// Adapter implementation.
// ---------------------------------------------------------------------

interface CrawcusSpecAuthoring extends CrawcusSpec {
  readonly version: string | number; // body authoring uses string semver; runtime uses number
}

/**
 * Returns a SpecStore implementation backed by the IntakeSpec table.
 * Stateless — safe to call per-request from server components.
 */
export function createSpecStoreAdapter(): SpecStore {
  return {
    async load(key, version) {
      const row =
        version === undefined
          ? await findPublished(key)
          : await findByKeyVersion(key, version);
      if (row === null) return null;
      return deserialiseBody(row.body);
    },

    async saveDraft(spec) {
      const authoring = spec as CrawcusSpecAuthoring;
      const versionStr = String(authoring.version);
      const keyStr = String(authoring.key);

      const existing = await findByKeyVersion(keyStr, versionStr);
      if (existing !== null && existing.status === "PUBLISHED") {
        throw new ConflictError(
          `Spec ${keyStr}@${versionStr} is PUBLISHED — drafts of a published spec require a new version.`,
        );
      }

      // TODO(ai-guard): non-atomic upsert. The findByKeyVersion read +
      // createDraft write are two round-trips; a concurrent tab can pass
      // the null-check and race to createDraft, hitting Postgres P2002
      // on the (key, version) unique index. We catch P2002 below and
      // convert to ConflictError so the UI can prompt-and-retry. Tighten
      // to a single $transaction with serialisable isolation when
      // concurrent authoring becomes a real use case.
      try {
        const row =
          existing !== null
            ? await updateDraft({ id: existing.id, body: serialiseSpec(spec) })
            : await createDraft({
                key: keyStr,
                version: versionStr,
                body: serialiseSpec(spec),
              });
        return { id: row.id, version: row.version };
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new ConflictError(
            `Concurrent write detected on spec ${keyStr}@${versionStr}. Reload the editor and retry.`,
          );
        }
        throw err;
      }
    },

    async publish(specId) {
      const row = await publishExisting({ id: specId });
      // Synthesise SpecDeployOutcome. HF's V6 wizard publish is a DB
      // state transition (DRAFT → PUBLISHED), not a GitHub PR deploy —
      // the bridge's `ok` variant requires PR-specific fields that are
      // not meaningful here. Stub values document the synthesis.
      // Tallyseal acknowledged host-synthesised outcomes are valid
      // (Sprint E follow-up reply, 2026-06-06).
      const deployOutcome: SpecDeployOutcome = {
        kind: "ok",
        prUrl: "",
        prNumber: 0,
        commitSha: `host-synthesised:${row.id}`,
        bridgeAccessEventId: "",
      };
      return { deployOutcome };
    },

    async list(filter) {
      const rows = await listExisting({ status: filter?.status });
      return rows.map((r) => ({
        key: r.key,
        version: r.version,
        status: r.status,
        updatedAt: r.updatedAt.toISOString(),
      }));
    },
  };
}

// Internal-use accessor for the underlying row (the editor stub page
// reads richer fields than the SpecStore contract surfaces). Not part
// of the SpecStore interface.
export async function loadRow(id: string): Promise<IntakeSpec | null> {
  return findById(id);
}
