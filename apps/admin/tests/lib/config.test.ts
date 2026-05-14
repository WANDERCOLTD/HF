/**
 * Tests for lib/config.ts — Centralized Configuration
 *
 * Tests the config object, env var overrides, helper functions,
 * and the validateConfig() / getConfigSummary() exports.
 *
 * The config uses getter properties that read process.env on every access,
 * so vi.stubEnv() works without needing module re-imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import the actual module — no mocking the config itself
import { config, validateConfig, getConfigSummary } from "@/lib/config";

// =============================================================================
// Setup
// =============================================================================

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// =============================================================================
// Canonical Spec Slugs (the 6 architectural dependencies)
// =============================================================================

describe("config.specs — canonical spec slugs", () => {
  it("has correct default for onboarding", () => {
    vi.stubEnv("ONBOARDING_SPEC_SLUG", "");
    expect(config.specs.onboarding).toBe("INIT-001");
  });

  it("has correct default for pipeline", () => {
    vi.stubEnv("PIPELINE_SPEC_SLUG", "");
    expect(config.specs.pipeline).toBe("PIPELINE-001");
  });

  it("has correct default for pipelineFallback", () => {
    vi.stubEnv("PIPELINE_FALLBACK_SPEC_SLUG", "");
    expect(config.specs.pipelineFallback).toBe("GUARD-001");
  });

  it("has correct default for compose", () => {
    vi.stubEnv("COMPOSE_SPEC_SLUG", "");
    expect(config.specs.compose).toBe("system-compose-next-prompt");
  });

  it("has correct default for voicePattern", () => {
    vi.stubEnv("VOICE_SPEC_SLUG_PATTERN", "");
    expect(config.specs.voicePattern).toBe("voice");
  });

  it("has correct default for onboardingSlugPrefix", () => {
    vi.stubEnv("ONBOARDING_SLUG_PREFIX", "");
    expect(config.specs.onboardingSlugPrefix).toBe("init.");
  });
});

// =============================================================================
// Spec Slug Env Overrides
// =============================================================================

describe("config.specs — env overrides", () => {
  it("overrides onboarding slug via ONBOARDING_SPEC_SLUG", () => {
    vi.stubEnv("ONBOARDING_SPEC_SLUG", "CUSTOM-INIT-002");
    expect(config.specs.onboarding).toBe("CUSTOM-INIT-002");
  });

  it("overrides pipeline slug via PIPELINE_SPEC_SLUG", () => {
    vi.stubEnv("PIPELINE_SPEC_SLUG", "PIPELINE-002");
    expect(config.specs.pipeline).toBe("PIPELINE-002");
  });

  it("overrides pipelineFallback slug via PIPELINE_FALLBACK_SPEC_SLUG", () => {
    vi.stubEnv("PIPELINE_FALLBACK_SPEC_SLUG", "FALLBACK-002");
    expect(config.specs.pipelineFallback).toBe("FALLBACK-002");
  });

  it("overrides compose slug via COMPOSE_SPEC_SLUG", () => {
    vi.stubEnv("COMPOSE_SPEC_SLUG", "custom-compose");
    expect(config.specs.compose).toBe("custom-compose");
  });

  it("overrides voicePattern via VOICE_SPEC_SLUG_PATTERN", () => {
    vi.stubEnv("VOICE_SPEC_SLUG_PATTERN", "custom-voice");
    expect(config.specs.voicePattern).toBe("custom-voice");
  });

  it("overrides onboardingSlugPrefix via ONBOARDING_SLUG_PREFIX", () => {
    vi.stubEnv("ONBOARDING_SLUG_PREFIX", "onboard.");
    expect(config.specs.onboardingSlugPrefix).toBe("onboard.");
  });
});

// =============================================================================
// AI Configuration
// =============================================================================

describe("config.ai — AI service configuration", () => {
  describe("openai", () => {
    it("returns undefined apiKey when neither key is set", () => {
      vi.stubEnv("OPENAI_HF_MVP_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      expect(config.ai.openai.apiKey).toBeFalsy();
    });

    it("prefers OPENAI_HF_MVP_KEY over OPENAI_API_KEY", () => {
      vi.stubEnv("OPENAI_HF_MVP_KEY", "mvp-key-123");
      vi.stubEnv("OPENAI_API_KEY", "regular-key-456");
      expect(config.ai.openai.apiKey).toBe("mvp-key-123");
    });

    it("falls back to OPENAI_API_KEY when OPENAI_HF_MVP_KEY is not set", () => {
      vi.stubEnv("OPENAI_HF_MVP_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "regular-key-456");
      expect(config.ai.openai.apiKey).toBe("regular-key-456");
    });

    it("defaults model to gpt-4o", () => {
      vi.stubEnv("OPENAI_MODEL_ID", "");
      expect(config.ai.openai.model).toBe("gpt-4o");
    });

    it("overrides model via OPENAI_MODEL_ID", () => {
      vi.stubEnv("OPENAI_MODEL_ID", "gpt-4-turbo");
      expect(config.ai.openai.model).toBe("gpt-4-turbo");
    });

    it("isConfigured returns false when no keys set", () => {
      vi.stubEnv("OPENAI_HF_MVP_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      expect(config.ai.openai.isConfigured).toBe(false);
    });

    it("isConfigured returns true when OPENAI_API_KEY is set", () => {
      vi.stubEnv("OPENAI_HF_MVP_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      expect(config.ai.openai.isConfigured).toBe(true);
    });
  });

  describe("claude", () => {
    it("returns undefined apiKey when ANTHROPIC_API_KEY is not set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      expect(config.ai.claude.apiKey).toBeFalsy();
    });

    it("returns apiKey from ANTHROPIC_API_KEY", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      expect(config.ai.claude.apiKey).toBe("sk-ant-test");
    });

    it("defaults model to claude-sonnet-4-5-20250929", () => {
      vi.stubEnv("CLAUDE_MODEL_ID", "");
      expect(config.ai.claude.model).toBe("claude-sonnet-4-5-20250929");
    });

    it("overrides model via CLAUDE_MODEL_ID", () => {
      vi.stubEnv("CLAUDE_MODEL_ID", "claude-opus-4-20250514");
      expect(config.ai.claude.model).toBe("claude-opus-4-20250514");
    });

    it("isConfigured returns false when key is not set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      expect(config.ai.claude.isConfigured).toBe(false);
    });

    it("isConfigured returns true when key is set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      expect(config.ai.claude.isConfigured).toBe(true);
    });
  });

  describe("defaults", () => {
    it("defaults maxTokens to 1024", () => {
      vi.stubEnv("AI_DEFAULT_MAX_TOKENS", "");
      expect(config.ai.defaults.maxTokens).toBe(1024);
    });

    it("overrides maxTokens via AI_DEFAULT_MAX_TOKENS", () => {
      vi.stubEnv("AI_DEFAULT_MAX_TOKENS", "2048");
      expect(config.ai.defaults.maxTokens).toBe(2048);
    });

    it("defaults temperature to 0.7", () => {
      vi.stubEnv("AI_DEFAULT_TEMPERATURE", "");
      expect(config.ai.defaults.temperature).toBe(0.7);
    });

    it("overrides temperature via AI_DEFAULT_TEMPERATURE", () => {
      vi.stubEnv("AI_DEFAULT_TEMPERATURE", "0.3");
      expect(config.ai.defaults.temperature).toBe(0.3);
    });
  });
});

// =============================================================================
// Application Config
// =============================================================================

describe("config.app — application settings", () => {
  it("defaults url to http://localhost:3000", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(config.app.url).toBe("http://localhost:3000");
  });

  it("overrides url via NEXT_PUBLIC_APP_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    expect(config.app.url).toBe("https://app.example.com");
  });

  it("defaults port to 3000", () => {
    vi.stubEnv("PORT", "");
    expect(config.app.port).toBe(3000);
  });

  it("overrides port via PORT", () => {
    vi.stubEnv("PORT", "8080");
    expect(config.app.port).toBe(8080);
  });

  it("defaults nodeEnv to development", () => {
    vi.stubEnv("NODE_ENV", "");
    expect(config.app.nodeEnv).toBe("development");
  });

  it("isProduction returns true when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(config.app.isProduction).toBe(true);
    expect(config.app.isDevelopment).toBe(false);
  });

  it("isDevelopment returns true when NODE_ENV is not production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(config.app.isDevelopment).toBe(true);
    expect(config.app.isProduction).toBe(false);
  });
});

// =============================================================================
// Polling & Timeouts
// =============================================================================

describe("config.polling — timing configuration", () => {
  it("defaults healthCheckMs to 30000", () => {
    vi.stubEnv("HEALTH_CHECK_INTERVAL_MS", "");
    expect(config.polling.healthCheckMs).toBe(30000);
  });

  it("overrides healthCheckMs via env", () => {
    vi.stubEnv("HEALTH_CHECK_INTERVAL_MS", "60000");
    expect(config.polling.healthCheckMs).toBe(60000);
  });

  it("defaults agentPollMs to 5000", () => {
    vi.stubEnv("AGENTS_POLL_INTERVAL_MS", "");
    expect(config.polling.agentPollMs).toBe(5000);
  });

  it("defaults statusPollMs to 15000", () => {
    vi.stubEnv("STATUS_POLL_INTERVAL_MS", "");
    expect(config.polling.statusPollMs).toBe(15000);
  });

  it("defaults dockerTimeoutMs to 5000", () => {
    vi.stubEnv("DOCKER_TIMEOUT_MS", "");
    expect(config.polling.dockerTimeoutMs).toBe(5000);
  });
});

// =============================================================================
// Feature Flags
// =============================================================================

describe("config.features — feature flags", () => {
  it("defaults opsEnabled to false", () => {
    vi.stubEnv("HF_OPS_ENABLED", "");
    expect(config.features.opsEnabled).toBe(false);
  });

  it("enables ops when HF_OPS_ENABLED is true", () => {
    vi.stubEnv("HF_OPS_ENABLED", "true");
    expect(config.features.opsEnabled).toBe(true);
  });

  it("stays false for non-true values", () => {
    vi.stubEnv("HF_OPS_ENABLED", "1");
    expect(config.features.opsEnabled).toBe(false);
  });
});

// =============================================================================
// File Paths
// =============================================================================

describe("config.paths — file path configuration", () => {
  it("defaults kb to ../../knowledge", () => {
    vi.stubEnv("HF_KB_PATH", "");
    expect(config.paths.kb).toBe("../../knowledge");
  });

  it("overrides kb via HF_KB_PATH", () => {
    vi.stubEnv("HF_KB_PATH", "/data/knowledge");
    expect(config.paths.kb).toBe("/data/knowledge");
  });

  it("defaults parametersCsv to ./backlog/parameters.csv", () => {
    vi.stubEnv("HF_PARAMETERS_CSV", "");
    expect(config.paths.parametersCsv).toBe("./backlog/parameters.csv");
  });

  it("returns undefined for transcripts when not set", () => {
    vi.stubEnv("HF_TRANSCRIPTS_PATH", "");
    expect(config.paths.transcripts).toBeFalsy();
  });

  it("returns transcripts path when set", () => {
    vi.stubEnv("HF_TRANSCRIPTS_PATH", "/data/transcripts");
    expect(config.paths.transcripts).toBe("/data/transcripts");
  });
});

// =============================================================================
// Testing Config
// =============================================================================

describe("config.testing — test configuration", () => {
  it("defaults apiUrl to http://localhost:3000", () => {
    vi.stubEnv("TEST_API_URL", "");
    expect(config.testing.apiUrl).toBe("http://localhost:3000");
  });

  it("defaults playwrightTimeoutS to 120", () => {
    vi.stubEnv("PLAYWRIGHT_TIMEOUT_S", "");
    expect(config.testing.playwrightTimeoutS).toBe(120);
  });

  it("defaults isCI to false", () => {
    vi.stubEnv("CI", "");
    expect(config.testing.isCI).toBe(false);
  });

  it("isCI returns true when CI=true", () => {
    vi.stubEnv("CI", "true");
    expect(config.testing.isCI).toBe(true);
  });

  it("isCI returns true when CI=1", () => {
    vi.stubEnv("CI", "1");
    expect(config.testing.isCI).toBe(true);
  });
});

// =============================================================================
// Required Environment Variables
// =============================================================================

describe("config.database / config.auth — required vars", () => {
  it("throws when DATABASE_URL is missing", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => config.database.url).toThrow("Missing required environment variable: DATABASE_URL");
  });

  it("returns DATABASE_URL when set", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    expect(config.database.url).toBe("postgresql://localhost/test");
  });

  it("throws when HF_SUPERADMIN_TOKEN is missing", () => {
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "");
    expect(() => config.auth.superadminToken).toThrow(
      "Missing required environment variable: HF_SUPERADMIN_TOKEN"
    );
  });

  it("returns HF_SUPERADMIN_TOKEN when set", () => {
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "secret-token-123");
    expect(config.auth.superadminToken).toBe("secret-token-123");
  });
});

// =============================================================================
// Helper Edge Cases (optionalInt / optionalFloat / optionalBool)
// =============================================================================

describe("config helpers — edge cases", () => {
  it("optionalInt falls back to default for non-numeric values", () => {
    vi.stubEnv("PORT", "not-a-number");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(config.app.port).toBe(3000);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid integer for PORT')
    );
    consoleSpy.mockRestore();
  });

  it("optionalFloat falls back to default for non-numeric values", () => {
    vi.stubEnv("AI_DEFAULT_TEMPERATURE", "hot");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(config.ai.defaults.temperature).toBe(0.7);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid float for AI_DEFAULT_TEMPERATURE')
    );
    consoleSpy.mockRestore();
  });

  it("optionalBool treats 1 as true", () => {
    vi.stubEnv("CI", "1");
    expect(config.testing.isCI).toBe(true);
  });

  it("optionalBool treats TRUE (uppercase) as true", () => {
    vi.stubEnv("CI", "TRUE");
    expect(config.testing.isCI).toBe(true);
  });

  it("optionalBool treats arbitrary strings as false", () => {
    vi.stubEnv("CI", "yes");
    expect(config.testing.isCI).toBe(false);
  });
});

// =============================================================================
// validateConfig()
// =============================================================================

describe("validateConfig", () => {
  it("throws when DATABASE_URL is missing", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "token");
    expect(() => validateConfig()).toThrow("DATABASE_URL is required");
  });

  it("throws when HF_SUPERADMIN_TOKEN is missing", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "");
    expect(() => validateConfig()).toThrow("HF_SUPERADMIN_TOKEN is required");
  });

  it("throws with both errors when both are missing", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "");
    expect(() => validateConfig()).toThrow("Configuration validation failed");
  });

  it("succeeds when both required vars are set", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "token");
    // Suppress development logging
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateConfig()).not.toThrow();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("warns when no AI keys are configured", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "token");
    vi.stubEnv("OPENAI_HF_MVP_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    validateConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No AI API keys configured")
    );
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// =============================================================================
// getConfigSummary()
// =============================================================================

describe("getConfigSummary", () => {
  it("returns a sanitized config object without secrets", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/secret");
    vi.stubEnv("HF_SUPERADMIN_TOKEN", "super-secret");
    vi.stubEnv("OPENAI_API_KEY", "sk-secret");

    const summary = getConfigSummary();

    // Should indicate configured status, not the actual values
    expect((summary.database as any).configured).toBe(true);
    expect((summary.auth as any).configured).toBe(true);

    // Should not contain the actual secret values
    const summaryStr = JSON.stringify(summary);
    expect(summaryStr).not.toContain("super-secret");
    expect(summaryStr).not.toContain("sk-secret");
    expect(summaryStr).not.toContain("postgresql://localhost/secret");
  });

  it("includes spec configuration", () => {
    const summary = getConfigSummary();
    const specs = summary.specs as any;
    expect(specs).toHaveProperty("onboarding");
    expect(specs).toHaveProperty("pipeline");
    expect(specs).toHaveProperty("pipelineFallback");
  });

  it("includes polling configuration", () => {
    const summary = getConfigSummary();
    const polling = summary.polling as any;
    expect(polling).toHaveProperty("healthCheckMs");
    expect(polling).toHaveProperty("agentPollMs");
    expect(polling).toHaveProperty("statusPollMs");
  });
});
