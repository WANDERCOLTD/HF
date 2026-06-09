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
  SpecialCategoryBasis,

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

// AI tool-use surface (items 12+13, crawcus-spec 0.8.0). Imported
// directly from crawcus-spec because @tallyseal/core does not
// re-export the spec-level tool primitives.
export type {
  ToolDefinition,
  ToolCall,
  ToolCallId,
  ToolName,
  ToolResult,
  ToolResultOk,
  ToolResultErr,
  ToolNameValidationError,
  StopReason,
  JsonValue,
  JsonObject,
  JsonArray,
  JsonPrimitive,
  JsonSchema,
  JsonSchemaNode,
  JsonSchemaObject,
  JsonSchemaString,
  JsonSchemaNumber,
  JsonSchemaInteger,
  JsonSchemaBoolean,
  JsonSchemaArray,
  JsonSchemaEnum,
} from "@tallyseal/crawcus-spec";
