/**
 * Preview renderers barrel — Epic #1606.
 *
 * Each module imported here calls `registerPreviewRenderer()` at module
 * load. Import this barrel once from the surface that mounts
 * `DesignerShell` so registrations fire before the Inspector tries to
 * look up a renderer.
 */

export { FirstCallModeRenderer } from "./FirstCallModeRenderer";
export type { FirstCallModeRendererData } from "./FirstCallModeRenderer";

export { ModePolicyRenderer } from "./ModePolicyRenderer";
export type { ModePolicyRendererData } from "./ModePolicyRenderer";

export { WelcomeRenderer } from "./WelcomeRenderer";
export type { WelcomeRendererData } from "./WelcomeRenderer";

export { IntakeRenderer } from "./IntakeRenderer";
export type { IntakeRendererData } from "./IntakeRenderer";

export { OnboardingRenderer } from "./OnboardingRenderer";
export type { OnboardingRendererData } from "./OnboardingRenderer";

export { OffboardingRenderer } from "./OffboardingRenderer";
export type { OffboardingRendererData } from "./OffboardingRenderer";

export { NpsRenderer } from "./NpsRenderer";
export type { NpsRendererData } from "./NpsRenderer";

export {
  InstructionsRenderer,
  GOAL_ADAPTATION_GUIDANCE,
} from "./InstructionsRenderer";
export type {
  InstructionsRendererData,
  GoalType,
} from "./InstructionsRenderer";

export { ContentTrustRenderer } from "./ContentTrustRenderer";
export type {
  ContentTrustRendererData,
  FreshnessWarning,
} from "./ContentTrustRenderer";

export { ConversationArtifactsRenderer } from "./ConversationArtifactsRenderer";
export type {
  ConversationArtifactsRendererData,
  ConversationArtifactsRendererArtifact,
} from "./ConversationArtifactsRenderer";

export { MemoryDeltasRenderer } from "./MemoryDeltasRenderer";
export type {
  MemoryDeltasRendererData,
  MemoryDeltaAddedEntry,
  MemoryDeltaUpdatedEntry,
} from "./MemoryDeltasRenderer";

export type { SessionFlowData } from "./types";
