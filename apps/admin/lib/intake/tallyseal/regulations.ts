// Regulation Contract factories.
//
// HF Phase 1 uses:
//   GDPR Art 8        — minorConsent (declared in spec; not actively
//                       firing on adult-learner enrolment but available
//                       for future K-12 surfaces)
//   GDPR Art 22 / 9   — specialCategoryProhibition (gates the
//                       accessibilityNote sensitive field)
//   EU AI Act Art 14  — humanOversight (admin sign-off on intake)
//   EU AI Act Art 50  — aiInteractionDisclosure (banner on first
//                       chat message)
//
// Other regulations remain importable as we discover need.

// ── GDPR ────────────────────────────────────────────────────────────
export {
  GDPR_VERSION,
  // Article 8 — child consent
  minorConsent,
  // Article 22 — solely automated decision-making + Art 9 special-category
  specialCategoryProhibition,
  solelyAutomatedDecision,
  contractNecessityException,
  explicitConsentException,
  humanInterventionSafeguards,
  // Compliance-manifest field defaults — reduces boilerplate
  gdprPersonalDataDefaults,
  gdprSpecialCategoryDefaults,
} from "@tallyseal/regulations-gdpr";

// ── EU AI Act ───────────────────────────────────────────────────────
export {
  EU_AI_ACT_VERSION,
  // Article 14 — human oversight
  humanOversight,
  // Article 50 — transparency obligations
  aiInteractionDisclosure,
  syntheticContentMarker,
  emotionRecognitionDisclosure,
  deepFakeDisclosure,
} from "@tallyseal/regulations-eu-ai-act";
