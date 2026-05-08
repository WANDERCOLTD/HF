/**
 * Deep Logging — Toggle helper
 *
 * When enabled, the AI wrapper captures full prompts and responses
 * for every AI call (wizards, pipeline, etc.) via logAI().
 *
 * Toggle is DB-backed (SystemSetting), cached with 30s TTL.
 * Toggle UI lives in the StatusBar.
 */

import { getSystemSetting, clearSystemSettingsCache } from "@/lib/system-settings";
import { prisma } from "@/lib/prisma";

const DEEP_LOGGING_KEY = "deep_logging_enabled";

/**
 * Check if deep logging is enabled (default: false — production-safe).
 * Uses 30s TTL cache from system-settings — near-zero overhead per AI call.
 *
 * The DB-backed SystemSetting toggle in the StatusBar lets ops flip this
 * on for an environment when needed (market test, debugging). Default-off
 * keeps prod logs clean and avoids storing full prompts/responses by
 * accident on a fresh deploy.
 */
export async function isDeepLoggingEnabled(): Promise<boolean> {
  return getSystemSetting(DEEP_LOGGING_KEY, false);
}

/**
 * Set deep logging enabled/disabled.
 * Clears the settings cache so the change takes effect immediately.
 */
export async function setDeepLoggingEnabled(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: DEEP_LOGGING_KEY },
    update: { value: JSON.stringify(enabled) },
    create: { key: DEEP_LOGGING_KEY, value: JSON.stringify(enabled) },
  });
  clearSystemSettingsCache();
}
