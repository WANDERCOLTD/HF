/**
 * System Settings Helper
 *
 * Reads from the SystemSetting table (key-value store with JSON values).
 * Provides typed accessors with defaults and in-memory caching (30s TTL).
 *
 * Settings taxonomy:
 *   pipeline.*      — Pipeline & scoring behaviour
 *   scoring.*       — Score calculation parameters
 *   memory.*        — Memory extraction & retention
 *   goals.*         — Goal detection thresholds
 *   trust.*         — Content trust weights
 *   ai_learning.*   — AI pattern learning rates
 *   knowledge.*     — Knowledge retrieval tuning
 *   voice.*         — Voice call provider, model, tools, RAG
 *   cache.*         — Cache TTL tuning
 *   email.*         — Email template text blocks
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

// ── Cache ──────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; expiry: number }>();

export function clearSystemSettingsCache() {
  cache.clear();
}

// ── Generic accessor ───────────────────────────────────

export async function getSystemSetting<T>(key: string, defaultValue: T): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiry > now) return cached.value as T;

  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (!row) {
      cache.set(key, { value: defaultValue, expiry: now + CACHE_TTL_MS });
      return defaultValue;
    }
    const parsed = JSON.parse(row.value) as T;
    cache.set(key, { value: parsed, expiry: now + CACHE_TTL_MS });
    return parsed;
  } catch (err) {
    console.warn(`[system-settings] Failed to load "${key}", using default`, err);
    return defaultValue;
  }
}

// Helper to load a group of settings in parallel
async function loadGroup<T extends object>(
  keyMap: { [K in keyof T]: string },
  defaults: T,
): Promise<T> {
  const keys = Object.keys(defaults) as Array<keyof T>;
  const values = await Promise.all(
    keys.map((k) => getSystemSetting(keyMap[k], defaults[k]))
  );
  const result = { ...defaults };
  keys.forEach((k, i) => { (result as any)[k] = values[i]; });
  return result;
}

// ═══════════════════════════════════════════════════════
// 1. PIPELINE & SCORING
// ═══════════════════════════════════════════════════════

export interface PipelineSettings {
  minTranscriptWords: number;
  shortTranscriptThresholdWords: number;
  shortTranscriptConfidenceCap: number;
  maxRetries: number;
  mockMode: boolean;
  personalityDecayHalfLifeDays: number;
  mockScoreBase: number;
  mockScoreRange: number;
}

export const PIPELINE_DEFAULTS: PipelineSettings = {
  minTranscriptWords: 20,
  shortTranscriptThresholdWords: 50,
  shortTranscriptConfidenceCap: 0.3,
  maxRetries: 2,
  mockMode: false,
  personalityDecayHalfLifeDays: 30,
  mockScoreBase: 0.3,
  mockScoreRange: 0.4,
};

const PIPELINE_KEYS: Record<keyof PipelineSettings, string> = {
  minTranscriptWords: "pipeline.min_transcript_words",
  shortTranscriptThresholdWords: "pipeline.short_transcript_threshold_words",
  shortTranscriptConfidenceCap: "pipeline.short_transcript_confidence_cap",
  maxRetries: "pipeline.max_retries",
  mockMode: "pipeline.mock_mode",
  personalityDecayHalfLifeDays: "scoring.personality_decay_half_life_days",
  mockScoreBase: "scoring.mock_score_base",
  mockScoreRange: "scoring.mock_score_range",
};

export async function getPipelineSettings(): Promise<PipelineSettings> {
  return loadGroup(PIPELINE_KEYS, PIPELINE_DEFAULTS);
}

// Back-compat alias used by pipeline route & measure-agent
export type PipelineGates = Pick<PipelineSettings, "minTranscriptWords" | "shortTranscriptThresholdWords" | "shortTranscriptConfidenceCap">;
export async function getPipelineGates(): Promise<PipelineGates> {
  const s = await getPipelineSettings();
  return {
    minTranscriptWords: s.minTranscriptWords,
    shortTranscriptThresholdWords: s.shortTranscriptThresholdWords,
    shortTranscriptConfidenceCap: s.shortTranscriptConfidenceCap,
  };
}

// ═══════════════════════════════════════════════════════
// 2. MEMORY & LEARNING
// ═══════════════════════════════════════════════════════

export interface MemorySettings {
  confidenceDefault: number;
  confidenceHigh: number;
  confidenceLow: number;
  summaryRecentLimit: number;
  summaryTopLimit: number;
  transcriptLimitChars: number;
}

export const MEMORY_DEFAULTS: MemorySettings = {
  confidenceDefault: 0.5,
  confidenceHigh: 0.8,
  confidenceLow: 0.3,
  summaryRecentLimit: 10,
  summaryTopLimit: 5,
  transcriptLimitChars: 8000,
};

const MEMORY_KEYS: Record<keyof MemorySettings, string> = {
  confidenceDefault: "memory.confidence_default",
  confidenceHigh: "memory.confidence_high",
  confidenceLow: "memory.confidence_low",
  summaryRecentLimit: "memory.summary_recent_limit",
  summaryTopLimit: "memory.summary_top_limit",
  transcriptLimitChars: "memory.transcript_limit_chars",
};

export async function getMemorySettings(): Promise<MemorySettings> {
  return loadGroup(MEMORY_KEYS, MEMORY_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 3. GOALS & DETECTION
// ═══════════════════════════════════════════════════════

export interface GoalSettings {
  confidenceThreshold: number;
  similarityThreshold: number;
  transcriptMinChars: number;
  transcriptLimitChars: number;
}

export const GOAL_DEFAULTS: GoalSettings = {
  confidenceThreshold: 0.5,
  similarityThreshold: 0.8,
  transcriptMinChars: 100,
  transcriptLimitChars: 4000,
};

const GOAL_KEYS: Record<keyof GoalSettings, string> = {
  confidenceThreshold: "goals.confidence_threshold",
  similarityThreshold: "goals.similarity_threshold",
  transcriptMinChars: "goals.transcript_min_chars",
  transcriptLimitChars: "goals.transcript_limit_chars",
};

export async function getGoalSettings(): Promise<GoalSettings> {
  return loadGroup(GOAL_KEYS, GOAL_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 3b. ARTIFACTS
// ═══════════════════════════════════════════════════════

export interface ArtifactSettings {
  confidenceThreshold: number;
  similarityThreshold: number;
  transcriptMinChars: number;
  transcriptLimitChars: number;
}

export const ARTIFACT_DEFAULTS: ArtifactSettings = {
  confidenceThreshold: 0.6,
  similarityThreshold: 0.8,
  transcriptMinChars: 100,
  transcriptLimitChars: 4000,
};

const ARTIFACT_KEYS: Record<keyof ArtifactSettings, string> = {
  confidenceThreshold: "artifacts.confidence_threshold",
  similarityThreshold: "artifacts.similarity_threshold",
  transcriptMinChars: "artifacts.transcript_min_chars",
  transcriptLimitChars: "artifacts.transcript_limit_chars",
};

export async function getArtifactSettings(): Promise<ArtifactSettings> {
  return loadGroup(ARTIFACT_KEYS, ARTIFACT_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 4. CONTENT TRUST
// ═══════════════════════════════════════════════════════

export interface TrustSettings {
  weightL5Regulatory: number;
  weightL4Accredited: number;
  weightL3Published: number;
  weightL2Expert: number;
  weightL1AiAssisted: number;
  weightL0Unverified: number;
  certificationMinWeight: number;
  extractionMaxChunkChars: number;
}

export const TRUST_DEFAULTS: TrustSettings = {
  weightL5Regulatory: 1.0,
  weightL4Accredited: 0.95,
  weightL3Published: 0.80,
  weightL2Expert: 0.60,
  weightL1AiAssisted: 0.30,
  weightL0Unverified: 0.05,
  certificationMinWeight: 0.80,
  extractionMaxChunkChars: 8000,
};

const TRUST_KEYS: Record<keyof TrustSettings, string> = {
  weightL5Regulatory: "trust.weight.L5_regulatory",
  weightL4Accredited: "trust.weight.L4_accredited",
  weightL3Published: "trust.weight.L3_published",
  weightL2Expert: "trust.weight.L2_expert",
  weightL1AiAssisted: "trust.weight.L1_ai_assisted",
  weightL0Unverified: "trust.weight.L0_unverified",
  certificationMinWeight: "trust.certification_min_weight",
  extractionMaxChunkChars: "trust.extraction_max_chunk_chars",
};

export async function getTrustSettings(): Promise<TrustSettings> {
  return loadGroup(TRUST_KEYS, TRUST_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 5. AI PATTERN LEARNING
// ═══════════════════════════════════════════════════════

export interface AILearningSettings {
  initialConfidence: number;
  confidenceIncrement: number;
  minOccurrences: number;
}

export const AI_LEARNING_DEFAULTS: AILearningSettings = {
  initialConfidence: 0.3,
  confidenceIncrement: 0.05,
  minOccurrences: 3,
};

const AI_LEARNING_KEYS: Record<keyof AILearningSettings, string> = {
  initialConfidence: "ai_learning.initial_confidence",
  confidenceIncrement: "ai_learning.confidence_increment",
  minOccurrences: "ai_learning.min_occurrences",
};

export async function getAILearningSettings(): Promise<AILearningSettings> {
  return loadGroup(AI_LEARNING_KEYS, AI_LEARNING_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 6. KNOWLEDGE RETRIEVAL
// ═══════════════════════════════════════════════════════

export interface KnowledgeRetrievalSettings {
  queryMessageCount: number;
  topResults: number;
  chunkLimit: number;
  assertionLimit: number;
  memoryLimit: number;
  minRelevance: number;
}

export const KNOWLEDGE_RETRIEVAL_DEFAULTS: KnowledgeRetrievalSettings = {
  queryMessageCount: 3,
  topResults: 10,
  chunkLimit: 5,
  assertionLimit: 5,
  memoryLimit: 3,
  minRelevance: 0.3,
};

const KNOWLEDGE_RETRIEVAL_KEYS: Record<keyof KnowledgeRetrievalSettings, string> = {
  queryMessageCount: "knowledge.query_message_count",
  topResults: "knowledge.top_results",
  chunkLimit: "knowledge.chunk_limit",
  assertionLimit: "knowledge.assertion_limit",
  memoryLimit: "knowledge.memory_limit",
  minRelevance: "knowledge.min_relevance",
};

export async function getKnowledgeRetrievalSettings(): Promise<KnowledgeRetrievalSettings> {
  return loadGroup(KNOWLEDGE_RETRIEVAL_KEYS, KNOWLEDGE_RETRIEVAL_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 7. VOICE CALLS (provider-agnostic call service config)
// ═══════════════════════════════════════════════════════

export interface VoiceCallSettings {
  // Provider & model (provider-agnostic — works with any call service)
  provider: string;
  model: string;
  // Per-turn knowledge retrieval (automatic RAG every turn)
  knowledgePlanEnabled: boolean;
  // Pipeline
  autoPipeline: boolean;
  // Tool toggles
  toolLookupTeachingPoint: boolean;
  toolCheckMastery: boolean;
  toolRecordObservation: boolean;
  toolGetPracticeQuestion: boolean;
  toolGetNextModule: boolean;
  toolLogActivityResult: boolean;
  toolSendText: boolean;
  toolRequestArtifact: boolean;
  // Fallback prompts
  unknownCallerPrompt: string;
  noActivePromptFallback: string;
}

export const VOICE_CALL_DEFAULTS: VoiceCallSettings = {
  provider: "openai",
  model: config.ai.openai.model,
  knowledgePlanEnabled: false,
  autoPipeline: true,
  toolLookupTeachingPoint: true,
  toolCheckMastery: true,
  toolRecordObservation: true,
  toolGetPracticeQuestion: true,
  toolGetNextModule: true,
  toolLogActivityResult: true,
  toolSendText: true,
  toolRequestArtifact: true,
  unknownCallerPrompt: "You are a helpful voice assistant. This caller is not yet registered in the system. Have a friendly conversation and gather their name.",
  noActivePromptFallback: "You are a helpful voice tutor. No personalized prompt is available yet — have a warm, friendly conversation.",
};

const VOICE_CALL_KEYS: Record<keyof VoiceCallSettings, string> = {
  provider: "voice.provider",
  model: "voice.model",
  knowledgePlanEnabled: "voice.knowledge_plan_enabled",
  autoPipeline: "voice.auto_pipeline",
  toolLookupTeachingPoint: "voice.tool_lookup_teaching_point",
  toolCheckMastery: "voice.tool_check_mastery",
  toolRecordObservation: "voice.tool_record_observation",
  toolGetPracticeQuestion: "voice.tool_get_practice_question",
  toolGetNextModule: "voice.tool_get_next_module",
  toolLogActivityResult: "voice.tool_log_activity_result",
  toolSendText: "voice.tool_send_text",
  toolRequestArtifact: "voice.tool_request_artifact",
  unknownCallerPrompt: "voice.unknown_caller_prompt",
  noActivePromptFallback: "voice.no_active_prompt_fallback",
};

export async function getVoiceCallSettings(): Promise<VoiceCallSettings> {
  return loadGroup(VOICE_CALL_KEYS, VOICE_CALL_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 8. VOICE I/O (simulator STT + TTS config)
// ═══════════════════════════════════════════════════════

export interface VoiceIOSettings {
  /** OpenAI TTS voice — "alloy" | "echo" | "fern" | "nova" | "onyx" | "shimmer" */
  ttsVoice: string;
  /** TTS speaking rate: 0.25–4.0 */
  ttsSpeakingRate: number;
  /** Whisper language hint (BCP-47, e.g. "en") */
  whisperLanguage: string;
  /** Max recording duration in seconds before auto-stop */
  recordingMaxSeconds: number;
  /** Auto-play TTS when sim is in voice mode */
  autoPlayInVoiceMode: boolean;
}

export const VOICE_IO_DEFAULTS: VoiceIOSettings = {
  ttsVoice: "nova",
  ttsSpeakingRate: 1.0,
  whisperLanguage: "en",
  recordingMaxSeconds: 60,
  autoPlayInVoiceMode: true,
};

const VOICE_IO_KEYS: Record<keyof VoiceIOSettings, string> = {
  ttsVoice: "voice_io.tts_voice",
  ttsSpeakingRate: "voice_io.tts_speaking_rate",
  whisperLanguage: "voice_io.whisper_language",
  recordingMaxSeconds: "voice_io.recording_max_seconds",
  autoPlayInVoiceMode: "voice_io.auto_play_in_voice_mode",
};

export async function getVoiceIOSettings(): Promise<VoiceIOSettings> {
  return loadGroup(VOICE_IO_KEYS, VOICE_IO_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 9. PERFORMANCE & CACHING (renumbered from 8)
// ═══════════════════════════════════════════════════════

export interface CacheSettings {
  systemSettingsTtlMs: number;
  aiConfigTtlMs: number;
  costConfigTtlMs: number;
  dataPathsTtlMs: number;
}

export const CACHE_DEFAULTS: CacheSettings = {
  systemSettingsTtlMs: 30000,
  aiConfigTtlMs: 60000,
  costConfigTtlMs: 300000,
  dataPathsTtlMs: 5000,
};

const CACHE_KEYS: Record<keyof CacheSettings, string> = {
  systemSettingsTtlMs: "cache.system_settings_ttl_ms",
  aiConfigTtlMs: "cache.ai_config_ttl_ms",
  costConfigTtlMs: "cache.cost_config_ttl_ms",
  dataPathsTtlMs: "cache.data_paths_ttl_ms",
};

export async function getCacheSettings(): Promise<CacheSettings> {
  return loadGroup(CACHE_KEYS, CACHE_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 7. DEMO CAPTURE
// ═══════════════════════════════════════════════════════

export interface DemoCaptureSettings {
  defaultCaller: string;
  defaultDomain: string;
  defaultPlaybook: string;
  defaultSpec: string;
}

export const DEMO_CAPTURE_DEFAULTS: DemoCaptureSettings = {
  defaultCaller: "Paul",
  defaultDomain: "qm-tutor",
  defaultPlaybook: "",
  defaultSpec: "",
};

const DEMO_CAPTURE_KEYS: Record<keyof DemoCaptureSettings, string> = {
  defaultCaller: "demo.default_caller",
  defaultDomain: "demo.default_domain",
  defaultPlaybook: "demo.default_playbook",
  defaultSpec: "demo.default_spec",
};

export async function getDemoCaptureSettings(): Promise<DemoCaptureSettings> {
  return loadGroup(DEMO_CAPTURE_KEYS, DEMO_CAPTURE_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 8. EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════

export interface EmailTemplateSettings {
  magicLinkSubject: string;
  magicLinkHeading: string;
  magicLinkBody: string;
  magicLinkButtonText: string;
  magicLinkFooter: string;
  inviteSubject: string;
  inviteHeading: string;
  inviteBody: string;
  inviteButtonText: string;
  inviteFooter: string;
  passwordResetSubject: string;
  passwordResetHeading: string;
  passwordResetBody: string;
  passwordResetButtonText: string;
  passwordResetFooter: string;
  sharedFromName: string;
  sharedBrandColorStart: string;
  sharedBrandColorEnd: string;
}

export const EMAIL_TEMPLATE_DEFAULTS: EmailTemplateSettings = {
  magicLinkSubject: "Sign in to HF Admin",
  magicLinkHeading: "Sign In",
  magicLinkBody: "Click the button below to sign in to your account. No password needed.",
  magicLinkButtonText: "Sign In",
  magicLinkFooter: "This link expires in 24 hours. If you didn't request this, ignore this email.",
  inviteSubject: "You're invited to test HF — {{domainName}}",
  inviteHeading: "You're Invited",
  inviteBody: "{{greeting}} {{context}}",
  inviteButtonText: "Accept Invitation",
  inviteFooter: "This invitation expires in 7 days.",
  passwordResetSubject: "Reset your password",
  passwordResetHeading: "Reset Your Password",
  passwordResetBody: "Click the button below to reset your password. This link expires in 1 hour.",
  passwordResetButtonText: "Reset Password",
  passwordResetFooter: "If you didn't request a password reset, ignore this email.",
  sharedFromName: "HF Admin",
  sharedBrandColorStart: "#3b82f6",
  sharedBrandColorEnd: "#9333ea",
};

const EMAIL_TEMPLATE_KEYS: Record<keyof EmailTemplateSettings, string> = {
  magicLinkSubject: "email.magic_link.subject",
  magicLinkHeading: "email.magic_link.heading",
  magicLinkBody: "email.magic_link.body",
  magicLinkButtonText: "email.magic_link.button_text",
  magicLinkFooter: "email.magic_link.footer",
  inviteSubject: "email.invite.subject",
  inviteHeading: "email.invite.heading",
  inviteBody: "email.invite.body",
  inviteButtonText: "email.invite.button_text",
  inviteFooter: "email.invite.footer",
  passwordResetSubject: "email.password_reset.subject",
  passwordResetHeading: "email.password_reset.heading",
  passwordResetBody: "email.password_reset.body",
  passwordResetButtonText: "email.password_reset.button_text",
  passwordResetFooter: "email.password_reset.footer",
  sharedFromName: "email.shared.from_name",
  sharedBrandColorStart: "email.shared.brand_color_start",
  sharedBrandColorEnd: "email.shared.brand_color_end",
};

export async function getEmailTemplateSettings(): Promise<EmailTemplateSettings> {
  return loadGroup(EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATE_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 9. ACTION EXTRACTION
// ═══════════════════════════════════════════════════════

export interface ActionSettings {
  transcriptLimit: number;
  minTranscriptLength: number;
  confidenceThreshold: number;
  similarityThreshold: number;
}

export const ACTIONS_DEFAULTS: ActionSettings = {
  transcriptLimit: 4000,
  minTranscriptLength: 100,
  confidenceThreshold: 0.6,
  similarityThreshold: 0.8,
};

const ACTIONS_KEYS: Record<keyof ActionSettings, string> = {
  transcriptLimit: "actions.transcript_limit",
  minTranscriptLength: "actions.min_transcript_length",
  confidenceThreshold: "actions.confidence_threshold",
  similarityThreshold: "actions.similarity_threshold",
};

export async function getActionSettings(): Promise<ActionSettings> {
  return loadGroup(ACTIONS_KEYS, ACTIONS_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 10. DEFAULTS (Archetype, etc.)
// ═══════════════════════════════════════════════════════

export interface DefaultsSettings {
  defaultArchetype: string;
}

export const DEFAULTS_DEFAULTS: DefaultsSettings = {
  defaultArchetype: config.specs.defaultArchetype,
};

const DEFAULTS_KEYS: Record<keyof DefaultsSettings, string> = {
  defaultArchetype: "defaults.archetype",
};

export async function getDefaultsSettings(): Promise<DefaultsSettings> {
  return loadGroup(DEFAULTS_KEYS, DEFAULTS_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 11. AGENT TUNING (Boston Matrix structure)
// ═══════════════════════════════════════════════════════

import {
  type AgentTuningSettings,
  AGENT_TUNING_DEFAULTS,
} from "@/lib/domain/agent-tuning";

export type { AgentTuningSettings };

export async function getAgentTuningSettings(): Promise<AgentTuningSettings> {
  const matrices = await getSystemSetting(
    "agent_tuning.matrices",
    AGENT_TUNING_DEFAULTS.matrices,
  );
  const derivedConfidence = await getSystemSetting(
    "agent_tuning.derived_confidence",
    AGENT_TUNING_DEFAULTS.derivedConfidence,
  );
  return { matrices, derivedConfidence };
}

// ═══════════════════════════════════════════════════════
// 12. EXTRACTION FILTERING
// ═══════════════════════════════════════════════════════

export interface ExtractionFilterSettings {
  /** Whether section filtering is enabled (master toggle) */
  filteringEnabled: boolean;
  /** Section title patterns to skip entirely (no extraction) */
  skipPatterns: string[];
  /** Section title patterns to extract but tag as reference */
  referencePatterns: string[];
  /** Minimum character count for a section to be worth extracting */
  minSectionChars: number;
}

export const EXTRACTION_FILTER_DEFAULTS: ExtractionFilterSettings = {
  filteringEnabled: true,
  skipPatterns: ["index", "table of contents", "contents", "title page", "copyright", "acknowledgements", "publisher", "about the author", "blank"],
  referencePatterns: ["answer key", "answers", "teacher notes", "glossary", "solutions"],
  minSectionChars: 50,
};

const EXTRACTION_FILTER_KEYS: Record<keyof ExtractionFilterSettings, string> = {
  filteringEnabled: "extraction.filter.enabled",
  skipPatterns: "extraction.filter.skip_patterns",
  referencePatterns: "extraction.filter.reference_patterns",
  minSectionChars: "extraction.filter.min_section_chars",
};

export async function getExtractionFilterSettings(): Promise<ExtractionFilterSettings> {
  return loadGroup(EXTRACTION_FILTER_KEYS, EXTRACTION_FILTER_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// 13. CONTENT LINKING (Question/Vocab → Assertion)
// ═══════════════════════════════════════════════════════

export interface ContentLinkingSettings {
  /** Minimum keyword overlap score (0-1) to consider a link */
  minKeywordScore: number;
  /** Weight for learningOutcomeRef exact match (added to score) */
  loRefMatchBoost: number;
  /** Weight for chapter+section match (added to score) */
  chapterMatchBoost: number;
  /** Minimum final score to create a link */
  minLinkScore: number;
  /** Whether to use vector similarity (requires embeddings) */
  useVectorSimilarity: boolean;
  /** Minimum vector similarity score (0-1) */
  minVectorSimilarity: number;
}

export const CONTENT_LINKING_DEFAULTS: ContentLinkingSettings = {
  minKeywordScore: 0.15,
  loRefMatchBoost: 0.5,
  chapterMatchBoost: 0.2,
  minLinkScore: 0.35,
  useVectorSimilarity: true,
  minVectorSimilarity: 0.6,
};

const CONTENT_LINKING_KEYS: Record<keyof ContentLinkingSettings, string> = {
  minKeywordScore: "content_linking.min_keyword_score",
  loRefMatchBoost: "content_linking.lo_ref_match_boost",
  chapterMatchBoost: "content_linking.chapter_match_boost",
  minLinkScore: "content_linking.min_link_score",
  useVectorSimilarity: "content_linking.use_vector_similarity",
  minVectorSimilarity: "content_linking.min_vector_similarity",
};

export async function getContentLinkingSettings(): Promise<ContentLinkingSettings> {
  return loadGroup(CONTENT_LINKING_KEYS, CONTENT_LINKING_DEFAULTS);
}

// ═══════════════════════════════════════════════════════
// SETTINGS REGISTRY (for UI rendering)
// ═══════════════════════════════════════════════════════

export interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: "int" | "float" | "bool" | "text" | "textarea";
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

export interface SettingGroup {
  id: string;
  label: string;
  icon: string;
  description: string;
  settings: SettingDef[];
}

export const SETTINGS_REGISTRY: SettingGroup[] = [
  {
    id: "voice",
    label: "Voice Calls",
    icon: "Phone",
    description: "Call service provider, model, per-turn RAG, tool enablement, and fallback prompts",
    settings: [
      { key: "voice.provider", label: "LLM provider", description: "Which provider serves the voice model (e.g. openai, anthropic, google)", type: "text", default: "openai", placeholder: "openai" },
      { key: "voice.model", label: "Voice model", description: "Model ID used for the voice assistant (e.g. gpt-4o, claude-sonnet-4-5-20250929)", type: "text", default: "gpt-4o", placeholder: "gpt-4o" },
      { key: "voice.knowledge_plan_enabled", label: "Per-turn RAG", description: "Automatically retrieve knowledge every conversation turn. Disable to rely on tools + front-loaded prompt instead", type: "bool", default: true },
      { key: "voice.auto_pipeline", label: "Auto-pipeline", description: "Automatically trigger analysis pipeline when a call ends", type: "bool", default: true },
      { key: "voice.tool_lookup_teaching_point", label: "Tool: Lookup teaching point", description: "Let the AI look up teaching content mid-call", type: "bool", default: true },
      { key: "voice.tool_check_mastery", label: "Tool: Check mastery", description: "Let the AI check caller mastery before teaching new material", type: "bool", default: true },
      { key: "voice.tool_record_observation", label: "Tool: Record observation", description: "Let the AI record caller observations in real-time", type: "bool", default: true },
      { key: "voice.tool_get_practice_question", label: "Tool: Practice question", description: "Let the AI fetch practice questions for a topic", type: "bool", default: true },
      { key: "voice.tool_get_next_module", label: "Tool: Next module", description: "Let the AI look up the next curriculum module", type: "bool", default: true },
      { key: "voice.tool_log_activity_result", label: "Tool: Log activity", description: "Let the AI log activity results (quiz, MCQ, teach-back)", type: "bool", default: true },
      { key: "voice.tool_send_text", label: "Tool: Send text to caller", description: "Let the AI send SMS during calls (requires text provider config)", type: "bool", default: true },
      { key: "voice.tool_request_artifact", label: "Tool: Request artifact", description: "Let the AI request study artifacts be sent after the call", type: "bool", default: true },
      { key: "voice.unknown_caller_prompt", label: "Unknown caller prompt", description: "System prompt used when the caller isn't registered", type: "textarea", default: "You are a helpful voice assistant. This caller is not yet registered in the system. Have a friendly conversation and gather their name." },
      { key: "voice.no_active_prompt_fallback", label: "No-prompt fallback", description: "System prompt used when a known caller has no active composed prompt", type: "textarea", default: "You are a helpful voice tutor. No personalized prompt is available yet — have a warm, friendly conversation." },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline & Scoring",
    icon: "Activity",
    description: "Controls how the analysis pipeline processes calls",
    settings: [
      { key: "pipeline.min_transcript_words", label: "Min transcript length", description: "Skip scoring for transcripts shorter than this (words)", type: "int", default: 20, min: 0, max: 200 },
      { key: "pipeline.short_transcript_threshold_words", label: "Short transcript threshold", description: "Cap confidence for transcripts shorter than this (words)", type: "int", default: 50, min: 0, max: 500 },
      { key: "pipeline.short_transcript_confidence_cap", label: "Short transcript confidence cap", description: "Maximum confidence for short transcripts", type: "float", default: 0.3, min: 0, max: 1, step: 0.05 },
      { key: "pipeline.max_retries", label: "Max AI retries", description: "Retry attempts for failed AI calls", type: "int", default: 2, min: 0, max: 5 },
      { key: "pipeline.mock_mode", label: "Force mock mode", description: "Use mock scoring instead of AI for all pipeline stages", type: "bool", default: false },
      { key: "scoring.personality_decay_half_life_days", label: "Personality decay half-life", description: "Days for trait scores to decay to 50% weight", type: "int", default: 30, min: 1, max: 365 },
      { key: "scoring.mock_score_base", label: "Mock score base", description: "Minimum mock score value", type: "float", default: 0.3, min: 0, max: 1, step: 0.05 },
      { key: "scoring.mock_score_range", label: "Mock score range", description: "Random variance added to mock base", type: "float", default: 0.4, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "memory",
    label: "Memory & Learning",
    icon: "Brain",
    description: "How memories are extracted, scored, and retained",
    settings: [
      { key: "memory.confidence_default", label: "Default confidence", description: "Default memory confidence score", type: "float", default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: "memory.confidence_high", label: "High confidence threshold", description: "Threshold for high-confidence memories", type: "float", default: 0.8, min: 0, max: 1, step: 0.05 },
      { key: "memory.confidence_low", label: "Low confidence threshold", description: "Threshold for low-confidence memories", type: "float", default: 0.3, min: 0, max: 1, step: 0.05 },
      { key: "memory.summary_recent_limit", label: "Recent memories in summary", description: "Number of recent memories included in summaries", type: "int", default: 10, min: 1, max: 50 },
      { key: "memory.summary_top_limit", label: "Top memories in summary", description: "Number of top-scored memories included", type: "int", default: 5, min: 1, max: 25 },
      { key: "memory.transcript_limit_chars", label: "Transcript limit", description: "Max characters sent to AI for memory extraction", type: "int", default: 8000, min: 1000, max: 20000 },
    ],
  },
  {
    id: "goals",
    label: "Goals & Detection",
    icon: "Target",
    description: "Thresholds for goal extraction and deduplication",
    settings: [
      { key: "goals.confidence_threshold", label: "Confidence threshold", description: "Minimum confidence to create a goal", type: "float", default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: "goals.similarity_threshold", label: "Similarity threshold", description: "Cutoff for deduplicating similar goals", type: "float", default: 0.8, min: 0, max: 1, step: 0.05 },
      { key: "goals.transcript_min_chars", label: "Min transcript length", description: "Skip goal extraction for transcripts shorter than this (chars)", type: "int", default: 100, min: 0, max: 1000 },
      { key: "goals.transcript_limit_chars", label: "Transcript limit", description: "Max characters sent to AI for goal extraction", type: "int", default: 4000, min: 500, max: 20000 },
    ],
  },
  {
    id: "trust",
    label: "Content Trust",
    icon: "ShieldCheck",
    description: "Trust level weights and certification thresholds",
    settings: [
      { key: "trust.weight.L5_regulatory", label: "L5 Regulatory Standard", description: "Weight for regulatory/certified content", type: "float", default: 1.0, min: 0, max: 1, step: 0.05 },
      { key: "trust.weight.L4_accredited", label: "L4 Accredited Material", description: "Weight for accredited training materials", type: "float", default: 0.95, min: 0, max: 1, step: 0.05 },
      { key: "trust.weight.L3_published", label: "L3 Published Reference", description: "Weight for published reference materials", type: "float", default: 0.80, min: 0, max: 1, step: 0.05 },
      { key: "trust.weight.L2_expert", label: "L2 Expert Curated", description: "Weight for expert-curated content", type: "float", default: 0.60, min: 0, max: 1, step: 0.05 },
      { key: "trust.weight.L1_ai_assisted", label: "L1 AI Assisted", description: "Weight for AI-generated content", type: "float", default: 0.30, min: 0, max: 1, step: 0.05 },
      { key: "trust.weight.L0_unverified", label: "L0 Unverified", description: "Weight for unverified content", type: "float", default: 0.05, min: 0, max: 1, step: 0.05 },
      { key: "trust.certification_min_weight", label: "Certification min weight", description: "Minimum trust weight for certification readiness", type: "float", default: 0.80, min: 0, max: 1, step: 0.05 },
      { key: "trust.extraction_max_chunk_chars", label: "Extraction chunk size", description: "Max characters per document chunk for trust extraction", type: "int", default: 8000, min: 1000, max: 20000 },
    ],
  },
  {
    id: "ai_learning",
    label: "AI Learning",
    icon: "Sparkles",
    description: "How the AI knowledge system learns patterns from interactions",
    settings: [
      { key: "ai_learning.initial_confidence", label: "Initial confidence", description: "Starting confidence for newly detected patterns", type: "float", default: 0.3, min: 0, max: 1, step: 0.05 },
      { key: "ai_learning.confidence_increment", label: "Confidence increment", description: "Confidence boost per additional occurrence", type: "float", default: 0.05, min: 0.01, max: 0.2, step: 0.01 },
      { key: "ai_learning.min_occurrences", label: "Min occurrences", description: "Occurrences needed before creating a pattern", type: "int", default: 3, min: 1, max: 20 },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge Retrieval",
    icon: "Search",
    description: "Per-turn RAG retrieval for VAPI and sim calls (vector + keyword hybrid)",
    settings: [
      { key: "knowledge.query_message_count", label: "Query message count", description: "Number of recent user messages used as search context", type: "int", default: 3, min: 1, max: 10 },
      { key: "knowledge.top_results", label: "Top results", description: "Max results returned per retrieval turn", type: "int", default: 10, min: 1, max: 30 },
      { key: "knowledge.chunk_limit", label: "Knowledge chunks", description: "Max knowledge base chunks per retrieval", type: "int", default: 5, min: 1, max: 20 },
      { key: "knowledge.assertion_limit", label: "Teaching assertions", description: "Max teaching assertions per retrieval", type: "int", default: 5, min: 1, max: 20 },
      { key: "knowledge.memory_limit", label: "Caller memories", description: "Max caller memories per retrieval", type: "int", default: 3, min: 1, max: 10 },
      { key: "knowledge.min_relevance", label: "Min relevance score", description: "Minimum similarity score (0–1) to include a result", type: "float", default: 0.3, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "cache",
    label: "Performance",
    icon: "Gauge",
    description: "Cache TTLs and system performance tuning",
    settings: [
      { key: "cache.system_settings_ttl_ms", label: "Settings cache TTL", description: "How long system settings are cached (ms)", type: "int", default: 30000, min: 1000, max: 600000 },
      { key: "cache.ai_config_ttl_ms", label: "AI config cache TTL", description: "How long AI config is cached (ms)", type: "int", default: 60000, min: 1000, max: 600000 },
      { key: "cache.cost_config_ttl_ms", label: "Cost config cache TTL", description: "How long cost rates are cached (ms)", type: "int", default: 300000, min: 1000, max: 600000 },
      { key: "cache.data_paths_ttl_ms", label: "Data paths cache TTL", description: "How long data paths are cached (ms)", type: "int", default: 5000, min: 1000, max: 60000 },
    ],
  },
  {
    id: "demo",
    label: "Demo Capture",
    icon: "Camera",
    description: "Default entities used when capturing demo screenshots (npm run snap)",
    settings: [
      { key: "demo.default_caller", label: "Default caller", description: "Caller name used for entity screenshots", type: "text", default: "Paul", placeholder: "e.g. Paul" },
      { key: "demo.default_domain", label: "Default domain", description: "Domain slug used for entity screenshots", type: "text", default: "qm-tutor", placeholder: "e.g. qm-tutor" },
      { key: "demo.default_playbook", label: "Default subject", description: "Subject name (leave empty for first available)", type: "text", default: "", placeholder: "e.g. QM Adaptive v1" },
      { key: "demo.default_spec", label: "Default spec", description: "Spec slug for spec-related screenshots", type: "text", default: "", placeholder: "e.g. PERS-001" },
    ],
  },
  {
    id: "email",
    label: "Email Templates",
    icon: "Mail",
    description: "Customise the text and branding of system emails (magic link sign-in and invitations)",
    settings: [
      // ── Shared branding ──
      { key: "email.shared.from_name", label: "Sender name", description: "The 'from' name shown in recipients' inboxes", type: "text", default: "HF Admin", placeholder: "e.g. HF Admin" },
      { key: "email.shared.brand_color_start", label: "Brand gradient start", description: "Hex colour for the header gradient (left/top)", type: "text", default: "#3b82f6", placeholder: "#3b82f6" },
      { key: "email.shared.brand_color_end", label: "Brand gradient end", description: "Hex colour for the header gradient (right/bottom)", type: "text", default: "#9333ea", placeholder: "#9333ea" },
      // ── Magic link email ──
      { key: "email.magic_link.subject", label: "Magic link — Subject", description: "Email subject line for magic link sign-in", type: "text", default: "Sign in to HF Admin", placeholder: "Sign in to HF Admin" },
      { key: "email.magic_link.heading", label: "Magic link — Heading", description: "Heading text shown in the email header", type: "text", default: "Sign In", placeholder: "Sign In" },
      { key: "email.magic_link.body", label: "Magic link — Body", description: "Main body text above the sign-in button", type: "textarea", default: "Click the button below to sign in to your account. No password needed." },
      { key: "email.magic_link.button_text", label: "Magic link — Button", description: "Call-to-action button label", type: "text", default: "Sign In", placeholder: "Sign In" },
      { key: "email.magic_link.footer", label: "Magic link — Footer", description: "Footer text below the button", type: "textarea", default: "This link expires in 24 hours. If you didn't request this, ignore this email." },
      // ── Invite email ──
      { key: "email.invite.subject", label: "Invite — Subject", description: "Use {{domainName}} for the domain. E.g. \"Join HF — {{domainName}}\"", type: "text", default: "You're invited to test HF — {{domainName}}", placeholder: "You're invited to test HF — {{domainName}}" },
      { key: "email.invite.heading", label: "Invite — Heading", description: "Heading text shown in the email header", type: "text", default: "You're Invited", placeholder: "You're Invited" },
      { key: "email.invite.body", label: "Invite — Body", description: "Use {{greeting}} and {{context}} for dynamic content", type: "textarea", default: "{{greeting}} {{context}}" },
      { key: "email.invite.button_text", label: "Invite — Button", description: "Call-to-action button label", type: "text", default: "Accept Invitation", placeholder: "Accept Invitation" },
      { key: "email.invite.footer", label: "Invite — Footer", description: "Footer text below the button", type: "textarea", default: "This invitation expires in 7 days." },
    ],
  },
  {
    id: "actions",
    label: "Action Extraction",
    icon: "Zap",
    description: "Thresholds for extracting homework, follow-ups, and tasks from call transcripts",
    settings: [
      { key: "actions.transcript_limit", label: "Transcript limit", description: "Maximum characters of transcript sent to AI for action extraction", type: "int" as const, default: 4000, min: 500, max: 20000, step: 500 },
      { key: "actions.min_transcript_length", label: "Min transcript length", description: "Transcripts shorter than this (chars) are skipped entirely", type: "int" as const, default: 100, min: 10, max: 1000, step: 10 },
      { key: "actions.confidence_threshold", label: "Confidence threshold", description: "Actions below this confidence score are discarded (0–1)", type: "float" as const, default: 0.6, min: 0, max: 1, step: 0.05 },
      { key: "actions.similarity_threshold", label: "Similarity threshold", description: "Actions with title similarity above this are treated as duplicates (0–1)", type: "float" as const, default: 0.8, min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    id: "defaults",
    label: "Defaults",
    icon: "Target",
    description: "Default values used when creating new entities (domains, overlays, etc.)",
    settings: [
      { key: "defaults.archetype", label: "Default archetype", description: "Base archetype slug used when scaffolding new domain overlays (e.g. TUT-001, COACH-001)", type: "text" as const, default: "TUT-001", placeholder: "e.g. TUT-001" },
    ],
  },
  {
    id: "agent_tuning",
    label: "Agent Tuning",
    icon: "Sliders",
    description: "Boston Matrix definitions, presets, and derivation weights for agent style tuning",
    settings: [
      { key: "agent_tuning.derived_confidence", label: "Derived confidence", description: "Confidence level assigned to parameters derived from matrix positions (0–1)", type: "float" as const, default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: "agent_tuning.matrices", label: "Matrix definitions (JSON)", description: "Array of matrix structures: axes, presets, derivation weights. Edit with care — invalid JSON breaks the tuning UI.", type: "textarea" as const, default: JSON.stringify(AGENT_TUNING_DEFAULTS.matrices, null, 2) },
    ],
  },
  {
    id: "extraction_filter",
    label: "Extraction Filtering",
    icon: "Filter",
    description: "Control which document sections are extracted vs skipped during content import",
    settings: [
      { key: "extraction.filter.enabled", label: "Enable section filtering", description: "Master toggle for smart section filtering during extraction", type: "bool" as const, default: true },
      { key: "extraction.filter.skip_patterns", label: "Skip patterns (JSON array)", description: "Section title patterns to skip entirely — no assertions extracted", type: "textarea" as const, default: JSON.stringify(EXTRACTION_FILTER_DEFAULTS.skipPatterns) },
      { key: "extraction.filter.reference_patterns", label: "Reference patterns (JSON array)", description: "Section title patterns to extract but tag as reference content", type: "textarea" as const, default: JSON.stringify(EXTRACTION_FILTER_DEFAULTS.referencePatterns) },
      { key: "extraction.filter.min_section_chars", label: "Min section characters", description: "Sections shorter than this are skipped (likely blank or trivial)", type: "int" as const, default: 50, min: 0, max: 1000, step: 10 },
    ],
  },
  {
    id: "content_linking",
    label: "Content Linking",
    icon: "Link",
    description: "Auto-linking questions and vocabulary to their parent teaching assertions after extraction",
    settings: [
      { key: "content_linking.min_keyword_score", label: "Min keyword overlap", description: "Minimum keyword overlap score to consider a link (0–1)", type: "float" as const, default: 0.15, min: 0, max: 1, step: 0.05 },
      { key: "content_linking.lo_ref_match_boost", label: "LO ref match boost", description: "Score boost when question and assertion share a learning outcome ref", type: "float" as const, default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: "content_linking.chapter_match_boost", label: "Chapter match boost", description: "Score boost when question and assertion are in the same chapter/section", type: "float" as const, default: 0.2, min: 0, max: 1, step: 0.05 },
      { key: "content_linking.min_link_score", label: "Min link score", description: "Minimum combined score to create a link (0–1)", type: "float" as const, default: 0.35, min: 0, max: 1, step: 0.05 },
      { key: "content_linking.use_vector_similarity", label: "Use vector similarity", description: "Use pgvector cosine similarity for semantic matching (requires assertion embeddings)", type: "bool" as const, default: true },
      { key: "content_linking.min_vector_similarity", label: "Min vector similarity", description: "Minimum cosine similarity when using vector mode (0–1)", type: "float" as const, default: 0.6, min: 0, max: 1, step: 0.05 },
    ],
  },
];
