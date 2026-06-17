/**
 * Settings-tab voice setting contracts — sibling to
 * `lib/journey/setting-contracts.ts`. Phase 0 of epic #1675 (story #1676)
 * captures the 11 voice fields that previously lived split between the
 * Design tab's Voice Flow lens AND the Settings > Voice Providers page.
 *
 * Phase 6 of the Journey Editor epic migrates the UI; this Phase 0 file
 * ships the registry shape so Phase 6 can pick it up.
 *
 * Voice settings are NOT journey-affecting in the compose sense — they
 * change call engine behaviour (provider, voiceId, timeouts, cost cap),
 * not the prompt text. They share the same `JourneySettingContract` type
 * but live in a separate registry so Phase 0 imports stay scoped.
 *
 * Cross-registry note: `interruptSensitivity` appears in BOTH this
 * registry and the journey registry — operator-visible from two angles
 * (voice config + every-call teaching style). Both entries share the
 * same `storagePath`. The completeness vitest pins this invariant.
 */

import type {
  JourneySettingContract,
} from "@/lib/journey/setting-contracts";

// Re-export for Settings-tab callers.
export type {
  AutoEnableLink,
  CascadeSource,
  ComposeImpact,
  ComposeImpactKind,
  ControlType,
  CourseShape,
  JourneySettingContract,
  PreviewLocator,
  StoragePath,
  StoragePathStruct,
} from "@/lib/journey/setting-contracts";

export const SETTINGS_GROUPS = {
  S1_voice: {
    label: "Voice & calls",
    caption: "Provider, voice, transcriber, timeouts, cost cap",
  },
  S2_integration: {
    label: "Integrations",
    caption: "Webhook secrets, third-party credentials",
  },
  S3_demo: {
    label: "Demo & presenter mode",
    caption: "Demo policy, presenter overlay",
  },
  S4_access: {
    label: "Access & audit",
    caption: "Role overrides, audit log retention",
  },
} as const;

export type SettingsGroup = keyof typeof SETTINGS_GROUPS;

// =============================================================
// S1 — Voice & calls (11)
// =============================================================

const V_PROVIDER: JourneySettingContract = {
  id: "voiceProvider",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Voice provider",
  helpText: "VAPI / Deepgram / OpenAI / ElevenLabs / Azure / PlayHT.",
  storagePath: "playbook.voiceConfig.voiceProvider",
  control: "select",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.voiceProvider" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
};

const V_ID: JourneySettingContract = {
  id: "voiceId",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Voice",
  helpText: "Provider-specific voice id; preview with the [▶] button.",
  storagePath: "playbook.voiceConfig.voiceId",
  control: "voice-picker",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.voiceId" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
};

const V_BACKGROUND_SOUND: JourneySettingContract = {
  id: "backgroundSound",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Background sound",
  helpText: "off / office / custom URL.",
  storagePath: "playbook.voiceConfig.backgroundSound",
  control: "select",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.backgroundSound" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
};

/** Cross-registry: also lives in journey registry as G4 entry. Both
 *  entries share the same storagePath. */
const V_INTERRUPT_SENSITIVITY: JourneySettingContract = {
  id: "interruptSensitivity",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Interrupt sensitivity (voice copy)",
  helpText:
    "Mirror of journey G4 entry; surfaces in Voice tab for engineers diagnosing pauses.",
  storagePath: "config.interruptSensitivity",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["personality"],
    kinds: ["persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "personality" }],
};

const V_SPEED: JourneySettingContract = {
  id: "voiceSpeed",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Voice speed",
  helpText: "Playback rate multiplier (1.0 default).",
  storagePath: "playbook.voiceConfig.voiceSpeed",
  control: "slider",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.voiceSpeed" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
};

const V_PITCH: JourneySettingContract = {
  id: "voicePitch",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Voice pitch",
  helpText: "Provider-supported pitch offset.",
  storagePath: "playbook.voiceConfig.voicePitch",
  control: "slider",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.voicePitch" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
};

const V_SILENCE_THRESHOLD: JourneySettingContract = {
  id: "silenceThreshold",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Silence threshold",
  helpText: "Seconds of silence before the AI re-prompts.",
  storagePath: "playbook.voiceConfig.silenceThreshold",
  control: "duration",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.silenceThreshold" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
};

const V_END_CALL_AFTER_SILENCE: JourneySettingContract = {
  id: "endCallAfterSilence",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "End call after silence",
  helpText: "Hard hang-up after N seconds of silence.",
  storagePath: "playbook.voiceConfig.silenceTimeoutSeconds",
  control: "duration",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.silenceTimeoutSeconds" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
};

const V_MAX_CALL_DURATION: JourneySettingContract = {
  id: "maxCallDuration",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Max call duration",
  helpText: "Hard cap; VAPI hangs up at this point.",
  storagePath: "playbook.voiceConfig.maxDurationSeconds",
  control: "duration",
  cascadeSources: [
    { level: "domain", storagePath: "domain.voiceConfig.maxDurationSeconds" },
  ],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
  writeGate: "operator-only",
};

const V_PHONE_NUMBER: JourneySettingContract = {
  id: "phoneNumber",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "Outbound phone number",
  helpText: "Caller-id phone number for outbound dialling.",
  storagePath: "playbook.voiceConfig.phoneNumber",
  control: "text",
  cascadeSources: [],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
  writeGate: "operator-only",
};

const V_VAPI_ASSISTANT_ID: JourneySettingContract = {
  id: "vapiAssistantId",
  menuGroupKey: "N_voice",
  group: "S1_voice",
  educatorLabel: "VAPI assistant ID",
  helpText: "Provider-specific assistant id (advanced).",
  storagePath: "playbook.voiceConfig.vapiAssistantId",
  control: "text",
  cascadeSources: [],
  composeImpact: { sections: [], kinds: [], requiresReprompt: false },
  previewLocators: [],
  writeGate: "operator-only",
};

// =============================================================
// Registry
// =============================================================

export const VOICE_SETTINGS: readonly JourneySettingContract[] = [
  V_PROVIDER,
  V_ID,
  V_BACKGROUND_SOUND,
  V_INTERRUPT_SENSITIVITY,
  V_SPEED,
  V_PITCH,
  V_SILENCE_THRESHOLD,
  V_END_CALL_AFTER_SILENCE,
  V_MAX_CALL_DURATION,
  V_PHONE_NUMBER,
  V_VAPI_ASSISTANT_ID,
];

export const VOICE_SETTINGS_BY_ID: Readonly<
  Record<string, JourneySettingContract>
> = Object.fromEntries(VOICE_SETTINGS.map((s) => [s.id, s]));
