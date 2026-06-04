// Phase 1 admin-bridge customer-side callback stubs.
//
// Three callbacks @tallyseal/admin-bridge requires per its
// BridgeRouterConfig (dist/index.d.ts BridgeBundleSource +
// BridgeIntentLister + BridgeAccessRecorder). Status:
//
//   - bundleSource.load   → null (bridge responds 404 — Q-A C2)
//   - intentLister.list   → []   (no real listing in Phase 1)
//   - accessRecorder.record → no-op
//
// Phase 2 unblocked the primitive 10-14 stores tallyseal-side
// (TKT-PRISMA-ADAPTER-PRIMITIVES-10-14 merged 2026-06-04), but the
// HF-side wire-up still depends on:
//   1. A constructed TallysealConfig (8 ports — 4 are not yet stubbed
//      in HF: identity / pii / tasks / storage)
//   2. Per-primitive write-paths from HF intake events
//      (Q-HF-PRIMITIVES-10-14-WRITE-PATH; Q-CR9 first per regulator
//      demo highlight)
//   3. rowToIntent helper (Q-PRISMA-ROW-TO-INTENT, queued next MINOR;
//      HF unblocks via raw SQL in the interim)
//
// The migration runner ships in this PR (scripts/apply-tallyseal-migrations.ts)
// so the tallyseal_warrant / tallyseal_disclosure / tallyseal_consent /
// tallyseal_lineage / tallyseal_oversight tables exist; the write-paths
// + durable accessRecorder land in follow-up PRs per primitive.
//
// Q-BRIDGE-RECORDER-DURABILITY remains OPEN until the writeEvent path
// + TallysealConfig construction land. See
// docs/notebook/08-design-partner/hf-phase2-descoped-qs-answered-20260604.md
// §Q1 for the canonical recorder snippet to wire when the config is ready.

import type {
  BridgeBundleSource,
  BridgeIntentLister,
  BridgeAccessRecorder,
} from "@tallyseal/admin-bridge";

export const bundleSource: BridgeBundleSource = {
  async load() {
    return null;
  },
};

export const intentLister: BridgeIntentLister = {
  async list() {
    return [];
  },
};

export const accessRecorder: BridgeAccessRecorder = {
  async record() {
    // No-op for Phase 1. Q-BRIDGE-RECORDER-DURABILITY tracks the
    // Sprint E durable recorder wired through writeEvent().
  },
};
