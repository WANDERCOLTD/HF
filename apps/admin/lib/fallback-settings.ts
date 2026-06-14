/**
 * Fallback Settings
 *
 * Stores fallback/default values in SystemSetting with `fallback:` key prefix.
 * These are the values used when primary data sources (specs, AI) are unavailable.
 *
 * Pattern: Primary source → SystemSetting fallback → hardcoded constant (last resort)
 *
 * Key convention: fallback:{category}.{subcategory}
 */

import { getSystemSetting } from "@/lib/system-settings";
import { config } from "@/lib/config";

// ── Generic accessor ──────────────────────────────────────

export async function getFallback<T>(key: string, hardcodedDefault: T): Promise<T> {
  return getSystemSetting<T>(`fallback:${key}`, hardcodedDefault);
}

// ═══════════════════════════════════════════════════════════
// 1. ONBOARDING PERSONAS (quick-launch catch fallback)
// ═══════════════════════════════════════════════════════════

export interface FallbackPersona {
  slug: string;
  name: string;
  description: string;
}

export const DEFAULT_FALLBACK_PERSONAS: FallbackPersona[] = [
  { slug: "tutor", name: "Tutor", description: "Patient teaching expert" },
];

export async function getOnboardingPersonasFallback(): Promise<FallbackPersona[]> {
  return getFallback("onboarding.personas", DEFAULT_FALLBACK_PERSONAS);
}

// ═══════════════════════════════════════════════════════════
// 2. IDENTITY TEMPLATE (generate-identity fallback)
// ═══════════════════════════════════════════════════════════

export interface FallbackIdentityTemplate {
  roleStatementTemplate: string;
  primaryGoalTemplate: string;
  secondaryGoals: string[];
  techniques: Array<{ name: string; description: string; when: string }>;
  defaults: Record<string, string>;
  styleGuidelines: string[];
  does: string[];
  doesNot: string[];
  opening: { approach: string; examples: string[] };
  main: { approach: string; strategies: string[] };
  closing: { approach: string; examples: string[] };
  principles: string[];
  methods: string[];
}

export const DEFAULT_IDENTITY_TEMPLATE: FallbackIdentityTemplate = {
  roleStatementTemplate:
    "You are a friendly, patient {{persona}} specializing in {{subject}}{{goalText}}. You make complex topics accessible through clear explanations and real-world examples.",
  primaryGoalTemplate:
    "Help learners build genuine understanding of {{subject}}",
  secondaryGoals: [
    "Build learner confidence through encouragement",
    "Adapt to each learner's pace and style",
    "Make content relevant to real-world applications",
  ],
  techniques: [
    { name: "Scaffolding", description: "Build on what the learner already knows", when: "Introducing new concepts" },
    { name: "Check Understanding", description: "Ask open questions to verify comprehension", when: "After explaining a concept" },
    { name: "Real-World Examples", description: "Connect theory to practical scenarios", when: "When concepts feel abstract" },
  ],
  defaults: { warmth: "high", formality: "moderate", pace: "adaptive" },
  styleGuidelines: [
    "Use clear, jargon-free language unless teaching technical terms",
    "Keep explanations concise — this is a phone call, not a lecture",
    "Encourage questions and curiosity",
    "Celebrate progress and correct answers",
  ],
  does: [
    "Teaches {{subject}} content accurately",
    "Adapts pace to the learner",
    "Checks understanding regularly",
    "Provides encouragement",
  ],
  doesNot: [
    "Give advice outside the subject domain",
    "Rush through material",
    "Use overly complex language",
    "Make up facts not in the source material",
  ],
  opening: { approach: "Warm greeting with brief recap of previous session", examples: [] },
  main: { approach: "Conversational teaching with comprehension checks", strategies: [] },
  closing: { approach: "Summarise key points and preview next topic", examples: [] },
  principles: ["Focus on understanding, not memorisation", "Check before moving on"],
  methods: ["Open-ended questions", "Scenario-based checks"],
};

export async function getIdentityTemplateFallback(): Promise<FallbackIdentityTemplate> {
  return getFallback("identity.template", DEFAULT_IDENTITY_TEMPLATE);
}

// ═══════════════════════════════════════════════════════════
// 3. ONBOARDING FLOW PHASES (scaffold fallback)
// ═══════════════════════════════════════════════════════════

export interface FallbackFlowPhase {
  phase: string;
  duration: string;
  goals: string[];
}

export interface FallbackFlowPhases {
  phases: FallbackFlowPhase[];
}

export const DEFAULT_FLOW_PHASES: FallbackFlowPhases = {
  phases: [
    {
      phase: "welcome",
      duration: "2-3 minutes",
      goals: [
        "Greet the caller warmly",
        "Introduce yourself and your role",
        "Set expectations for the session",
      ],
    },
    {
      phase: "discovery",
      duration: "3-5 minutes",
      goals: [
        "Learn about the caller's background",
        "Understand their goals and motivations",
        "Assess existing knowledge level",
      ],
    },
    {
      phase: "first-topic",
      duration: "5-8 minutes",
      goals: [
        "Introduce the first core concept",
        "Check understanding with open questions",
        "Adapt pace to caller's responses",
      ],
    },
    {
      phase: "wrap-up",
      duration: "2-3 minutes",
      goals: [
        "Summarise what was covered",
        "Preview what comes next",
        "End on an encouraging note",
      ],
    },
  ],
};

export async function getFlowPhasesFallback(): Promise<FallbackFlowPhases> {
  return getFallback("onboarding.flow_phases", DEFAULT_FLOW_PHASES);
}

// ═══════════════════════════════════════════════════════════
// 4. TRANSCRIPT LIMITS (pipeline fallback)
// ═══════════════════════════════════════════════════════════

export interface FallbackTranscriptLimits {
  [callPoint: string]: number;
}

export const DEFAULT_TRANSCRIPT_LIMITS: FallbackTranscriptLimits = {
  "pipeline.measure": 8000,
  "pipeline.learn": 8000,
  "pipeline.score_agent": 6000,
  "pipeline.adapt": 4000,
  "pipeline.extract_goals": 6000,
};

export async function getTranscriptLimitsFallback(): Promise<FallbackTranscriptLimits> {
  return getFallback("pipeline.transcript_limits", DEFAULT_TRANSCRIPT_LIMITS);
}

// ═══════════════════════════════════════════════════════════
// 5. AI MODEL DEFAULTS (config-loader fallback)
// ═══════════════════════════════════════════════════════════

export interface FallbackAIModelConfig {
  provider: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export const DEFAULT_AI_MODEL_CONFIGS: Record<string, FallbackAIModelConfig> = {
  "pipeline.measure": { provider: "claude", model: config.ai.claude.model },
  "pipeline.learn": { provider: "claude", model: config.ai.claude.model },
  "pipeline.score_agent": { provider: "claude", model: config.ai.claude.model },
  "pipeline.adapt": { provider: "claude", model: config.ai.claude.model },
  "compose.prompt": { provider: "claude", model: config.ai.claude.model },
  "analysis.measure": { provider: "claude", model: config.ai.claude.lightModel },
  "analysis.learn": { provider: "claude", model: config.ai.claude.lightModel },
  "parameter.enrich": { provider: "claude", model: config.ai.claude.lightModel },
  "bdd.parse": { provider: "claude", model: config.ai.claude.model },
  "chat.stream": { provider: "claude", model: config.ai.claude.model },
  "spec.assistant": { provider: "claude", model: config.ai.claude.model },
  "spec.view": { provider: "claude", model: config.ai.claude.model },
  "spec.extract": { provider: "claude", model: config.ai.claude.model },
  "spec.parse": { provider: "claude", model: config.ai.claude.lightModel },
  "chat.data": { provider: "claude", model: config.ai.claude.model },
  "chat.call": { provider: "claude", model: config.ai.claude.model },
  "assistant.chat": { provider: "claude", model: config.ai.claude.model },
  "assistant.tasks": { provider: "claude", model: config.ai.claude.model },
  "assistant.data": { provider: "claude", model: config.ai.claude.model },
  "assistant.spec": { provider: "claude", model: config.ai.claude.model },
  "content-trust.extract": { provider: "claude", model: config.ai.claude.model },
  "workflow.classify": { provider: "claude", model: config.ai.claude.model },
  "workflow.step": { provider: "claude", model: config.ai.claude.model },
};

export async function getAIModelConfigsFallback(): Promise<Record<string, FallbackAIModelConfig>> {
  return getFallback("ai.default_models", DEFAULT_AI_MODEL_CONFIGS);
}

// ═══════════════════════════════════════════════════════════
// 6. ACTIVITIES CONFIG (activity toolkit & text delivery)
// ═══════════════════════════════════════════════════════════

export interface ActivitiesConfig {
  /** Master switch — disables all activity recommendations when false */
  enabled: boolean;
  /** Text message delivery provider */
  textProvider: "stub" | "twilio" | "vapi-sms";
  /** Twilio config (only used when textProvider = "twilio") */
  twilio?: {
    fromNumber: string;
    accountSid?: string; // Falls back to env TWILIO_ACCOUNT_SID
    authToken?: string;  // Falls back to env TWILIO_AUTH_TOKEN
  };
  /** Max structured activities the AI should deploy per session */
  maxActivitiesPerSession: number;
  /** Max text messages to send per caller per week */
  maxTextsPerWeek: number;
  /** Whether between-session text activities are enabled */
  betweenSessionTextsEnabled: boolean;
}

export const DEFAULT_ACTIVITIES_CONFIG: ActivitiesConfig = {
  enabled: true,
  textProvider: "stub",
  maxActivitiesPerSession: 2,
  maxTextsPerWeek: 2,
  betweenSessionTextsEnabled: false,
};

export async function getActivitiesConfig(): Promise<ActivitiesConfig> {
  return getFallback("activities.config", DEFAULT_ACTIVITIES_CONFIG);
}

// ═══════════════════════════════════════════════════════════
// SETTINGS REGISTRY (for the Settings UI "Fallback Defaults" tab)
// ═══════════════════════════════════════════════════════════

export interface FallbackSettingDef {
  key: string;
  label: string;
  description: string;
  type: "json";
}

export interface FallbackSettingGroup {
  id: string;
  label: string;
  icon: string;
  description: string;
  settings: FallbackSettingDef[];
}

export const FALLBACK_SETTINGS_REGISTRY: FallbackSettingGroup = {
  id: "fallbacks",
  label: "Fallback Defaults",
  icon: "Shield",
  description: "Default values used when primary data sources (specs, AI) are unavailable. Edit with care — these are last-resort values.",
  settings: [
    {
      key: "fallback:onboarding.personas",
      label: "Onboarding Personas",
      description: "Fallback persona list when INIT-001 spec is unavailable",
      type: "json",
    },
    {
      key: "fallback:identity.template",
      label: "Identity Template",
      description: "Fallback identity config template when AI generation fails. Supports {{subject}}, {{persona}}, {{goalText}} placeholders.",
      type: "json",
    },
    {
      key: "fallback:onboarding.flow_phases",
      label: "Onboarding Flow Phases",
      description: "Default first-call flow phases (welcome, discovery, first-topic, wrap-up)",
      type: "json",
    },
    {
      key: "fallback:pipeline.transcript_limits",
      label: "Transcript Limits",
      description: "Character limits per pipeline stage for transcript truncation",
      type: "json",
    },
    {
      key: "fallback:ai.default_models",
      label: "AI Model Defaults",
      description: "Default AI provider and model per call point (used when AIConfig DB is empty)",
      type: "json",
    },
    {
      key: "fallback:activities.config",
      label: "Activities Config",
      description: "Activity toolkit settings: enable/disable, text provider (stub/twilio/vapi-sms), session limits, between-session texts",
      type: "json",
    },
  ],
};
