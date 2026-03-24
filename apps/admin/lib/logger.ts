/**
 * General Logger — DB-backed logging system
 *
 * All environments: Logs are written to the AppLog table (fire-and-forget).
 * Additionally in production: Structured JSON is written to stdout for Cloud Logging.
 *
 * Config toggles (enabled, enabledTypes) are stored in SystemSetting with 30s TTL cache.
 *
 * Log types:
 *   - ai: AI/LLM calls and responses
 *   - api: API requests and responses
 *   - system: System events and errors
 *   - user: User actions
 *
 * Usage:
 *   import { log, logAI } from "@/lib/logger";
 *   log("api", "callers.list", { count: 10 });
 *   logAI("pipeline:extract", prompt, response, { callId, tokens: 500 });
 */

import { prisma } from "@/lib/prisma";
import { getSystemSetting, clearSystemSettingsCache } from "@/lib/system-settings";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Preview caps — enforced on DB writes. Full content goes to console only.
const PROMPT_PREVIEW_CAP = 1000;
const RESPONSE_PREVIEW_CAP = 500;

// =====================================================
// TYPES — canonical definitions in lib/log-types.ts
// Re-exported here for backwards compatibility
// =====================================================

export type { LogType, LogLevel, LogEntry } from "./log-types";
import type { LogType, LogLevel, LogEntry } from "./log-types";

// =====================================================
// CONFIG — DB-backed via SystemSetting (30s TTL cache)
// =====================================================

const LOGGING_ENABLED_KEY = "logging_enabled";
const LOGGING_TYPES_KEY = "logging_enabled_types";

// In-memory cache for synchronous reads (refreshed async in background)
let _cachedEnabled = true;
let _cachedTypes: LogType[] = ["ai", "api", "system", "user"];
let _cacheExpiry = 0;

function refreshConfigCache(): void {
  const now = Date.now();
  if (now < _cacheExpiry) return;
  // Mark cache as fresh to prevent concurrent refreshes
  _cacheExpiry = now + 30_000;

  // Fire-and-forget async refresh
  Promise.all([
    getSystemSetting<boolean>(LOGGING_ENABLED_KEY, true),
    getSystemSetting<LogType[]>(LOGGING_TYPES_KEY, ["ai", "api", "system", "user"]),
  ])
    .then(([enabled, types]) => {
      _cachedEnabled = enabled;
      _cachedTypes = types;
    })
    .catch(() => {
      // On failure, keep stale cache but allow retry sooner
      _cacheExpiry = now + 5_000;
    });
}

/**
 * Check if logging is enabled (default: true).
 * Synchronous — reads from in-memory cache, refreshes async.
 */
export function isLoggingEnabled(): boolean {
  refreshConfigCache();
  return _cachedEnabled;
}

/**
 * Set logging enabled/disabled.
 * Writes to SystemSetting DB table.
 */
export async function setLoggingEnabled(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: LOGGING_ENABLED_KEY },
    update: { value: JSON.stringify(enabled) },
    create: { key: LOGGING_ENABLED_KEY, value: JSON.stringify(enabled) },
  });
  _cachedEnabled = enabled;
  _cacheExpiry = 0;
  clearSystemSettingsCache();
}

/**
 * Get enabled log types (default: all).
 * Synchronous — reads from in-memory cache.
 */
export function getEnabledTypes(): LogType[] {
  refreshConfigCache();
  return _cachedTypes;
}

/**
 * Set enabled log types.
 * Writes to SystemSetting DB table.
 */
export async function setEnabledTypes(types: LogType[]): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: LOGGING_TYPES_KEY },
    update: { value: JSON.stringify(types) },
    create: { key: LOGGING_TYPES_KEY, value: JSON.stringify(types) },
  });
  _cachedTypes = types;
  _cacheExpiry = 0;
  clearSystemSettingsCache();
}

// =====================================================
// CORE LOGGING
// =====================================================

/**
 * Write a log entry — fire-and-forget DB write.
 */
export function log(
  type: LogType,
  stage: string,
  data?: {
    message?: string;
    durationMs?: number;
    [key: string]: unknown;
  }
): void {
  if (!isLoggingEnabled()) return;
  if (!getEnabledTypes().includes(type)) return;

  const level = (data as Record<string, unknown>)?.level as LogLevel | undefined;

  // Always write to stdout in production for Cloud Logging
  if (IS_PRODUCTION) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), type, stage, level, ...data }));
  }

  // Write to DB — fire-and-forget
  try {
    prisma.appLog
      .create({
        data: {
          type,
          stage,
          level: level ?? null,
          message: data?.message ?? null,
          durationMs: typeof data?.durationMs === "number" ? data.durationMs : null,
          metadata: data ? (JSON.parse(JSON.stringify(data)) as object) : undefined,
        },
      })
      .catch((err) => console.error("[Logger] DB write failed:", err));
  } catch { /* prisma.appLog may not exist if client not regenerated */ }
}

/**
 * Log an AI call — fire-and-forget DB write.
 * Previews are capped in DB; full content goes to console in production.
 */
export function logAI(
  stage: string,
  prompt: string,
  response: string,
  options?: {
    usage?: { inputTokens?: number; outputTokens?: number };
    durationMs?: number;
    callId?: string;
    callerId?: string;
    [key: string]: unknown;
  }
): void {
  if (!isLoggingEnabled()) return;
  if (!getEnabledTypes().includes("ai")) return;

  const isDeep = options?.deep === true;

  // Console output — full content for deep, preview for normal
  if (IS_PRODUCTION) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type: "ai",
      stage,
      promptLength: prompt.length,
      promptPreview: isDeep ? prompt : prompt.slice(0, PROMPT_PREVIEW_CAP),
      responseLength: response.length,
      responsePreview: isDeep ? response : response.slice(0, RESPONSE_PREVIEW_CAP),
      usage: options?.usage,
      durationMs: options?.durationMs,
      metadata: options,
    };
    console.log(JSON.stringify(entry));
  }

  // DB write — always capped previews (PII safety)
  try {
    prisma.appLog
      .create({
        data: {
          type: "ai",
          stage,
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, PROMPT_PREVIEW_CAP),
          responseLength: response.length,
          responsePreview: response.slice(0, RESPONSE_PREVIEW_CAP),
          inputTokens: options?.usage?.inputTokens ?? null,
          outputTokens: options?.usage?.outputTokens ?? null,
          durationMs: options?.durationMs ?? null,
          callId: options?.callId ?? null,
          callerId: options?.callerId ?? null,
          metadata: options ? (JSON.parse(JSON.stringify(options)) as object) : undefined,
        },
      })
      .catch((err) => console.error("[Logger] DB write failed:", err));
  } catch { /* prisma.appLog may not exist if client not regenerated */ }
}

/**
 * Log an API request
 */
export function logAPI(
  endpoint: string,
  data?: {
    method?: string;
    status?: number;
    durationMs?: number;
    [key: string]: unknown;
  }
): void {
  log("api", endpoint, data);
}

/**
 * Log a system event
 */
export function logSystem(
  event: string,
  data?: {
    level?: "info" | "warn" | "error";
    message?: string;
    [key: string]: unknown;
  }
): void {
  log("system", event, data);
}

/**
 * Log a user action
 */
export function logUser(
  action: string,
  data?: {
    userId?: string;
    [key: string]: unknown;
  }
): void {
  log("user", action, data);
}

// =====================================================
// BACKWARDS COMPATIBILITY
// =====================================================

/** @deprecated Use logAI instead */
export const logAICall = logAI;

/** @deprecated Use logAI instead */
export function logFullPrompt(stage: string, prompt: string): void {
  if (!isLoggingEnabled()) return;

  if (IS_PRODUCTION) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "ai",
      stage,
      promptPreview: prompt,
      promptLength: prompt.length,
    }));
  }

  try {
    prisma.appLog
      .create({
        data: {
          type: "ai",
          stage,
          promptPreview: prompt.slice(0, PROMPT_PREVIEW_CAP),
          promptLength: prompt.length,
          metadata: { fullPrompt: true },
        },
      })
      .catch((err) => console.error("[Logger] DB write failed:", err));
  } catch { /* prisma.appLog may not exist if client not regenerated */ }
}
