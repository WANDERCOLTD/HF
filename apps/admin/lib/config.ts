/**
 * Centralized Configuration
 *
 * Single source of truth for all environment variables.
 * - Validates required vars on first access
 * - Provides typed access with sensible defaults
 * - Fails fast if critical config is missing
 *
 * Usage:
 *   import { config } from '@/lib/config';
 *   const url = config.database.url;
 *   const model = config.ai.openai.model;
 */

// =============================================================================
// Module-scoped caches
// =============================================================================

/**
 * Mode-kill epic #566 — cache for the per-playbook override list. Read once
 * from disk on first access, then re-used for the process lifetime. Restart
 * the dev server to pick up changes to evidence-first-playbooks.json.
 */
let _evidenceFirstPlaybookCache: string[] | null = null;

// =============================================================================
// Helpers
// =============================================================================

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `See .env.example for configuration options.`
    );
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function optionalInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid integer for ${name}: "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function optionalFloat(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    console.warn(`Invalid float for ${name}: "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function optionalBool(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

// =============================================================================
// Configuration Object
// =============================================================================

export const config = {
  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------
  database: {
    /** PostgreSQL connection string [REQUIRED] */
    get url(): string {
      return required("DATABASE_URL");
    },
  },

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------
  auth: {
    /** Superadmin token for API access [REQUIRED] */
    get superadminToken(): string {
      return required("HF_SUPERADMIN_TOKEN");
    },
  },

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------
  security: {
    /**
     * Internal API secret for server-to-server calls.
     * REQUIRED in production. In dev, falls back to a fixed value so the
     * key fingerprint stays stable across DATABASE_URL swaps (sandbox/staging/pilot).
     */
    get internalApiSecret(): string {
      const envVal = process.env.INTERNAL_API_SECRET;
      if (envVal) return envVal;
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "INTERNAL_API_SECRET is required in production.\n" +
            "Generate with: openssl rand -hex 32"
        );
      }
      return "dev-internal-fallback";
    },
    /**
     * GCP KMS key resource path for column-level envelope encryption.
     * Format: `projects/<proj>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>`.
     *
     * REQUIRED in production (validated at boot below). In dev / test, when
     * empty, the `kmsBypass` flag below flips on and `lib/crypto/envelope.ts`
     * uses a sentinel passthrough mode — no real cipher applied, encrypt /
     * decrypt are identity. The build-time guard fails the prod build if
     * this is unset, so the bypass branch cannot ship.
     *
     * @see docs/decisions/2026-06-13-kms-envelope-encryption-prereq.md
     * @see lib/crypto/envelope.ts
     */
    get kmsKekName(): string {
      return process.env.KMS_KEK_NAME ?? "";
    },
    /**
     * True when `kmsKekName` is unset AND we are not in production.
     * `lib/crypto/envelope.ts` reads this to decide whether to short-circuit
     * to the dev passthrough.
     */
    get kmsBypass(): boolean {
      return (
        !process.env.KMS_KEK_NAME &&
        process.env.NEXT_PUBLIC_APP_ENV !== "PROD"
      );
    },
    /** CORS allowed origins (comma-separated). Empty = no cross-origin allowed. */
    get corsAllowedOrigins(): string[] {
      const origins = process.env.CORS_ALLOWED_ORIGINS;
      return origins ? origins.split(",").map((o) => o.trim()).filter(Boolean) : [];
    },
    /**
     * Identity PIN settings (#1101 — first-call continuity attestation).
     * All env-overridable so test environments can shorten TTLs.
     */
    identityPin: {
      /** PIN TTL in hours (default 24) — after this, verify returns expired:true. */
      get ttlHours(): number {
        return optionalInt("IDENTITY_PIN_TTL_HOURS", 24);
      },
      /** Max wrong attempts in 24h before lockout (default 5). */
      get maxAttempts(): number {
        return optionalInt("IDENTITY_PIN_MAX_ATTEMPTS", 5);
      },
      /** Max resends in 24h, not counting the initial issuance (default 3). */
      get maxResendsPer24h(): number {
        return optionalInt("IDENTITY_PIN_MAX_RESENDS", 3);
      },
      /** Minimum seconds between resend requests (default 60). */
      get resendCooldownSeconds(): number {
        return optionalInt("IDENTITY_PIN_RESEND_COOLDOWN_SECONDS", 60);
      },
    },
  },

  // ---------------------------------------------------------------------------
  // AI Services
  // ---------------------------------------------------------------------------
  ai: {
    openai: {
      /** OpenAI API key (uses HF_MVP_KEY if set, otherwise OPENAI_API_KEY) */
      get apiKey(): string | undefined {
        return process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY;
      },
      /** OpenAI model ID */
      get model(): string {
        return optional("OPENAI_MODEL_ID", "gpt-4o");
      },
      /** OpenAI embedding model ID */
      get embeddingModel(): string {
        return optional("OPENAI_EMBEDDING_MODEL_ID", "text-embedding-3-small");
      },
      /** Check if OpenAI is configured */
      get isConfigured(): boolean {
        return !!(process.env.OPENAI_HF_MVP_KEY || process.env.OPENAI_API_KEY);
      },
    },
    claude: {
      /** Anthropic API key */
      get apiKey(): string | undefined {
        return process.env.ANTHROPIC_API_KEY;
      },
      /** Claude model ID */
      get model(): string {
        return optional("CLAUDE_MODEL_ID", "claude-sonnet-4-5-20250929");
      },
      /** Claude lightweight model ID (for fast/cheap tasks) */
      get lightModel(): string {
        return optional("CLAUDE_LIGHT_MODEL_ID", "claude-haiku-4-5-20251001");
      },
      /** Check if Claude is configured */
      get isConfigured(): boolean {
        return !!process.env.ANTHROPIC_API_KEY;
      },
    },
    defaults: {
      /** Default max tokens for AI completions */
      get maxTokens(): number {
        return optionalInt("AI_DEFAULT_MAX_TOKENS", 1024);
      },
      /** Default temperature for AI completions */
      get temperature(): number {
        return optionalFloat("AI_DEFAULT_TEMPERATURE", 0.7);
      },
    },
  },

  // ---------------------------------------------------------------------------
  // File Paths
  // ---------------------------------------------------------------------------
  paths: {
    /** Knowledge base root directory */
    get kb(): string {
      return optional("HF_KB_PATH", "../../knowledge");
    },
    /** Parameters CSV path for import script */
    get parametersCsv(): string {
      return optional("HF_PARAMETERS_CSV", "./backlog/parameters.csv");
    },
    /** Transcripts directory (optional override) */
    get transcripts(): string | undefined {
      return process.env.HF_TRANSCRIPTS_PATH;
    },
  },

  // ---------------------------------------------------------------------------
  // Feature Flags
  // ---------------------------------------------------------------------------
  features: {
    /** Enable filesystem operations (agents, manifest sync, etc.) */
    get opsEnabled(): boolean {
      return process.env.HF_OPS_ENABLED === "true";
    },
    /**
     * Session Flow resolver — when true, transforms read learner-flow config
     * via resolveSessionFlow(); when false they read legacy Playbook.config
     * fields directly. Default false. Flipped per-environment as the epic
     * (#221) ships through the phases. ADR 2026-04-29.
     */
    get sessionFlowResolverEnabled(): boolean {
      return optionalBool("SESSION_FLOW_RESOLVER_ENABLED", false);
    },
    /**
     * Author-declared module catalogue (Issue #236). When true, the wizard
     * collects authored modules and the runtime surfaces a learner picker
     * driven by `PlaybookConfig.modules`. When false (default), the existing
     * derived-modules path runs unchanged. Flag is read by the wizard step,
     * the Module Catalogue editor, and the picker — but NOT by the parser
     * itself, which is always safe to run (additive, no side effects).
     */
    get authoredModulesEnabled(): boolean {
      return optionalBool("AUTHORED_MODULES_ENABLED", false);
    },
    /**
     * Legacy Subject-chain fallback in SectionDataLoader.resolveContentScope
     * (#482). When true, retains the pre-#478 behaviour: if PlaybookSource
     * is empty, fall through to PlaybookSubject → Subject → SubjectSource,
     * and then to a domain-wide SubjectDomain fallback. When false (default,
     * #482-onwards), content scope resolves strictly via PlaybookSource —
     * empty PlaybookSource means empty scope. Kept as a kill switch for one
     * sprint in case the #481 backfill missed any legacy course.
     */
    get contentScopeSubjectFallbackEnabled(): boolean {
      return optionalBool("CONTENT_SCOPE_SUBJECT_FALLBACK_ENABLED", false);
    },
    /**
     * Local Whisper STT + OpenAI TTS voice mode on SimChat (#1092). When
     * true the existing mic-icon toggle stays visible and `useVoiceMode`
     * remains functional — useful for offline dev / regression testing.
     * When false (default once `[Call me]` ships) the mic icon is hidden
     * from the SIM and learners use the provider-backed call button.
     * Tests set this to true in tests/setup.ts so the existing useVoiceMode
     * tests stay green.
     */
    get localSimVoiceMode(): boolean {
      return optionalBool("LOCAL_SIM_VOICE_MODE", false);
    },
  },

  // ---------------------------------------------------------------------------
  // Terminology
  // ---------------------------------------------------------------------------
  terminology: {
    /** Default terminology preset when no institution config exists.
     *  One of: school, corporate, coaching, healthcare.
     *  Can be overridden via TERMINOLOGY_DEFAULT_PRESET env var. */
    get defaultPreset(): string {
      return optional("TERMINOLOGY_DEFAULT_PRESET", "corporate");
    },
  },

  // ---------------------------------------------------------------------------
  // Canonical Specs (Architectural Dependencies)
  // ---------------------------------------------------------------------------
  specs: {
    /**
     * Onboarding Spec (default: INIT-001)
     * Defines first-call experience, personas (tutor/companion/coach), and welcome templates.
     * Can be overridden via ONBOARDING_SPEC_SLUG env var.
     */
    get onboarding(): string {
      return optional("ONBOARDING_SPEC_SLUG", "INIT-001");
    },

    /**
     * Pipeline Spec (default: PIPELINE-001)
     * Defines pipeline stages: EXTRACT → AGGREGATE → REWARD → ADAPT → SUPERVISE → COMPOSE
     * Can be overridden via PIPELINE_SPEC_SLUG env var.
     */
    get pipeline(): string {
      return optional("PIPELINE_SPEC_SLUG", "PIPELINE-001");
    },

    /**
     * Pipeline Fallback Spec (default: GUARD-001)
     * Legacy spec used as fallback when PIPELINE-001 is not found.
     * Can be overridden via PIPELINE_FALLBACK_SPEC_SLUG env var.
     */
    get pipelineFallback(): string {
      return optional("PIPELINE_FALLBACK_SPEC_SLUG", "GUARD-001");
    },

    /**
     * Compose Spec slug (default: spec-comp-001)
     * The COMPOSE spec that drives prompt composition. Identifies the
     * `AnalysisSpec` row whose `config` carries the section list,
     * thresholds, memory caps, etc. for `executeComposition()`.
     *
     * Default updated 2026-05-23 — previous default
     * "system-compose-next-prompt" had no DB row, causing
     * `loadComposeConfig()` to fall through to a permissive findFirst
     * that picked archetype/identity specs non-deterministically (see
     * `loadComposeConfig.ts` long-comment for the full root-cause).
     *
     * Override via COMPOSE_SPEC_SLUG env var when seeding a custom
     * composer (e.g. multi-tenant variants).
     */
    get compose(): string {
      return optional("COMPOSE_SPEC_SLUG", "spec-comp-001");
    },

    /**
     * Voice Spec slug pattern (default: voice)
     * Used to find the voice/identity spec by slug pattern match.
     * Can be overridden via VOICE_SPEC_SLUG_PATTERN env var.
     */
    get voicePattern(): string {
      return optional("VOICE_SPEC_SLUG_PATTERN", "voice");
    },

    /**
     * Voice Tools spec slug (default: TOOLS-001) — AnyVoice #1019.
     * Identifies the AnalysisSpec whose config.tools array carries the
     * voice-call custom tool definitions. The VapiProvider adapter
     * reads this at call-start; missing/empty spec falls back to no
     * tools (call continues without RAG / mid-call actions). Override
     * via VOICE_TOOLS_SPEC_SLUG when seeding a custom tool catalogue.
     */
    get voiceTools(): string {
      return optional("VOICE_TOOLS_SPEC_SLUG", "TOOLS-001");
    },

    /**
     * Onboarding prompt slug prefix (default: init.)
     * Used to generate welcome/phase slug names for personas.
     * Can be overridden via ONBOARDING_SLUG_PREFIX env var.
     */
    get onboardingSlugPrefix(): string {
      return optional("ONBOARDING_SLUG_PREFIX", "init.");
    },

    /**
     * Content Extract Spec (default: CONTENT-EXTRACT-001)
     * Defines teaching point extraction rules, pyramid structuring, and rendering config.
     * Domain-level override specs deep-merge onto this system spec.
     * Can be overridden via SPEC_CONTENT_EXTRACT env var.
     */
    get contentExtract(): string {
      return optional("SPEC_CONTENT_EXTRACT", "CONTENT-EXTRACT-001");
    },

    /**
     * Goal Spec (default: GOAL-001)
     * Drives goal extraction + completion-signal detection in
     * `lib/goals/extract-goals.ts`. Recorded as `CallerAttribute.sourceSpecSlug`
     * provenance on every detected goal-completion signal. Previously the only
     * spec slug written to the DB with no config backing (audit HF-I/HF-J).
     * Can be overridden via GOAL_SPEC_SLUG env var.
     */
    get goal(): string {
      return optional("GOAL_SPEC_SLUG", "GOAL-001");
    },

    /**
     * Goal Progress Spec (default: GOAL-PROGRESS-001)
     * Drives `goal_progress_strategies` resolution in
     * `lib/goals/strategies/resolve-strategy.ts`. Loaded via `findFirst` with
     * a tolerant `slug IN (canonical, lowercase)` clause. Can be overridden
     * via GOAL_PROGRESS_SPEC_SLUG env var (audit HF-I sweep).
     */
    get goalProgress(): string {
      return optional("GOAL_PROGRESS_SPEC_SLUG", "GOAL-PROGRESS-001");
    },

    /**
     * Comprehension-skills aggregation spec (default: COMP-AGG-001)
     * `AGGREGATE` stage spec that writes `CallerAttribute(scope='COMP-AGG-001')`
     * rows. Read by `quickstart.ts` _learning_guidance + the
     * learning-trajectory + cohort-learning API routes to surface aggregated
     * competency. Can be overridden via COMP_AGG_SPEC_SLUG env var (audit HF-I sweep).
     */
    get aggComprehension(): string {
      return optional("COMP_AGG_SPEC_SLUG", "COMP-AGG-001");
    },

    /**
     * Discussion-skills aggregation spec (default: DISC-AGG-001)
     * Sibling of `aggComprehension` for discussion-led teaching profiles.
     * Can be overridden via DISC_AGG_SPEC_SLUG env var.
     */
    get aggDiscussion(): string {
      return optional("DISC_AGG_SPEC_SLUG", "DISC-AGG-001");
    },

    /**
     * Coaching-progress aggregation spec (default: COACH-AGG-001)
     * Sibling of `aggComprehension` for coaching-led teaching profiles.
     * Can be overridden via COACH_AGG_SPEC_SLUG env var.
     */
    get aggCoaching(): string {
      return optional("COACH_AGG_SPEC_SLUG", "COACH-AGG-001");
    },

    /**
     * Behavior-aggregation spec (default: BEH-AGG-001)
     * Single AGGREGATE spec with 9 domain-grouped sections (companion,
     * personality, supervision, engagement, curriculum, learning,
     * reinforcement, onboarding, core-style). Born of #1967 M2 closing
     * the link-8 cascade-feedback loop for 70 measured BEH-* params.
     * Read by `quickstart.ts` _learning_guidance via scope filter (not
     * by per-key hardcoding) — surfaces rolled-up behavior_profile:*
     * signals into the composed prompt.
     * Can be overridden via BEH_AGG_SPEC_SLUG env var.
     */
    get aggBehavior(): string {
      return optional("BEH_AGG_SPEC_SLUG", "BEH-AGG-001");
    },

    /**
     * Cognitive Activation MEASURE spec (default: CA-001-cognitive-activation)
     * Source of the CallScore rows that BEH-AGG-001 rolls up into the
     * `behavior_profile:engagement:cognitive_activation` /
     * `:conversational_dominance` / `:tone_assertiveness` namespaces. Read by the
     * sub-epic #2086 engagement-targets manifest (lib/pipeline/engagement-targets-manifest.ts).
     * Can be overridden via CA_001_SPEC_SLUG env var.
     */
    get cognitiveActivation(): string {
      return optional("CA_001_SPEC_SLUG", "CA-001-cognitive-activation");
    },

    /**
     * Engagement Adaptation spec (default: ADAPT-ENG-001-engagement-adaptation)
     * The ADAPT spec that adapt-runner consumes for the 13 engagement+onboarding
     * targets wired by sub-epic #2086 (S4 of #2078). Also self-measures its own
     * fidelity (BEH-CALL-FREQUENCY-ADAPTATION etc.) — see the engagement section
     * of BEH-AGG-001 for the roll-up keys.
     * Can be overridden via ADAPT_ENG_SPEC_SLUG env var.
     */
    get adaptEng(): string {
      return optional("ADAPT_ENG_SPEC_SLUG", "ADAPT-ENG-001-engagement-adaptation");
    },

    /**
     * Caller Onboarding MEASURE spec (default: INIT-001-caller-onboarding)
     * Source of the one-shot onboarding-quality scores rolled up by BEH-AGG-001's
     * onboarding section. Read by the sub-epic #2086 engagement-targets manifest
     * for the 3 onboarding-quality parameter bindings.
     * Can be overridden via INIT_001_SPEC_SLUG env var.
     */
    get callerOnboarding(): string {
      return optional("INIT_001_SPEC_SLUG", "INIT-001-caller-onboarding");
    },

    /**
     * Default Archetype Spec (default: TUT-001)
     * The base archetype used when scaffolding new domain overlays.
     * Can be overridden via DEFAULT_ARCHETYPE_SLUG env var.
     */
    get defaultArchetype(): string {
      return optional("DEFAULT_ARCHETYPE_SLUG", "TUT-001");
    },

    /**
     * Coach Archetype Spec (default: COACH-001)
     * Used for corporate, coaching, training institution types and the coaching interaction pattern.
     * Can be overridden via COACH_ARCHETYPE_SLUG env var.
     */
    get coachArchetype(): string {
      return optional("COACH_ARCHETYPE_SLUG", "COACH-001");
    },

    /**
     * Companion Archetype Spec (default: COMPANION-001)
     * Used for community, healthcare institution types and open/companion interaction patterns.
     * Can be overridden via COMPANION_ARCHETYPE_SLUG env var.
     */
    get companionArchetype(): string {
      return optional("COMPANION_ARCHETYPE_SLUG", "COMPANION-001");
    },

    /**
     * Advisor Archetype Spec (default: ADVISOR-001)
     * Used for the advisory interaction pattern.
     * Can be overridden via ADVISOR_ARCHETYPE_SLUG env var.
     */
    get advisorArchetype(): string {
      return optional("ADVISOR_ARCHETYPE_SLUG", "ADVISOR-001");
    },

    /**
     * Facilitator Archetype Spec (default: FACILITATOR-001)
     * Used for the facilitation interaction pattern.
     * Can be overridden via FACILITATOR_ARCHETYPE_SLUG env var.
     */
    get facilitatorArchetype(): string {
      return optional("FACILITATOR_ARCHETYPE_SLUG", "FACILITATOR-001");
    },

    /**
     * Conversational Guide Archetype Spec (default: CONVGUIDE-001)
     * Used for Hub/community guided 1:1 conversations around topic areas.
     * Can be overridden via CONVGUIDE_ARCHETYPE_SLUG env var.
     */
    get convguideArchetype(): string {
      return optional("CONVGUIDE_ARCHETYPE_SLUG", "CONVGUIDE-001");
    },

    /**
     * Mentor Archetype Spec (default: MENTOR-001)
     * Used for the reflective/mentoring interaction pattern.
     * Can be overridden via MENTOR_ARCHETYPE_SLUG env var.
     */
    get mentorArchetype(): string {
      return optional("MENTOR_ARCHETYPE_SLUG", "MENTOR-001");
    },

    /**
     * Content Source Setup Wizard Spec (default: CONTENT-SOURCE-SETUP-001)
     * Defines content source wizard steps: upload, extract, review.
     * Can be overridden via CONTENT_SOURCE_SETUP_SPEC_SLUG env var.
     */
    get contentSourceSetup(): string {
      return optional("CONTENT_SOURCE_SETUP_SPEC_SLUG", "CONTENT-SOURCE-SETUP-001");
    },

    /**
     * Course Setup Wizard Spec (default: COURSE-SETUP-001)
     * Defines course creation wizard steps: name, content, curriculum, review.
     * Can be overridden via COURSE_SETUP_SPEC_SLUG env var.
     */
    get courseSetup(): string {
      return optional("COURSE_SETUP_SPEC_SLUG", "COURSE-SETUP-001");
    },

    /**
     * Community Setup Wizard Spec (default: COMMUNITY-SETUP-001)
     * Defines community hub creation wizard steps.
     * Can be overridden via COMMUNITY_SETUP_SPEC_SLUG env var.
     */
    get communitySetup(): string {
      return optional("COMMUNITY_SETUP_SPEC_SLUG", "COMMUNITY-SETUP-001");
    },

    /**
     * Institution Setup Wizard Spec (default: INSTITUTION-SETUP-001)
     * Defines institution creation wizard steps: identity, branding, welcome, terminology, launch.
     * Can be overridden via INSTITUTION_SETUP_SPEC_SLUG env var.
     */
    get institutionSetup(): string {
      return optional("INSTITUTION_SETUP_SPEC_SLUG", "INSTITUTION-SETUP-001");
    },

    /**
     * Course Readiness Spec (default: COURSE-READY-001)
     * Defines post-creation review checks for institutional courses.
     * Can be overridden via COURSE_READY_SPEC_SLUG env var.
     */
    get courseReady(): string {
      return optional("COURSE_READY_SPEC_SLUG", "COURSE-READY-001");
    },

    /**
     * Community Readiness Spec (default: COMMUNITY-READY-001)
     * Defines post-creation review checks for community hubs.
     * Can be overridden via COMMUNITY_READY_SPEC_SLUG env var.
     */
    get communityReady(): string {
      return optional("COMMUNITY_READY_SPEC_SLUG", "COMMUNITY-READY-001");
    },

    /**
     * Classroom Setup Wizard Spec (default: CLASSROOM-SETUP-001)
     * Defines classroom creation wizard steps: name, courses, review, invite.
     * Can be overridden via CLASSROOM_SETUP_SPEC_SLUG env var.
     */
    get classroomSetup(): string {
      return optional("CLASSROOM_SETUP_SPEC_SLUG", "CLASSROOM-SETUP-001");
    },

    /**
     * Demonstrate Flow Wizard Spec (default: DEMONSTRATE-FLOW-001)
     * Defines demonstrate wizard steps: select domain/caller, set goal, content, preview, launch.
     * Can be overridden via DEMONSTRATE_FLOW_SPEC_SLUG env var.
     */
    get demonstrateFlow(): string {
      return optional("DEMONSTRATE_FLOW_SPEC_SLUG", "DEMONSTRATE-FLOW-001");
    },

    /**
     * Teach Flow Wizard Spec (default: TEACH-FLOW-001)
     * Defines teach wizard steps: select institution/learner, set goal, content, plan, preview, launch.
     * Can be overridden via TEACH_FLOW_SPEC_SLUG env var.
     */
    get teachFlow(): string {
      return optional("TEACH_FLOW_SPEC_SLUG", "TEACH-FLOW-001");
    },

    // ── Prompt Specs (system prompts for AI calls) ──

    /** Chat Data Helper system prompt */
    get chatDataHelper(): string {
      return optional("CHAT_DATA_HELPER_SPEC_SLUG", "PROMPT-CHAT-DATA-001");
    },
    /** Chat Bug Diagnosis system prompt */
    get chatBugDiagnosis(): string {
      return optional("CHAT_BUG_DIAGNOSIS_SPEC_SLUG", "PROMPT-CHAT-BUG-001");
    },
    /** Admin Assistant system prompt */
    get adminAssistant(): string {
      return optional("ADMIN_ASSISTANT_SPEC_SLUG", "PROMPT-ADMIN-001");
    },
    /** Tuning Assistant system prompt */
    get tuningAssistant(): string {
      return optional("TUNING_ASSISTANT_SPEC_SLUG", "PROMPT-TUNA-001");
    },
    /** Workflow Classifier system prompt */
    get workflowClassifier(): string {
      return optional("WORKFLOW_CLASSIFIER_SPEC_SLUG", "PROMPT-WORKFLOW-001");
    },
    /** Course Pack Analyzer system prompt */
    get coursePackAnalyzer(): string {
      return optional("COURSE_PACK_ANALYZER_SPEC_SLUG", "PROMPT-PACK-001");
    },
    /** Lesson Plan Generator system prompt */
    get lessonPlanGenerator(): string {
      return optional("LESSON_PLAN_GENERATOR_SPEC_SLUG", "PROMPT-PLAN-001");
    },
    /** Composition Preamble instructions */
    get compositionPreamble(): string {
      return optional("COMPOSITION_PREAMBLE_SPEC_SLUG", "PROMPT-PREAMBLE-001");
    },

    // ── Wizard Prompt Specs (shared + V5 + V4 + CourseRef) ──

    /** Wizard identity (shared V5/V4) */
    get wizIdentity(): string {
      return optional("WIZ_IDENTITY_SPEC_SLUG", "PROMPT-WIZ-IDENTITY-001");
    },
    /** Wizard communication rules (shared V5/V4) */
    get wizComms(): string {
      return optional("WIZ_COMMS_SPEC_SLUG", "PROMPT-WIZ-COMMS-001");
    },
    /** Wizard community hub detection (shared V5/V4) */
    get wizCommunity(): string {
      return optional("WIZ_COMMUNITY_SPEC_SLUG", "PROMPT-WIZ-COMMUNITY-001");
    },
    /** Wizard opening message (V5) */
    get wizOpening(): string {
      return optional("WIZ_OPENING_SPEC_SLUG", "PROMPT-WIZ-OPENING-001");
    },
    /** Wizard playback rules (V5) */
    get wizPlayback(): string {
      return optional("WIZ_PLAYBACK_SPEC_SLUG", "PROMPT-WIZ-PLAYBACK-001");
    },
    /** Wizard proposal pattern (V5) */
    get wizProposal(): string {
      return optional("WIZ_PROPOSAL_SPEC_SLUG", "PROMPT-WIZ-PROPOSAL-001");
    },
    /** Wizard content upload & classification (shared V5/V4) */
    get wizContent(): string {
      return optional("WIZ_CONTENT_SPEC_SLUG", "PROMPT-WIZ-CONTENT-001");
    },
    /** Wizard pedagogy deep interview (V5) */
    get wizPedagogy(): string {
      return optional("WIZ_PEDAGOGY_SPEC_SLUG", "PROMPT-WIZ-PEDAGOGY-001");
    },
    /** Wizard valid values (shared V5/V4) */
    get wizValues(): string {
      return optional("WIZ_VALUES_SPEC_SLUG", "PROMPT-WIZ-VALUES-001");
    },
    /** Wizard rules (V5) */
    get wizRules(): string {
      return optional("WIZ_RULES_SPEC_SLUG", "PROMPT-WIZ-RULES-001");
    },

    /** V4 wizard identity + Phase 1b absolute rule */
    get wiz4Identity(): string {
      return optional("WIZ4_IDENTITY_SPEC_SLUG", "PROMPT-WIZ4-IDENTITY-001");
    },
    /** V4 wizard intake + examples */
    get wiz4Intake(): string {
      return optional("WIZ4_INTAKE_SPEC_SLUG", "PROMPT-WIZ4-INTAKE-001");
    },
    /** V4 wizard playback rules + examples */
    get wiz4Playback(): string {
      return optional("WIZ4_PLAYBACK_SPEC_SLUG", "PROMPT-WIZ4-PLAYBACK-001");
    },
    /** V4 wizard proposal format + defaults */
    get wiz4Proposal(): string {
      return optional("WIZ4_PROPOSAL_SPEC_SLUG", "PROMPT-WIZ4-PROPOSAL-001");
    },
    /** V4 wizard rules */
    get wiz4Rules(): string {
      return optional("WIZ4_RULES_SPEC_SLUG", "PROMPT-WIZ4-RULES-001");
    },
    /** V4 wizard content upload extensions (teaching guide nudge, narration, Phase 4a/4b) */
    get wiz4ContentExtra(): string {
      return optional("WIZ4_CONTENT_EXTRA_SPEC_SLUG", "PROMPT-WIZ4-CONTENT-EXTRA-001");
    },

    /** Course Reference identity + interview approach */
    get crefIdentity(): string {
      return optional("CREF_IDENTITY_SPEC_SLUG", "PROMPT-CREF-IDENTITY-001");
    },
    /** Course Reference tools guidance */
    get crefTools(): string {
      return optional("CREF_TOOLS_SPEC_SLUG", "PROMPT-CREF-TOOLS-001");
    },
    /** Course Reference rules */
    get crefRules(): string {
      return optional("CREF_RULES_SPEC_SLUG", "PROMPT-CREF-RULES-001");
    },

    // ── Contracts (DB-backed config with code fallbacks) ──

    /** Onboarding Assessment contract (default: ONBOARDING_ASSESSMENT_V1) */
    get onboardingAssessment(): string {
      return optional("ONBOARDING_ASSESSMENT_CONTRACT_SLUG", "ONBOARDING_ASSESSMENT_V1");
    },
    /** Survey Templates contract (default: SURVEY_TEMPLATES_V1) */
    get surveyTemplates(): string {
      return optional("SURVEY_TEMPLATES_CONTRACT_SLUG", "SURVEY_TEMPLATES_V1");
    },
    /** Session Types contract (default: SESSION_TYPES_V1) */
    get sessionTypes(): string {
      return optional("SESSION_TYPES_CONTRACT_SLUG", "SESSION_TYPES_V1");
    },

    /**
     * SKILL_MEASURE_V1 DataContract identifier (default: SKILL_MEASURE_V1).
     * Carries tuned `emaHalfLifeDays`, `minCallsToFull`, `thresholds`, and
     * `tierBands` used by the SKILL_AGG aggregation pipeline + per-LO
     * tier-mapping resolution. Read at runtime by
     * `lib/pipeline/aggregate-runner.ts` and `lib/goals/track-progress.ts`.
     * Adopted #2182 — bare `ContractRegistry.getContract("SKILL_MEASURE_V1")`
     * literals are blocked by `hf-config/no-bare-spec-identifier`. Override
     * via SKILL_MEASURE_V1_CONTRACT_ID env var.
     */
    get skillMeasureV1(): string {
      return optional("SKILL_MEASURE_V1_CONTRACT_ID", "SKILL_MEASURE_V1");
    },

    /**
     * PROSODY-SCORE-V1 measurement-sentinel AnalysisSpec id
     * (default: PROSODY-SCORE-V1). The seeded sentinel row that the
     * PROSODY adapter writes against when no IELTS/PROSODY analysis
     * spec is linked to the parameter. Read by
     * `lib/measurement/write-call-score.ts::MEASUREMENT_SENTINEL_SPEC_IDS`.
     * Adopted #2182 — bare `"PROSODY-SCORE-V1"` literals are blocked
     * by `hf-config/no-bare-spec-identifier`. Override via
     * PROSODY_SCORE_V1_SPEC_ID env var.
     */
    get prosodyScoreV1(): string {
      return optional("PROSODY_SCORE_V1_SPEC_ID", "PROSODY-SCORE-V1");
    },

    /**
     * MOCK-MEASURE-V1 measurement-sentinel AnalysisSpec id
     * (default: MOCK-MEASURE-V1). The seeded sentinel row used by the
     * `engine === "mock"` pipeline branch. Read by
     * `lib/measurement/write-call-score.ts::MEASUREMENT_SENTINEL_SPEC_IDS`.
     * Adopted #2182. Override via MOCK_MEASURE_V1_SPEC_ID env var.
     */
    get mockMeasureV1(): string {
      return optional("MOCK_MEASURE_V1_SPEC_ID", "MOCK-MEASURE-V1");
    },

    /**
     * ADAPT-DELTA-V1 measurement-sentinel AnalysisSpec id
     * (default: ADAPT-DELTA-V1). The seeded sentinel row that ADAPT
     * delta scores (`<parameterId>-DELTA` rows derived from
     * current - previous) attribute against when no parent spec
     * attribution exists. Read by
     * `lib/measurement/write-call-score.ts::MEASUREMENT_SENTINEL_SPEC_IDS`.
     * Adopted #2182. Override via ADAPT_DELTA_V1_SPEC_ID env var.
     */
    get adaptDeltaV1(): string {
      return optional("ADAPT_DELTA_V1_SPEC_ID", "ADAPT-DELTA-V1");
    },

    /**
     * ENTITY_ACCESS_V1 DataContract identifier (default: ENTITY_ACCESS_V1).
     * Carries the entity-access policy matrix consumed by
     * `lib/access-control.ts::checkEntityAccess` and the admin access-
     * matrix routes. Adopted #2182. Override via
     * ENTITY_ACCESS_V1_CONTRACT_ID env var.
     */
    get entityAccessV1(): string {
      return optional("ENTITY_ACCESS_V1_CONTRACT_ID", "ENTITY_ACCESS_V1");
    },

    /**
     * EXAM_READINESS_V1 DataContract identifier (default: EXAM_READINESS_V1).
     * Read by `lib/curriculum/exam-readiness.ts`. Adopted #2182. Override
     * via EXAM_READINESS_V1_CONTRACT_ID env var.
     */
    get examReadinessV1(): string {
      return optional("EXAM_READINESS_V1_CONTRACT_ID", "EXAM_READINESS_V1");
    },

    /**
     * CURRICULUM_PROGRESS_V1 DataContract identifier
     * (default: CURRICULUM_PROGRESS_V1). Read by
     * `lib/prompt/compose-content-section.ts`. Adopted #2182.
     * Override via CURRICULUM_PROGRESS_V1_CONTRACT_ID env var.
     */
    get curriculumProgressV1(): string {
      return optional("CURRICULUM_PROGRESS_V1_CONTRACT_ID", "CURRICULUM_PROGRESS_V1");
    },
  },

  // ---------------------------------------------------------------------------
  // Scheduler (#154 Phase 1 — Slice 1 Micro-MVP; expanded in Slices 2 + 3)
  // ---------------------------------------------------------------------------
  scheduler: {
    /**
     * Slice 1 placeholder-mode escape hatch — REMOVED in Slice 2 (#155).
     * The real scheduler now writes mode from selectNextExchange; there is no
     * placeholder to override. Leaving this comment as a deprecation marker so
     * operators searching for SCHEDULER_SLICE1_PLACEHOLDER_MODE can find the
     * upgrade path: the env var is no-op; pick a preset via Playbook.config
     * instead (story #166 adds the wizard picker).
     */

    /**
     * Comma-separated list of SchedulerDecision modes that allow caller-skill
     * scoring in EXTRACT. Default "assess,practice" — only score when the prior
     * decision explicitly requested assessment or retrieval practice.
     * Override: SCHEDULER_ASSESSMENT_MODES=assess,practice,review
     *
     * Deprecated in #566 (mode-kill epic). Step 3+ routes IELTS-listed
     * playbooks through evidence-aware gating instead. This list survives for
     * legacy playbooks until Step 8 deletes the mode gate entirely.
     */
    get assessmentModes(): string[] {
      return optional("SCHEDULER_ASSESSMENT_MODES", "assess,practice")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    },

    /**
     * Mode-kill epic #566 — Step 0 flag.
     *
     * When true, playbooks in `evidenceFirstPlaybooks` use the new
     * evidence-aware gate (introduced in Step 3) instead of the legacy
     * mode-based gate (event-gate.ts). When false, all playbooks use the
     * mode gate regardless of the override list.
     *
     * Default OFF in Step 0 — no behavior change. Step 3 flips it to true
     * via env override on dev VM. Step 7 flips it globally.
     *
     * Override: EVIDENCE_FIRST_SCORING_ENABLED=true
     */
    get evidenceFirstEnabled(): boolean {
      return optional("EVIDENCE_FIRST_SCORING_ENABLED", "false") === "true";
    },

    /**
     * Mode-kill epic #566 — Step 0 per-playbook override list.
     *
     * Playbook IDs in `apps/admin/config/evidence-first-playbooks.json` route
     * through the evidence-aware gate when `evidenceFirstEnabled` is true.
     * The IELTS Speaking Practice playbook is the first canary — see #566 for
     * the rollout plan.
     *
     * Cached in-process. Restart required to pick up changes.
     */
    get evidenceFirstPlaybooks(): string[] {
      if (_evidenceFirstPlaybookCache !== null) return _evidenceFirstPlaybookCache;
      // Server-only: a recent client-side import path (typed-config
      // cascade in #1285) pulls `lib/config.ts` into the browser
      // bundle. Without this guard, Next.js's client bundler tries to
      // resolve `fs` and throws "Module not found: Can't resolve 'fs'"
      // at compile time, breaking HMR on every sim/intake page.
      // The getter is only meaningfully consulted server-side
      // (pipeline + compose); on the client we short-circuit to an
      // empty list — matches the fall-through value already used when
      // the JSON file is absent.
      if (typeof window !== "undefined") {
        _evidenceFirstPlaybookCache = [];
        return _evidenceFirstPlaybookCache;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs") as typeof import("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require("path") as typeof import("path");
        const file = path.resolve(process.cwd(), "config/evidence-first-playbooks.json");
        if (!fs.existsSync(file)) {
          _evidenceFirstPlaybookCache = [];
          return _evidenceFirstPlaybookCache;
        }
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { playbookIds?: string[] };
        _evidenceFirstPlaybookCache = Array.isArray(parsed.playbookIds) ? parsed.playbookIds : [];
        return _evidenceFirstPlaybookCache;
      } catch {
        _evidenceFirstPlaybookCache = [];
        return _evidenceFirstPlaybookCache;
      }
    },
  },

  // ---------------------------------------------------------------------------
  // VAPI Integration — credentials moved to VoiceProvider DB table in #1031.
  // VAPI_API_KEY / VAPI_WEBHOOK_SECRET are no longer read from env vars in
  // production code; VapiProvider (lib/voice/providers/vapi/index.ts) keeps
  // a transient env-var fallback for the deploy-window between code deploy
  // and seed completion, behind a console.warn. Once the seed has run on
  // every environment, the env vars can be removed from secrets too.
  //
  // autoPipeline stays as an env-var-controlled feature flag — it's a
  // behaviour switch, not a credential, so it doesn't belong in the
  // provider row. Lives on its own.
  // ---------------------------------------------------------------------------
  vapi: {
    /** Auto-run pipeline on call ingest. Feature flag, not a credential. */
    get autoPipeline(): boolean {
      return optionalBool("VAPI_AUTO_PIPELINE", true);
    },
  },

  // ---------------------------------------------------------------------------
  // Voice I/O (Sim STT + TTS — reuses OpenAI key from config.ai.openai)
  // ---------------------------------------------------------------------------
  voice: {
    /** OpenAI TTS model (tts-1 = fast, tts-1-hd = higher quality) */
    get ttsModel(): string {
      return optional("VOICE_TTS_MODEL", "tts-1");
    },
    /** OpenAI Whisper model for speech-to-text */
    get whisperModel(): string {
      return optional("VOICE_WHISPER_MODEL", "whisper-1");
    },
    /**
     * Provider-catalogue voice-ID defaults (#2184).
     *
     * Used as the last-resort fallback when neither `Playbook.config.voice.voiceId`
     * nor `VoiceProvider.config.voiceId` is set. Each entry is keyed by the
     * provider's catalogue (Deepgram Aura, future Cartesia Sonic, …) so a
     * catalogue-side rename surfaces as a config decision rather than a silent
     * synthesis break.
     *
     * Companion rule: `eslint-rules/no-hardcoded-voice-id.mjs` blocks bare
     * voice-ID literals outside `lib/voice/**` + this file. The provider regex
     * registry inside the rule mirrors the providers covered here.
     */
    defaults: {
      deepgram: {
        get voiceId(): string {
          return optional("VOICE_DEFAULT_DEEPGRAM_VOICE_ID", "aura-asteria-en");
        },
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Application
  // ---------------------------------------------------------------------------
  app: {
    /** Public-facing app URL */
    get url(): string {
      return optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    },
    /** Server port */
    get port(): number {
      return optionalInt("PORT", 3000);
    },
    /** Node environment */
    get nodeEnv(): string {
      return optional("NODE_ENV", "development");
    },
    /** Application environment label — SANDBOX | STAGING | PILOT | PROD (legacy: DEV | TEST | STG | LIVE still accepted) */
    get env(): string {
      return optional("NEXT_PUBLIC_APP_ENV", "SANDBOX");
    },
    /** DB target when the sandbox VM is pointed at a non-sandbox DB (staging | pilot) */
    get dbTarget(): string | null {
      return process.env.NEXT_PUBLIC_DB_TARGET || null;
    },
    /** Is production environment */
    get isProduction(): boolean {
      return process.env.NODE_ENV === "production";
    },
    /** Is development environment */
    get isDevelopment(): boolean {
      return process.env.NODE_ENV !== "production";
    },
  },

  // ---------------------------------------------------------------------------
  // Polling & Timeouts
  // ---------------------------------------------------------------------------
  polling: {
    /** Health check interval (ms) */
    get healthCheckMs(): number {
      return optionalInt("HEALTH_CHECK_INTERVAL_MS", 30000);
    },
    /** Agent status polling interval (ms) */
    get agentPollMs(): number {
      return optionalInt("AGENTS_POLL_INTERVAL_MS", 5000);
    },
    /** System status polling interval (ms) */
    get statusPollMs(): number {
      return optionalInt("STATUS_POLL_INTERVAL_MS", 15000);
    },
    /** Docker command timeout (ms) */
    get dockerTimeoutMs(): number {
      return optionalInt("DOCKER_TIMEOUT_MS", 5000);
    },
  },

  // ---------------------------------------------------------------------------
  // Storage (Media file storage)
  // ---------------------------------------------------------------------------
  storage: {
    /** Storage backend: "gcs" (production) or "local" (dev/test) */
    get backend(): string {
      return optional("STORAGE_BACKEND", "gcs");
    },
    /** GCS bucket name */
    get gcsBucket(): string {
      return optional("STORAGE_GCS_BUCKET", "hf-admin-prod-media");
    },
    /** Local storage path (for dev/test) */
    get localPath(): string {
      return optional("STORAGE_LOCAL_PATH", "./storage/media");
    },
    /** Maximum file size in bytes (default: 20MB) */
    get maxFileSize(): number {
      return optionalInt("STORAGE_MAX_FILE_SIZE", 20971520);
    },
    /** GCS signed URL expiry in seconds (default: 3600 = 1 hour) */
    get signedUrlExpirySec(): number {
      return optionalInt("STORAGE_SIGNED_URL_EXPIRY_SECONDS", 3600);
    },
    /** Comma-separated list of allowed MIME types */
    get allowedMimeTypes(): string[] {
      return optional(
        "STORAGE_ALLOWED_MIME_TYPES",
        "image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/wav,audio/ogg"
      ).split(",");
    },
  },

  // ---------------------------------------------------------------------------
  // Artifacts (Conversation Artifacts sub-system)
  // ---------------------------------------------------------------------------
  artifacts: {
    /** Delivery channel: "sim" (Phase 1) or "whatsapp" (Phase 2) */
    get channel(): string {
      return optional("ARTIFACTS_CHANNEL", "sim");
    },
    /** Whether artifact extraction is enabled in the pipeline */
    get enabled(): boolean {
      return optionalBool("ARTIFACTS_ENABLED", true);
    },
  },

  // ---------------------------------------------------------------------------
  // Actions (Call Actions sub-system)
  // ---------------------------------------------------------------------------
  actions: {
    /** Whether action extraction is enabled in the pipeline */
    get enabled(): boolean {
      return optionalBool("ACTIONS_ENABLED", true);
    },
  },

  // ---------------------------------------------------------------------------
  // Data Retention (GDPR)
  // ---------------------------------------------------------------------------
  retention: {
    /** Days to retain caller data. 0 = disabled (keep indefinitely). */
    get callerDataDays(): number {
      return optionalInt("RETENTION_CALLER_DATA_DAYS", 0);
    },
    /** Days to retain audit log entries. Default: 365. */
    get auditLogDays(): number {
      return optionalInt("RETENTION_AUDIT_LOG_DAYS", 365);
    },
  },

  // ---------------------------------------------------------------------------
  // Seed Mode & Profile
  // ---------------------------------------------------------------------------
  seed: {
    /**
     * SEED_MODE controls what data gets seeded.
     *   "full" (default) — All specs, demo fixtures, transcripts (dev)
     *   "prod"           — Infrastructure + measurement specs only, no demo data
     */
    get mode(): "full" | "prod" {
      const val = optional("SEED_MODE", "full");
      if (val !== "full" && val !== "prod") {
        console.warn(`Invalid SEED_MODE "${val}", defaulting to "full"`);
        return "full";
      }
      return val;
    },
    /** Whether running in prod seed mode */
    get isProd(): boolean {
      return this.mode === "prod";
    },
    /**
     * SEED_PROFILE controls which seed steps run.
     *   "full" (default) — All steps including educator demo, school data, e2e fixtures (DEV/VM)
     *   "test"           — Core + demo domains + e2e fixtures (TEST)
     *   "core"           — Specs, domains, demo domains, run configs only (PROD)
     */
    get profile(): "full" | "test" | "core" {
      const val = optional("SEED_PROFILE", "full");
      if (val !== "full" && val !== "test" && val !== "core") {
        console.warn(`Invalid SEED_PROFILE "${val}", defaulting to "full"`);
        return "full";
      }
      return val;
    },
    /**
     * Spec featureIds to exclude in prod mode.
     * These are dev-only identity overlays and domain-specific content.
     */
    get excludedSpecs(): string[] {
      return [
        "FS-TEST-99",      // Food Safety exam prep — dev only
        "TUT-WNF-001",     // WNF session tutor overlay — dev only
        "TUT-QM-001",      // QM session tutor overlay — dev only
      ];
    },
  },

  // ---------------------------------------------------------------------------
  // Testing
  // ---------------------------------------------------------------------------
  testing: {
    /** Test API URL for integration tests */
    get apiUrl(): string {
      return optional("TEST_API_URL", "http://localhost:3000");
    },
    /** Playwright timeout (seconds) */
    get playwrightTimeoutS(): number {
      return optionalInt("PLAYWRIGHT_TIMEOUT_S", 120);
    },
    /** Is running in CI */
    get isCI(): boolean {
      return optionalBool("CI", false);
    },
  },
} as const;

// =============================================================================
// Validation (optional - call on app startup)
// =============================================================================

/**
 * Validate that all required environment variables are set.
 * Call this on app startup to fail fast if config is missing.
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Check required vars
  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is required");
  }
  if (!process.env.HF_SUPERADMIN_TOKEN) {
    errors.push("HF_SUPERADMIN_TOKEN is required");
  }

  // Check internal API secret in production
  if (config.app.isProduction && !process.env.INTERNAL_API_SECRET) {
    errors.push("INTERNAL_API_SECRET is required in production (generate with: openssl rand -hex 32)");
  }

  // #1977 — KMS substrate prod-safety guard. If we ship to prod without
  // KMS_KEK_NAME, the envelope-encryption bypass mode would silently
  // store plaintext in the ciphertext column. Fail-closed at boot.
  if (
    process.env.NEXT_PUBLIC_APP_ENV === "PROD" &&
    !process.env.KMS_KEK_NAME
  ) {
    errors.push(
      "KMS_KEK_NAME is required when NEXT_PUBLIC_APP_ENV=PROD. " +
        "Without it, lib/crypto/envelope.ts falls back to a passthrough mode " +
        "that stores plaintext in the *_ciphertext column. " +
        "Provision a GCP KMS keyring per docs/decisions/2026-06-13-kms-envelope-encryption-prereq.md " +
        "and set this env var to the resource path."
    );
  }

  // Warn if no AI keys
  if (!config.ai.openai.isConfigured && !config.ai.claude.isConfigured) {
    console.warn(
      "⚠️  No AI API keys configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY for AI features."
    );
  }

  // Log canonical spec configuration
  if (config.app.isDevelopment) {
    console.log("✓ Canonical specs configured:");
    console.log(`  - Onboarding: ${config.specs.onboarding}`);
    console.log(`  - Pipeline: ${config.specs.pipeline}`);
    console.log(`  - Pipeline fallback: ${config.specs.pipelineFallback}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\n` +
        `See .env.example for configuration options.`
    );
  }
}

// =============================================================================
// Debug helper
// =============================================================================

/**
 * Get a sanitized view of current config (safe to log, no secrets)
 */
export function getConfigSummary(): Record<string, unknown> {
  return {
    database: {
      configured: !!process.env.DATABASE_URL,
    },
    auth: {
      configured: !!process.env.HF_SUPERADMIN_TOKEN,
    },
    ai: {
      openai: {
        configured: config.ai.openai.isConfigured,
        model: config.ai.openai.model,
      },
      claude: {
        configured: config.ai.claude.isConfigured,
        model: config.ai.claude.model,
      },
      defaults: {
        maxTokens: config.ai.defaults.maxTokens,
        temperature: config.ai.defaults.temperature,
      },
    },
    paths: {
      kb: config.paths.kb,
      parametersCsv: config.paths.parametersCsv,
      transcripts: config.paths.transcripts || "(not set)",
    },
    features: {
      opsEnabled: config.features.opsEnabled,
    },
    terminology: {
      defaultPreset: config.terminology.defaultPreset,
    },
    specs: {
      onboarding: config.specs.onboarding,
      pipeline: config.specs.pipeline,
      pipelineFallback: config.specs.pipelineFallback,
    },
    app: {
      url: config.app.url,
      port: config.app.port,
      nodeEnv: config.app.nodeEnv,
    },
    polling: {
      healthCheckMs: config.polling.healthCheckMs,
      agentPollMs: config.polling.agentPollMs,
      statusPollMs: config.polling.statusPollMs,
    },
  };
}
