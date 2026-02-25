/**
 * General Logger - Unified logging system for the application
 *
 * In production (Cloud Run): Logs are written to stdout as structured JSON
 * so Cloud Logging captures them automatically.
 *
 * In development: Logs are written to: logs/app.jsonl (one JSON object per line)
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

import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "app.jsonl");
const CONFIG_FILE = join(LOG_DIR, "logging-config.json");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Ensure log directory exists (dev only)
if (!IS_PRODUCTION && !existsSync(LOG_DIR)) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Ignore - might fail in edge runtime
  }
}

// =====================================================
// TYPES — canonical definitions in lib/log-types.ts
// Re-exported here for backwards compatibility
// =====================================================

export type { LogType, LogLevel, LogEntry } from "./log-types";
import type { LogType, LogLevel, LogEntry } from "./log-types";

interface LoggingConfig {
  enabled: boolean;
  enabledTypes?: LogType[];
}

// =====================================================
// CONFIG
// =====================================================

function getConfig(): LoggingConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {
    // Ignore - use defaults
  }
  return { enabled: true };
}

function saveConfig(config: LoggingConfig): void {
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("[Logger] Failed to save config:", error);
  }
}

/**
 * Check if logging is enabled (default: true)
 */
export function isLoggingEnabled(): boolean {
  return getConfig().enabled !== false;
}

/**
 * Set logging enabled/disabled
 */
export function setLoggingEnabled(enabled: boolean): void {
  const config = getConfig();
  config.enabled = enabled;
  saveConfig(config);
}

/**
 * Get enabled log types (default: all)
 */
export function getEnabledTypes(): LogType[] {
  const config = getConfig();
  return config.enabledTypes || ["ai", "api", "system", "user"];
}

/**
 * Set enabled log types
 */
export function setEnabledTypes(types: LogType[]): void {
  const config = getConfig();
  config.enabledTypes = types;
  saveConfig(config);
}

// =====================================================
// CORE LOGGING
// =====================================================

/**
 * Write a log entry
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

  const enabledTypes = getEnabledTypes();
  if (!enabledTypes.includes(type)) return;

  try {
    const level = (data as any)?.level as LogLevel | undefined;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      stage,
      ...(level ? { level } : {}),
      message: data?.message,
      durationMs: data?.durationMs,
      metadata: data,
    };

    if (IS_PRODUCTION) {
      // In production, write to stdout for Cloud Logging
      console.log(JSON.stringify(entry));
    } else {
      // In development, write to file
      appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    }
  } catch (error) {
    console.error("[Logger] Failed to write log:", error);
  }
}

/**
 * Log an AI call (convenience wrapper)
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

  const enabledTypes = getEnabledTypes();
  if (!enabledTypes.includes("ai")) return;

  try {
    const isDeep = options?.deep === true;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type: "ai",
      stage,
      promptLength: prompt.length,
      promptPreview: isDeep ? prompt : prompt.slice(0, 1000),
      responseLength: response.length,
      responsePreview: isDeep ? response : response.slice(0, 500),
      usage: options?.usage,
      durationMs: options?.durationMs,
      metadata: options,
    };

    if (IS_PRODUCTION) {
      // In production, write to stdout for Cloud Logging
      console.log(JSON.stringify(entry));
    } else {
      // In development, write to file
      appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
      console.log(`[Logger:ai] ${stage} logged (${prompt.length} chars prompt, ${response.length} chars response)`);
    }
  } catch (error) {
    console.error("[Logger] Failed to write AI log:", error);
  }
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
// UTILITIES
// =====================================================

/**
 * Get path to the log file
 */
export function getLogFilePath(): string {
  return LOG_FILE;
}

// =====================================================
// BACKWARDS COMPATIBILITY
// Re-export for existing imports from ai-call-logger
// =====================================================

/** @deprecated Use logAI instead */
export const logAICall = logAI;

/** @deprecated Use logAI instead */
export function logFullPrompt(stage: string, prompt: string): void {
  if (!isLoggingEnabled()) return;

  try {
    const entry = {
      timestamp: new Date().toISOString(),
      type: "ai" as LogType,
      stage,
      promptPreview: prompt,
      promptLength: prompt.length,
      metadata: { fullPrompt: true },
    };

    if (IS_PRODUCTION) {
      console.log(JSON.stringify(entry));
    } else {
      appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    }
  } catch {
    // Ignore
  }
}
