/**
 * Prompt Settings — DB read/write API for Meta Prompts
 *
 * Uses the SystemSetting table (key: prompts.<slug>) with 30s TTL cache.
 * Falls back to hardcoded defaults from registry.ts on miss/error.
 *
 * Cascade: DB override (SystemSetting) > hardcoded default (registry.ts)
 * For extraction prompts, spec-level config wins over both (handled in resolve-config.ts).
 */

import { getSystemSetting, clearSystemSettingsCache } from "@/lib/system-settings";
import { prisma } from "@/lib/prisma";
import { PROMPT_REGISTRY, DEFAULTS, type PromptSlug } from "./registry";

// ------------------------------------------------------------------
// Read
// ------------------------------------------------------------------

/**
 * Get the active prompt template for a slug.
 * Returns DB override if present, else code default.
 * Cached with 30s TTL via SystemSettings.
 */
export async function getPromptTemplate(slug: PromptSlug): Promise<string> {
  const key = `prompts.${slug}`;
  const defaultValue = DEFAULTS[slug];
  return getSystemSetting<string>(key, defaultValue);
}

// ------------------------------------------------------------------
// Write
// ------------------------------------------------------------------

/**
 * Save a prompt override to DB.
 * Clears the settings cache so the change is picked up quickly.
 */
export async function setPromptTemplate(slug: PromptSlug, value: string): Promise<void> {
  const entry = PROMPT_REGISTRY.get(slug);
  if (!entry) throw new Error(`Unknown prompt slug: ${slug}`);
  if (!entry.isEditable) throw new Error(`Prompt "${slug}" is not editable`);

  const key = `prompts.${slug}`;
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
  clearSystemSettingsCache();
}

/**
 * Delete a prompt override, reverting to code default.
 */
export async function resetPromptTemplate(slug: PromptSlug): Promise<void> {
  const key = `prompts.${slug}`;
  const existing = await prisma.systemSetting.findUnique({ where: { key } });
  if (existing) {
    await prisma.systemSetting.delete({ where: { key } });
    clearSystemSettingsCache();
  }
}

// ------------------------------------------------------------------
// Bulk read (for admin page)
// ------------------------------------------------------------------

export interface PromptState {
  slug: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  sourceFile: string;
  sourceLines: string;
  templateVars: string[];
  isEditable: boolean;
  defaultValue: string;
  currentValue: string;
  isOverridden: boolean;
  editGuidance?: string;
}

/**
 * Get all prompts with their current values and override status.
 * Bypasses cache to give accurate override status for the admin UI.
 */
export async function getAllPromptStates(): Promise<PromptState[]> {
  // Load all prompts.* keys from DB in one query
  const dbRows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: "prompts." } },
  });
  const overrides = new Map(dbRows.map((r) => [r.key, r.value]));

  return Array.from(PROMPT_REGISTRY.values()).map((entry) => {
    const key = `prompts.${entry.slug}`;
    const dbValue = overrides.get(key);
    const isOverridden = !!dbValue;
    let currentValue = entry.defaultValue;
    if (dbValue) {
      try {
        currentValue = JSON.parse(dbValue);
      } catch {
        currentValue = dbValue;
      }
    }

    return {
      slug: entry.slug,
      label: entry.label,
      description: entry.description,
      category: entry.category,
      icon: entry.icon,
      sourceFile: entry.sourceFile,
      sourceLines: entry.sourceLines,
      templateVars: entry.templateVars,
      isEditable: entry.isEditable,
      defaultValue: entry.defaultValue,
      currentValue,
      isOverridden,
      editGuidance: entry.editGuidance,
    };
  });
}
