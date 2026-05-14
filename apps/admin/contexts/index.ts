export { EntityProvider, useEntityContext, ENTITY_COLORS } from "./EntityContext";
export type { EntityType, EntityBreadcrumb } from "./EntityContext";

export { ChatProvider, useChatContext, MODE_CONFIG } from "./ChatContext";
export type { ChatMode, ChatMessage } from "./ChatContext";

export { ThemeProvider, useTheme, themeInitScript } from "./ThemeContext";
export type { ThemePreference, ResolvedTheme } from "./ThemeContext";

export { PaletteProvider, usePalette, palettePresets, darkPalettePresets } from "./PaletteContext";
export type { PalettePreset } from "./PaletteContext";

export { MasqueradeProvider, useMasquerade } from "./MasqueradeContext";
export type { MasqueradeState } from "@/lib/masquerade";

export { BrandingProvider, useBranding } from "./BrandingContext";

export { ViewModeProvider, useViewMode } from "./ViewModeContext";
export type { ViewModePreference } from "./ViewModeContext";

export { ErrorCaptureProvider, useErrorCapture } from "./ErrorCaptureContext";
export type { CapturedError } from "./ErrorCaptureContext";

export { StepFlowProvider, useStepFlow } from "./StepFlowContext";
export type { StepFlowState, StepDefinition } from "./StepFlowContext";

export { DomainScopeProvider, useDomainScope } from "./DomainScopeContext";
