// HF compliance manifest — declares the controller-specific layer
// over the tallyseal regulation packs.
//
// This file is the **lawful-basis source of truth** for the
// IntakeApplication projection. The CrawcusSpec at
// ./specs/enrollment.intent.ts cites this manifest by reference.
//
// Controller details (DPO contact, retention policies) are HF-side.
// Field-level PII tiers and retention come partially from regulation
// pack defaults (gdprPersonalDataDefaults) with explicit overrides.
//
// Status: Phase 1 — DRAFT pending legal counsel review. NEVER ship
// to production traffic until reviewed. The runtime delivery gate
// in ./hf-adapter/disclosure-content.ts refuses DRAFT copy when
// NODE_ENV === 'production'.

import {
  defineCompliance,
  gdprPersonalDataDefaults,
  type ComplianceManifest,
  type RegulationVersion,
  type Region,
  type ISO8601Duration,
} from "./tallyseal";

const PROJECTION = "IntakeApplication";

export const compliance: ComplianceManifest = defineCompliance({
  regulations: [
    "gdpr@2025-Q1" as RegulationVersion,
    "eu-ai-act@2026-Q2" as RegulationVersion,
  ],

  dpoContact: "dpo@humanfirstfoundation.com",

  fields: {
    // Personal-data defaults for the projection (auto-applies pii:'personal'
    // + standard retention to common identifier fields)
    ...gdprPersonalDataDefaults(PROJECTION),

    // Overrides — none-tier and sensitive-tier specifics
    [`${PROJECTION}.timezone`]: { pii: "none" },
    [`${PROJECTION}.preferredContactMethod`]: { pii: "none" },
    [`${PROJECTION}.marketingOptIn`]: { pii: "none" },
    [`${PROJECTION}.ageRange`]: { pii: "personal" },

    // Art 9 special-category — explicit sensitive tier + tighter retention
    [`${PROJECTION}.accessibilityNote`]: {
      pii: "sensitive",
      retention: "P3Y" as ISO8601Duration,
    },

    // Internal fields for the Art 22/9 contract gate
    [`${PROJECTION}.processesArt9`]: { pii: "none" },
    [`${PROJECTION}.art9Exemption`]: { pii: "none" },
  },

  retention: {
    default: "P7Y" as ISO8601Duration,
    events: "P10Y" as ISO8601Duration,
    pii: {
      personal: "P7Y" as ISO8601Duration,
      sensitive: "P3Y" as ISO8601Duration,
      special: "P1Y" as ISO8601Duration,
    },
  },

  residency: {
    // HF's Cloud Run region (europe-west2) plus matching event + PII vault.
    // crossBorderTransfers: 'forbid' is the strict default — Anthropic
    // adapter currently uses 'pass-through' for the spike; tighten to
    // 'strict' before any non-test traffic (issue #993 Q-SC6).
    region: "europe-west2" as Region,
    eventStore: "europe-west2" as Region,
    piiVault: "europe-west2" as Region,
    aiProvider: { provider: "anthropic", endpoint: "https://api.anthropic.com" },
    // Anthropic is US-based. Spike posture: permit-with-log records
    // each transfer event. Tighten to "sccs-only" or "forbid" once
    // Q-SC6 (Anthropic EU residency) lands. NEVER ship to production
    // traffic at "permit-with-log".
    crossBorderTransfers: "permit-with-log",
  },

  ai: {
    allowedModels: ["claude-opus-4-7", "claude-sonnet-4-6"],
    promptTemplateVersion: "v0.1.0-DRAFT",
    costCeilingPerIntent: { currency: "usd", amount: 0.5 },
  },

  lawfulBasis: {
    default: "contract",
    perPurpose: {
      "course-delivery": "contract",
      "ai-tutor-mediation": "contract",
      "marketing-opt-in": "consent",
      "tos-acceptance": "contract",
      "art9-disability-disclosure": "consent",
    },
  },
});
