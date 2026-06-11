/**
 * Listed cascade knob catalogue (Epic #1442 Layer 3 Slice 1 / #1482).
 *
 * Side-effect-free enumeration of the keys + family names that
 * `lib/cascade/effective-value.ts::FAMILIES` accepts. Generators and other
 * build-time consumers (KB facts, demo doc, future Cmd+K palette) import
 * THIS instead of `effective-value.ts` to avoid eagerly evaluating the
 * resolver chain (Prisma + Next-internal imports), which would either
 * fail or be painfully slow when executed under `npx tsx`.
 *
 * **Invariant:** every entry here MUST be accepted by `isResolvableKnob`.
 * Pinned by `tests/lib/cascade/knob-keys.test.ts`. If you add a knob to
 * `FAMILIES`, add a matching row here in the same PR.
 *
 * BEH-* keys are sample-anchored: the `behavior-target` family accepts any
 * `BEH-*` prefix, but operators don't need the entire enum surfaced in the
 * doc — list the demo-relevant ones explicitly and document the family
 * pattern in `notes`.
 */

export type KnobFamilyName =
  | "behavior-target"
  | "welcome-message"
  | "session-flow"
  | "voice-config"
  | "identity-spec";

export interface ListedKnob {
  knobKey: string;
  family: KnobFamilyName;
  /** Operator-friendly label rendered in the doc table. */
  label: string;
  /** One-line summary of what the knob controls. */
  description: string;
  /** Which layer is recommended for educators to override at. */
  recommendedLayer: "DOMAIN" | "PLAYBOOK";
  /** True when this knob is in the 4-knob "demo preset" the operator applies on a fresh demo course. */
  demoKnob: boolean;
}

export const LISTED_KNOBS: readonly ListedKnob[] = [
  // ── behavior-target (BEH-* prefix; demo-relevant subset shown) ──────
  {
    knobKey: "BEH-RESPONSE-LEN",
    family: "behavior-target",
    label: "Response length",
    description: "0.0 (terse) → 1.0 (verbose). Demo preset uses 0.2.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: true,
  },
  {
    knobKey: "BEH-WARMTH",
    family: "behavior-target",
    label: "Warmth",
    description: "Conversational warmth and emotional attunement.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: true,
  },
  {
    knobKey: "BEH-FORMALITY",
    family: "behavior-target",
    label: "Formality",
    description: "Register: casual ↔ professional.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "BEH-CONVERSATIONAL-TONE",
    family: "behavior-target",
    label: "Conversational tone",
    description: "Dry / playful / neutral.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "BEH-TURN-LENGTH",
    family: "behavior-target",
    label: "Turn length",
    description: "How much the AI says per turn before yielding.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "BEH-PAUSE-TOLERANCE",
    family: "behavior-target",
    label: "Pause tolerance",
    description: "How long the AI waits before re-prompting.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },

  // ── welcome-message ────────────────────────────────────────────────
  {
    knobKey: "welcomeMessage",
    family: "welcome-message",
    label: "Welcome message",
    description: "First-line greeting the AI uses on the learner's first call. Demo preset sets a tuned welcome.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: true,
  },

  // ── session-flow ───────────────────────────────────────────────────
  {
    knobKey: "onboarding",
    family: "session-flow",
    label: "Onboarding phases",
    description: "Pre-call survey + AI Intro Call structure.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "intake",
    family: "session-flow",
    label: "Intake toggles",
    description: "Goals / About You / Knowledge Check / AI Intro Call gates. Demo preset turns all off.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: true,
  },
  {
    knobKey: "stops",
    family: "session-flow",
    label: "Auto-include stops",
    description: "Pre-test / mid-test / post-test / NPS stops between teaching sessions.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "offboarding",
    family: "session-flow",
    label: "Offboarding phases",
    description: "Post-course wrap-up flow.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },

  // ── voice-config ───────────────────────────────────────────────────
  {
    knobKey: "voiceProvider",
    family: "voice-config",
    label: "Voice provider",
    description: "TTS vendor: Deepgram / OpenAI / ElevenLabs.",
    recommendedLayer: "DOMAIN",
    demoKnob: false,
  },
  {
    knobKey: "voiceId",
    family: "voice-config",
    label: "Voice ID",
    description: "Specific voice from the provider (vendor-validated catalogue).",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "model",
    family: "voice-config",
    label: "LLM model",
    description: "AI model identifier.",
    recommendedLayer: "DOMAIN",
    demoKnob: false,
  },
  {
    knobKey: "modelTemp",
    family: "voice-config",
    label: "Model temperature",
    description: "Sampling temperature for the LLM.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "modelTopP",
    family: "voice-config",
    label: "Model top-p",
    description: "Top-p nucleus sampling for the LLM.",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
  {
    knobKey: "language",
    family: "voice-config",
    label: "Language",
    description: "Spoken language code (e.g., en-GB).",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },

  // ── identity-spec ──────────────────────────────────────────────────
  {
    knobKey: "identitySpecId",
    family: "identity-spec",
    label: "Identity spec",
    description: "AI persona (tutor / coach / companion / conversational guide).",
    recommendedLayer: "PLAYBOOK",
    demoKnob: false,
  },
] as const;
