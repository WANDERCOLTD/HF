// Type re-exports from @tallyseal/core (which itself re-exports many
// from @tallyseal/crawcus-spec). HF feature code imports types from
// here, never directly from @tallyseal/*.

export type {
  // Spec shape
  CrawcusSpec,
  ComplianceManifest,
  IntentClassification,

  // Field shape
  FieldSpec,
  FieldBaseType,
  FieldBuilder,
  FieldMetadata,
  FieldCompliance,
  FieldPath,
  PIILevel,

  // Contract shape
  Contract,
  ContractCtx,
  ContractEvaluationResult,
  FieldContractCtx,

  // Intent + runtime
  Intent,
  IntentId,
  IntentKey,
  ProjectionId,
  ProjectionName,
  ProjectionRef,
  ReadinessCtx,
  ReadinessResult,

  // Events
  Event,
  EventId,
  EventKind,
  EventAIProvenance,
  SystemEventKind,
  CustomEventKind,

  // Tenant + actor
  Tenant,
  TenantCtx,
  TenantId,
  AccessCtx,
  Actor,
  ActorId,
  SubjectId,

  // Suggestion lifecycle (Art 14 surface)
  Suggestion,
  SuggestionId,
  SuggestionState,

  // Disclosure / consent / lineage / oversight (v0.1.0 audit-bundle sections)
  Disclosure,
  DisclosureContent,
  DisclosureRequirement,
  DeliveryMethod,
  Consent,
  ConsentEventId,
  ConsentRequirement,
  Lineage,
  LineageRequirement,
  HumanOversight,
  OversightRequirement,
  Warrant,
  WarrantId,

  // Audit bundle
  AuditBundle,
  AuditBundleDerogation,

  // Cross-cutting
  Locale,
  LocalisedText,
  LawfulBasis,
  Purpose,
  Region,
  RegulationVersion,
  RegulationCitation,
  HashChainProof,
  ContentHash,
  Token,
  Timestamp,
  ISO8601Duration,
  Tainted,
  Untainted,
  Brand,
} from "@tallyseal/core";
