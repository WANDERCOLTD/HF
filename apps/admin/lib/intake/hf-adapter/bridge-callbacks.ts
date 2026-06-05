// Phase 1 admin-bridge customer-side callbacks.
//
// Three callbacks @tallyseal/admin-bridge requires per its
// BridgeRouterConfig (dist/index.d.ts BridgeBundleSource +
// BridgeIntentLister + BridgeAccessRecorder). Status as of 2026-06-05:
//
//   - intentLister.list   → real query against tallyseal_intent table
//                            (raw SQL — HF doesn't model the table in
//                            schema.prisma; @tallyseal/prisma-adapter
//                            owns the migration via applyMigrations()).
//                            rowToIntent helper from
//                            @tallyseal/prisma-adapter@0.1.0 lands when
//                            we need full Intent reconstruction
//                            (bundleSource path, Phase 2).
//   - bundleSource.load   → null (bridge responds 404 — Q-A C2). Phase
//                            2 wires composeAuditBundle from
//                            @tallyseal/core.
//   - accessRecorder.record → no-op (Q-BRIDGE-RECORDER-DURABILITY).
//
// Phase 2 unblocks remaining wiring once:
//   1. TKT-WRITE-EVENT-WITH-PROJECTION lands (in-flight 2026-06-05)
//   2. HF-side TallysealConfig is constructed (8 ports — 4 not stubbed:
//      identity / pii / tasks / storage)
//   3. Per-primitive write-paths from HF intake events (Q-CR9 first per
//      regulator demo priority)
//
// See docs/notebook/08-design-partner/
// hf-prisma-row-to-intent-heads-up-20260605.md (tallyseal-side) +
// hf-tkt-admin-bridge-1-phase1-qa-20260604.md §B1/B2/C2 for rationale.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  BridgeBundleSource,
  BridgeIntentLister,
  BridgeAccessRecorder,
} from "@tallyseal/admin-bridge";
import type { IntentId } from "@tallyseal/crawcus-spec";

const INTENT_LIST_HARD_CAP = 100;

interface IntentSummaryRow {
  id: string;
  key: string;
  state: "open" | "committed" | "abandoned";
  created_at: Date;
  updated_at: Date;
}

export const bundleSource: BridgeBundleSource = {
  async load() {
    return null;
  },
};

export const intentLister: BridgeIntentLister = {
  async list(filter) {
    const cap = Math.max(1, Math.min(filter.limit, INTENT_LIST_HARD_CAP));

    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filter.since) {
      conditions.push(Prisma.sql`created_at >= ${filter.since}`);
    }
    if (filter.until) {
      conditions.push(Prisma.sql`created_at <= ${filter.until}`);
    }

    const rows = await prisma.$queryRaw<IntentSummaryRow[]>`
      SELECT id, key, state, created_at, updated_at
      FROM tallyseal_intent
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY updated_at DESC
      LIMIT ${cap}
    `;

    return rows.map((row) => ({
      id: row.id as IntentId,
      key: row.key,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      subjectCount: 0,
    }));
  },
};

export const accessRecorder: BridgeAccessRecorder = {
  async record() {
    // No-op for Phase 1. Q-BRIDGE-RECORDER-DURABILITY tracks the
    // Sprint E durable recorder wired through writeEvent().
  },
};
