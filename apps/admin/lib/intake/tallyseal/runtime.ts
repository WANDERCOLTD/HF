// Runtime helpers — used at evaluation time, not at authoring time.
//
//  - canonicalJSON / computeContentHash — for byte-stable audit-bundle
//    serialisation and disclosure content-hash binding
//  - verifyChain — validates the hash-chained event log
//  - evaluateContracts / evaluateGraph — run a CrawcusSpec against
//    a current snapshot/event log
//  - checkReadiness / materialiseReadinessCtx — readiness gate inputs
//
// Authoring-time API (defineCrawcusSpec, field, etc.) lives in
// ./builders.ts; UI primitives live in ./ui.ts.

export {
  canonicalJSON,
  computeContentHash,
  verifyChain,
  evaluateContracts,
  evaluateGraph,
  checkReadiness,
  materialiseReadinessCtx,
  buildContractCtx,
  validateComposition,
  validateManifest,
  composeIntent,
  composeAuditBundle,
  writeEvent,
  AUDIT_BUNDLE_VERSION,
  GENESIS_PREV_HASH,
  SYSTEM_EVENT_KINDS,
  isSystemEventKind,
  customEventKind,
  tokenisePayload,
  makeMarker,
  isMarker,
  containsMarker,
  extractTokens,
  PII_MARKER_PATTERN,
} from "@tallyseal/core";

export type {
  AIPolicy,
  AIPort,
  AIRequest,
  AIResponse,
  ComposeAuditBundleInput,
  ConsentStorePort,
  DeliveryPort,
  DeliveryRegistry,
  DeliveryRequest,
  DeliveryResult,
  DisclosureStorePort,
  EventStorePort,
  IdentityPort,
  LineageStorePort,
  OversightStorePort,
  PIIPort,
  ProjectionPort,
  TallysealConfig,
  TallysealDisclosuresConfig,
  TokenisedText,
  TxContext,
  WarrantStorePort,
  WriteEventCtx,
  WriteEventInput,
  WriteEventResult,
} from "@tallyseal/core";
