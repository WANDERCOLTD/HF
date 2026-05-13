/**
 * AI Call Points — Single Source of Truth
 *
 * Canonical registry of every AI call point in the system.
 * Both config-loader.ts and ai-config/route.ts import from here.
 *
 * Each call point has:
 *   - id:          unique string used in DB AIConfig table + code
 *   - label:       human-readable name shown in /x/ai-config
 *   - description: what this call point does
 *   - category:    grouping for the UI
 *   - defaults:    provider, model, temperature, maxTokens
 *   - defaultTranscriptLimit: optional char limit for pipeline calls
 *
 * Resolution cascade (highest priority first):
 *   1. DB AIConfig table (admin overrides via /x/ai-config)
 *   2. SystemSettings fallback (fallback:ai.default_models)
 *   3. These compiled defaults (code-level safety net)
 *
 * timeoutMs: AI call timeout in milliseconds.
 *   Default: 30_000 (30s) when not specified.
 *   Cascades: caller option > DB AIConfig > call-point default > 30_000.
 */

import { config } from "@/lib/config";

// =====================================================
// TYPES
// =====================================================

export type AIConfigCategory =
  | "conversation"
  | "call-analysis"
  | "content-processing"
  | "course-setup"
  | "admin-ai"
  | "advanced";

export const AI_CONFIG_CATEGORY_META: Record<AIConfigCategory, { label: string; order: number; description: string }> = {
  "conversation":       { label: "Conversation AI",    order: 0, description: "Powers the live tutoring experience" },
  "call-analysis":      { label: "Call Analysis",      order: 1, description: "What the system learns after each call" },
  "content-processing": { label: "Content Processing", order: 2, description: "Analysing and structuring uploaded documents" },
  "course-setup":       { label: "Course Setup",       order: 3, description: "Building curriculum, lesson plans, and courses" },
  "admin-ai":           { label: "Admin AI",           order: 4, description: "AI tools that help administrators" },
  "advanced":           { label: "Advanced",           order: 5, description: "Specs, standalone analysis, developer tools" },
};

export interface CallPointDefaults {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Timeout in milliseconds. Default: 30_000 when omitted. */
  timeoutMs?: number;
}

export interface CallPointDef {
  id: string;
  label: string;
  description: string;
  category: AIConfigCategory;
  defaults: CallPointDefaults;
  defaultTranscriptLimit?: number;
}

// =====================================================
// CANONICAL CALL POINT REGISTRY
// =====================================================

export const CALL_POINTS: CallPointDef[] = [
  // ── Call Analysis ──
  {
    id: "pipeline.measure",
    label: "Pipeline - MEASURE",
    description: "Scores caller parameters from transcript (Big 5 personality, engagement, etc.)",
    category: "call-analysis",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 4096 },
    defaultTranscriptLimit: 4000,
  },
  {
    id: "pipeline.learn",
    label: "Pipeline - LEARN",
    description: "Extracts facts and memories about the caller from transcript",
    category: "call-analysis",
    defaults: { provider: "claude", model: config.ai.claude.model },
    defaultTranscriptLimit: 4000,
  },
  {
    id: "pipeline.score_agent",
    label: "Pipeline - SCORE_AGENT",
    description: "Evaluates agent behavior against targets (warmth, empathy, etc.)",
    category: "call-analysis",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 4096 },
    defaultTranscriptLimit: 4000,
  },
  {
    id: "pipeline.adapt",
    label: "Pipeline - ADAPT",
    description: "Computes personalized behavior targets based on caller profile",
    category: "call-analysis",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 1024 },
    defaultTranscriptLimit: 2000,
  },
  {
    id: "pipeline.extract_goals",
    label: "Pipeline - Goal Extraction",
    description: "Extracts learner goals from transcript",
    category: "call-analysis",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 1024 },
    defaultTranscriptLimit: 3000,
  },
  {
    id: "pipeline.artifacts",
    label: "Pipeline - Artifact Extraction",
    description: "Extracts conversation artifacts (summaries, facts, exercises) to share with the learner",
    category: "call-analysis",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
    defaultTranscriptLimit: 4000,
  },
  {
    id: "pipeline.actions",
    label: "Pipeline - Action Extraction",
    description: "Extracts actionable items (homework, follow-ups, tasks, reminders) from call transcripts",
    category: "call-analysis",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
    defaultTranscriptLimit: 4000,
  },

  // ── Conversation AI ──
  {
    id: "compose.prompt",
    label: "Prompt Composition",
    description: "Generates personalized agent guidance prompts",
    category: "conversation",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "test-harness.system",
    label: "Test Harness - System Agent",
    description: "System agent turns in simulated conversations",
    category: "conversation",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "test-harness.caller",
    label: "Test Harness - Caller Persona",
    description: "Caller persona turns in simulated conversations",
    category: "conversation",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "test-harness.greeting",
    label: "Test Harness - Greeting",
    description: "Initial AI greeting for onboarding calls",
    category: "conversation",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },

  // ── Content Processing ──
  {
    id: "content-trust.classify",
    label: "Content Trust - Classify",
    description: "Classifies document type (CURRICULUM, TEXTBOOK, etc.) from text sample",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 500 },
  },
  {
    id: "content-trust.quick-extract",
    label: "Content Trust - Quick Extract",
    description: "Fast first-pass extraction of key teaching points (shown as preview while full extraction runs)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 1500, timeoutMs: 15_000 },
  },
  {
    id: "content-trust.extract",
    label: "Content Trust - Extraction",
    description: "Extracts assertions from training materials (generic + curriculum extractor)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.1, maxTokens: 4000, timeoutMs: 120_000 },
  },
  {
    id: "content-trust.extract-comprehension",
    label: "Content Trust - Comprehension Extraction",
    description: "Specialist extractor for comprehension docs (3 arrays: assertions + questions + vocabulary)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 8192, timeoutMs: 120_000 },
  },
  {
    id: "content-trust.extract-assessment",
    label: "Content Trust - Assessment Extraction",
    description: "Specialist extractor for assessment docs (assertions + questions with rubrics)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 8192, timeoutMs: 120_000 },
  },
  {
    id: "content-trust.extract-reading-passage",
    label: "Content Trust - Reading Passage Extraction",
    description: "Specialist extractor for standalone reading passages (assertions + vocabulary)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 4000, timeoutMs: 120_000 },
  },
  {
    id: "content-trust.extract-question-bank",
    label: "Content Trust - Question Bank Extraction",
    description: "Specialist extractor for tutor question banks (3 arrays + tiered model responses)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 16384, timeoutMs: 120_000 },
  },
  {
    id: "content-trust.generate-mcq",
    label: "Content Trust - Generate MCQs",
    description: "Generates MCQ questions from content assertions with bloom-distributed distractors",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 4000, timeoutMs: 60_000 },
  },
  {
    id: "content-trust.generate-mcq-comprehension",
    label: "Content Trust - Generate MCQs (Comprehension)",
    description: "Generates MCQ questions from TUTOR_QUESTION bank with tiered-response distractors",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 4000, timeoutMs: 60_000 },
  },
  {
    id: "content-trust.validate-mcq",
    label: "Content Trust - Validate MCQs",
    description: "AI quality review of generated MCQs — flags arguably-correct distractors, reading level mismatches",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 2000, timeoutMs: 30_000 },
  },
  {
    id: "content-trust.segment",
    label: "Content Trust - Segment",
    description: "Segments composite documents into logical sections for targeted extraction",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "content-trust.structure",
    label: "Content Trust - Structure",
    description: "Structures extracted assertions into hierarchical topics and modules",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.2, maxTokens: 8000, timeoutMs: 120_000 },
  },
  {
    id: "content-trust.retag-orphans",
    label: "Content Trust - Retag Orphan Assertions",
    description: "Re-links orphaned ContentAssertions to LearningOutcomes via AI mapping (reconcile-child-parent generic util)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 4000, timeoutMs: 90_000 },
  },
  {
    id: "content-trust.retag-mcqs",
    label: "Content Trust - Retag MCQ Questions",
    description: "Re-links orphan MCQ Questions to LearningOutcomes via AI mapping (reconcile-child-parent generic util)",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 4000, timeoutMs: 90_000 },
  },
  {
    id: "content-sources.suggest",
    label: "Materials - Suggest",
    description: "Suggests content source metadata from document text",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "course-pack.analyze",
    label: "Course Pack - Analyze",
    description: "Groups uploaded course files into subjects by analysing content",
    category: "content-processing",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },

  // ── Course Setup ──
  {
    id: "content-trust.curriculum",
    label: "Content Trust - Curriculum",
    description: "Generates structured curriculum from extracted assertions",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 8000, timeoutMs: 90_000 },
  },
  {
    id: "content-trust.curriculum-from-goals",
    label: "Content Trust - Curriculum from Goals",
    description: "Generates structured curriculum from subject + persona + learning goals (no document upload)",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 8000, timeoutMs: 60_000 },
  },
  {
    id: "content-trust.curriculum-skeleton",
    label: "Content Trust - Curriculum Skeleton",
    description: "Fast skeleton curriculum (titles + descriptions only) using lightweight model",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 2000, timeoutMs: 15_000 },
  },
  {
    id: "content-trust.lesson-plan",
    label: "Content Trust - Lesson Plan",
    description: "Generates lesson plan structure from curriculum assertions",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.model, timeoutMs: 90_000 },
  },
  {
    id: "lesson-plan.generate",
    label: "Lesson Plan - Generate",
    description: "AI-generates a structured lesson plan with per-session phases from curriculum modules using a pedagogical model (Direct Instruction, 5E, Spiral, Mastery, Project-Based)",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.model, timeoutMs: 90_000 },
  },
  {
    id: "targets.suggest",
    label: "Targets - Suggest",
    description: "Suggests adaptation targets for a playbook based on spec parameters",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "quick-launch.suggest-name",
    label: "Quick Launch - Suggest Name",
    description: "Suggests a short course name from a free-text brief",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "quick-launch.identity",
    label: "Quick Launch - Identity",
    description: "Generates agent identity configuration from domain assertions",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.4 },
  },
  {
    id: "demonstrate.suggest",
    label: "Demonstrate - Suggest Goals",
    description: "Suggests session goals for the demonstrate flow",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "community.suggest-description",
    label: "Community - Suggest Description",
    description: "Suggests a one-sentence description for a new community hub",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.4, maxTokens: 80 },
  },
  {
    id: "classroom.suggest-name",
    label: "Classroom - Suggest Name",
    description: "Suggests cohort names from institution and department context",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.5, maxTokens: 120 },
  },
  {
    id: "classroom.suggest-description",
    label: "Classroom - Suggest Description",
    description: "Drafts a short description for a cohort from its name and institution",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.4, maxTokens: 80 },
  },
  {
    id: "community.suggest-kind",
    label: "Community - Suggest Kind",
    description: "Classifies community as topic-based or open-connection from its description",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.1, maxTokens: 60 },
  },
  {
    id: "community.suggest-pattern",
    label: "Community - Suggest Pattern",
    description: "Suggests an interaction pattern from a hub or topic description",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.2, maxTokens: 60 },
  },
  {
    id: "courses.suggest-outcomes",
    label: "Course - Suggest Outcomes",
    description: "Generates learning outcomes for a course name",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "courses.suggest-type",
    label: "Course - Suggest Type",
    description: "Classifies course name into teaching mode (recall, comprehension, practice, syllabus)",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "institutions.suggest-welcome",
    label: "Institution - Suggest Welcome",
    description: "Generates welcome messages for a new institution",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "quick-launch.auto-goals",
    label: "Quick Launch - Auto Goals",
    description: "Generates learning goals when user does not provide any",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 200 },
  },
  {
    id: "scaffold.generate-groups",
    label: "Scaffold - Generate Groups",
    description: "Generates department/group structure from institution description",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 2000 },
  },

  // ── Wizard AI ──
  {
    id: "wizard.get-started",
    label: "Get Started Wizard",
    description: "AI-guided onboarding conversation for setting up institutions and courses",
    category: "course-setup",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.7, maxTokens: 500, timeoutMs: 15_000 },
  },

  // ── Admin AI ──
  {
    id: "chat.stream",
    label: "Chat (Streaming)",
    description: "Interactive chat completions with streaming",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "chat.data",
    label: "Chat - Data",
    description: "Data exploration mode with tool calling in the chat panel",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.7, maxTokens: 4000 },
  },
  {
    id: "chat.call",
    label: "Chat - Call Analysis",
    description: "Call analysis mode in the chat panel",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.85, maxTokens: 300 },
  },
  {
    id: "chat.bug",
    label: "Chat - Bug Report",
    description: "Bug report analysis mode in the chat panel",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 2000 },
  },
  {
    id: "assistant.chat",
    label: "AI Assistant - General",
    description: "General-purpose AI assistant with system context awareness",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "assistant.tasks",
    label: "AI Assistant - Tasks",
    description: "Task-focused AI assistant for workflow completion",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "assistant.data",
    label: "AI Assistant - Data",
    description: "Data exploration AI assistant for querying and understanding system data",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "assistant.spec",
    label: "AI Assistant - Spec",
    description: "Spec-focused AI assistant for spec creation and troubleshooting",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "workflow.classify",
    label: "Workflow - Course Intake",
    description: "Multi-turn intake conversation that understands user intent and generates guided workflow plans",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "workflow.step",
    label: "Workflow - Step Guidance",
    description: "Per-step AI guidance during workflow execution (field suggestions, validation help, context)",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "workflow.step-guidance",
    label: "Workflow - Step Guidance (Active)",
    description: "Per-step AI guidance during active workflow execution",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },

  {
    id: "prompt-analyzer.analyse",
    label: "Prompt Analyzer",
    description: "Analyses prompt diffs and maps changes to admin surfaces and settings",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 2000 },
  },

  {
    id: "prompt-eval.analyse",
    label: "Prompt Eval",
    description: "Evaluates a composed call prompt against quality rubric and suggests actionable improvements",
    category: "admin-ai",
    defaults: { provider: "claude", model: config.ai.claude.model, temperature: 0.3, maxTokens: 3000, timeoutMs: 30_000 },
  },

  // ── Advanced ──
  {
    id: "analysis.measure",
    label: "Analysis - MEASURE",
    description: "Standalone parameter scoring (used by /api/analysis/run)",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "analysis.learn",
    label: "Analysis - LEARN",
    description: "Standalone memory extraction (used by /api/analysis/run)",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "parameter.enrich",
    label: "Parameter Enrichment",
    description: "Enriches parameter definitions with KB context",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "bdd.parse",
    label: "BDD Parser",
    description: "Parses BDD specifications into structured data",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "spec.assistant",
    label: "Spec Creation Assistant",
    description: "AI assistant for creating and editing BDD specifications",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "spec.view",
    label: "Spec View Assistant",
    description: "AI assistant for viewing and understanding BDD specifications",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "spec.extract",
    label: "Spec Structure Extraction",
    description: "Converts raw documents into structured BDD specification JSON",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.model },
  },
  {
    id: "spec.parse",
    label: "Spec Document Parser",
    description: "Detects document type for BDD spec conversion (CURRICULUM, MEASURE, etc.)",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.lightModel },
  },
  {
    id: "agent-tuner.interpret",
    label: "Agent Tuner - Interpret",
    description: "Interprets natural-language tuning instructions into parameter adjustments",
    category: "advanced",
    defaults: { provider: "claude", model: config.ai.claude.lightModel, temperature: 0.3, maxTokens: 2048 },
  },
];

// =====================================================
// LOOKUP HELPERS
// =====================================================

/** Map for O(1) call point lookup */
const _callPointMap = new Map(CALL_POINTS.map((cp) => [cp.id, cp]));

/** Get a call point definition by ID. Returns undefined if not found. */
export function getCallPointDef(id: string): CallPointDef | undefined {
  return _callPointMap.get(id);
}

/** Get all call point IDs as a Set (for validation). */
export function getCallPointIds(): Set<string> {
  return new Set(_callPointMap.keys());
}

/** Build a defaults map keyed by call point ID (for config-loader). */
export function getDefaultsMap(): Record<string, CallPointDefaults> {
  const map: Record<string, CallPointDefaults> = {};
  for (const cp of CALL_POINTS) {
    map[cp.id] = cp.defaults;
  }
  return map;
}
