/**
 * Composition Pipeline
 *
 * Declarative, spec-driven prompt composition system.
 * COMP-001 spec sections drive data loading, transformation, and assembly.
 */

export { executeComposition, getDefaultSections } from "./CompositionExecutor";
export type { CompositionResult, CompositionSectionDef, AssembledContext } from "./types";
export { persistComposedPrompt } from "./persist";
export type { PersistOptions, PersistedPrompt } from "./persist";
export { loadComposeConfig } from "./loadComposeConfig";
export type { ComposeConfig } from "./loadComposeConfig";
export { buildComposeTrace, renderComposeTraceLog } from "./buildComposeTrace";
export type { ComposeTrace } from "./types";
