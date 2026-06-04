// Phase 1 admin-bridge customer-side callback stubs.
//
// Three callbacks @tallyseal/admin-bridge requires per its
// BridgeRouterConfig (dist/index.d.ts BridgeBundleSource +
// BridgeIntentLister + BridgeAccessRecorder). Phase 1 ships:
//
//   - bundleSource.load   → null (bridge responds 404 — Q-A C2)
//   - intentLister.list   → []   (no real listing in Phase 1)
//   - accessRecorder.record → no-op
//
// The no-op recorder is a knowingly acknowledged Phase 1 gap tracked
// as Q-BRIDGE-RECORDER-DURABILITY (tallyseal decision-log OPEN,
// Sprint E hardening item).
//
// Phase 2 replaces all three with real implementations against
// CRAWCUS primitives 10-14 — depends on tallyseal
// TKT-PRISMA-ADAPTER-PRIMITIVES-10-14.

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
