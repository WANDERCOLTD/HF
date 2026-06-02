// UI primitives from @tallyseal/react-assistant-ui.
//
// The two-pane LHS-chat / RHS-live-form pattern is the composite
// TallysealAssistantUI. The 6 binding components can be assembled
// individually if a customer wants a non-default layout.
//
// All components are unstyled — they expose data-tallyseal=* hooks
// for HF's existing CSS variables. See @tallyseal/react-assistant-ui
// README for the data-attr catalogue.

export {
  // Composite — the whole experience
  TallysealAssistantUI,

  // Six binding components (per Q9 §1 component-ownership map)
  TallysealBanner,
  TallysealSuggestionRail,
  TallysealActivityTray,
  TallysealReadinessGate,
  TallysealIntentForm,
  TallysealToolCallApproval,

  // Helpers
  LAWFUL_BASIS_OPTIONS,
} from "@tallyseal/react-assistant-ui";

export type {
  TallysealAssistantUIProps,
  TallysealBannerProps,
  TallysealSuggestionRailProps,
  TallysealActivityTrayProps,
  TallysealReadinessGateProps,
  TallysealIntentFormProps,
  TallysealToolCallApprovalProps,
} from "@tallyseal/react-assistant-ui";
