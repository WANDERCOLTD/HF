/**
 * Generic profile-capture EXTRACT routine — Theme 10 / story #1704.
 *
 * An operator declares, per module, which conversational profile fields the
 * tutor should collect (`AuthoredModule.settings.profileFieldsToCapture`,
 * addressed at `Playbook.config.modules[].settings.profileFieldsToCapture`).
 * This routine reads that whitelist, asks the model to extract the named
 * fields from the transcript, validates the AI output, and writes the
 * survivors to `CallerAttribute` under a course-agnostic `profile:*`
 * namespace.
 *
 * ## Why this is its own file (not an extension of an existing EXTRACT path)
 *
 * Tech Lead call on #1704: a brand-new `@ai-call Class B` annotation is
 * cleaner than re-annotating a previously-exempt path. The structural
 * pattern follows `lib/goals/extract-goals.ts` (AI → validate → CallerAttribute).
 *
 * ## Lattice survey (run per `.claude/rules/lattice-survey.md`, 2026-06-16)
 *
 * - **CallerAttribute writers** are scattered (no chokepoint): `track-progress`
 *   (`curriculum:*` / `lo_mastery:*`, scope = specSlug), `aggregate-runner`,
 *   `exam-readiness`, `extract-goals` (`goal_*`, scope = `GOAL_EVENT`), etc.
 * - **Sibling-writer isolation:** this routine writes ONLY scope `"PROFILE"`
 *   with `profile:*` keys. The unique key is `(callerId, key, scope)`, so a
 *   `profile:*` write can NEVER collide with or clobber a `curriculum:*`
 *   mastery row (different scope) — the critical safety property the story
 *   names. The whitelist guard is the second layer: an AI-returned key MUST
 *   be in the declared `profileFieldsToCapture` set AND match `^profile:`.
 * - **No `source` / `sourceCallId` column** on `CallerAttribute` (and #1704
 *   ships no migration). Per-call provenance is stored inside `jsonValue`
 *   (mirrors `extract-goals.ts`): `{value, type, source:"ai-extract",
 *   sourceCallId, evidence, extractedAt}`.
 *
 * ## AI-read grounding (Class B, `.claude/rules/ai-read-grounding.md`)
 *
 * The system prompt carries a grounding contract: every extracted value MUST
 * be tied to a verbatim transcript span (`evidence`). The post-response guard
 * rejects any field whose evidence is absent from the transcript — the model
 * cannot fabricate a value the learner never said.
 *
 * Feature-flag gated by `HF_FLAG_IELTS_MODULE_SETTINGS` (epic #1700 decision
 * 5): off → the routine is a no-op (no LLM call, no write).
 */

import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getAITimeoutSettings } from "@/lib/system-settings";
import { log as appLog } from "@/lib/logger";
import type { AIEngine } from "@/lib/ai/client";
import type { PipelineLogger } from "@/lib/pipeline/logger";
import type { ProfileFieldToCapture, ProfileFieldType } from "@/lib/types/json-fields";

// Canonical type home is `AuthoredModuleSettings` in `lib/types/json-fields.ts`
// (#1704 converged onto #1701's typed module-settings shape). Re-exported here
// so existing importers + tests keep their `@/lib/pipeline/extract-profile-fields`
// import path.
export type { ProfileFieldToCapture, ProfileFieldType } from "@/lib/types/json-fields";

/** Course-agnostic key namespace + scope for captured profile fields. */
export const PROFILE_KEY_PREFIX = "profile:";
export const PROFILE_SCOPE = "PROFILE";
/** Provenance marker — `CallerAttribute` has no `source` column, so the
 *  "source = ai-extract" AC is recorded as `sourceSpecSlug` + `jsonValue.source`. */
export const PROFILE_SOURCE_SPEC_SLUG = "profile-capture";

/** AppLog subject for any field rejected by the validate-before-write guard. */
export const PROFILE_VALIDATION_FAILED_SUBJECT = "profile.capture.validation_failed";

/**
 * Max transcript characters sent to the extraction model. Mirrors the slice in
 * `lib/goals/extract-goals.ts`. Named here for tunability — if other EXTRACT
 * routines start drifting, promote to a system-setting. (#1803 follow-up.)
 */
export const TRANSCRIPT_MAX_CHARS = 6000;

export interface ExtractProfileFieldsInput {
  callId: string;
  callerId: string;
  transcript: string;
  /** The module's declared whitelist (already resolved from config). */
  profileFields: ProfileFieldToCapture[];
  engine: AIEngine;
  log: PipelineLogger;
}

export interface ExtractProfileFieldsResult {
  captured: number;
  rejected: number;
  skippedReason?: "flag_off" | "no_fields" | "empty_transcript" | "ai_no_fields";
}

/** Is module-settings reading enabled? (epic #1700 decision 5 flag.) */
export function ieltsModuleSettingsEnabled(): boolean {
  return process.env.HF_FLAG_IELTS_MODULE_SETTINGS === "true";
}

/**
 * Whitelist guard — the critical safety property. An AI-returned key is legal
 * ONLY when it is one of the operator-declared keys AND sits in the
 * `profile:*` namespace. This makes it structurally impossible for an LLM
 * hallucination to write an arbitrary key (or overwrite a `curriculum:*`
 * mastery key under a different scope).
 */
export function isWhitelistedProfileKey(
  key: unknown,
  declaredKeys: Set<string>,
): key is string {
  return (
    typeof key === "string" &&
    key.startsWith(PROFILE_KEY_PREFIX) &&
    declaredKeys.has(key)
  );
}

export type CoercedProfileValue =
  | { ok: true; valueType: "STRING" | "NUMBER"; value: string | number }
  | { ok: false; reason: "empty_text" | "not_numeric" | "band_out_of_range" | "band_not_half" };

/**
 * Type validation + coercion. `band` must be a 1.0–9.0 half-band; `number`
 * must be finite; `text` must be non-empty after trim. Numeric strings are
 * coerced (e.g. "6" → 6) so a model that returns a stringified band still
 * lands a usable value.
 */
export function coerceProfileValue(
  type: ProfileFieldType,
  raw: unknown,
): CoercedProfileValue {
  if (type === "text") {
    const s = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (s.length === 0) return { ok: false, reason: "empty_text" };
    return { ok: true, valueType: "STRING", value: s };
  }

  // number | band — coerce numeric strings.
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n)) return { ok: false, reason: "not_numeric" };

  if (type === "band") {
    if (n < 1 || n > 9) return { ok: false, reason: "band_out_of_range" };
    // Half-band: 4.0, 4.5, 5.0 … — value*2 must be integer.
    if (!Number.isInteger(n * 2)) return { ok: false, reason: "band_not_half" };
  }
  return { ok: true, valueType: "NUMBER", value: n };
}

/** Normalise whitespace for substring-grounding comparison. */
function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

interface AIProfileResponse {
  fields?: Array<{ key?: unknown; value?: unknown; evidence?: unknown; confidence?: unknown }>;
}

function buildSystemPrompt(): string {
  return [
    "You extract structured learner-profile fields from a session transcript.",
    "",
    "GROUNDING CONTRACT (mandatory):",
    "- Only return a field when the learner ACTUALLY stated it in the transcript.",
    "- For every field, include `evidence`: a SHORT verbatim quote from the",
    "  transcript that supports the value. If you cannot quote the learner",
    "  saying it, OMIT the field entirely — never guess, infer, or fill a",
    "  default.",
    "- Use ONLY the exact `key` strings provided. Never invent a key.",
    "",
    "Return STRICT JSON, no markdown fences, no commentary.",
  ].join("\n");
}

function buildUserPrompt(
  fields: ProfileFieldToCapture[],
  transcript: string,
  transcriptLimit: number,
): string {
  const fieldList = fields
    .map((f) => `- key "${f.key}" (type: ${f.type}) — prompt: ${f.prompt}`)
    .join("\n");
  return [
    "FIELDS TO CAPTURE (use these exact key strings):",
    fieldList,
    "",
    'RETURN SHAPE: {"fields":[{"key":"<one of the keys above>","value":<text|number>,"evidence":"<verbatim learner quote>","confidence":<0-1>}]}',
    "If no field is supported by the transcript, return {\"fields\":[]}.",
    "",
    "TRANSCRIPT:",
    transcript.slice(0, transcriptLimit),
  ].join("\n");
}

/**
 * Extract declared profile fields from a transcript and persist the validated
 * survivors to `CallerAttribute`. Non-throwing: validation failures are logged
 * (AppLog `profile.capture.validation_failed`) and skipped; the routine never
 * breaks the pipeline.
 */
export async function extractProfileFields(
  input: ExtractProfileFieldsInput,
): Promise<ExtractProfileFieldsResult> {
  const { callId, callerId, transcript, profileFields, engine, log } = input;

  if (!ieltsModuleSettingsEnabled()) return { captured: 0, rejected: 0, skippedReason: "flag_off" };
  if (!profileFields || profileFields.length === 0) {
    return { captured: 0, rejected: 0, skippedReason: "no_fields" };
  }
  if (transcript.trim().length === 0) {
    return { captured: 0, rejected: 0, skippedReason: "empty_transcript" };
  }

  const declaredKeys = new Set(profileFields.map((f) => f.key));
  const typeByKey = new Map(profileFields.map((f) => [f.key, f.type]));
  const normalisedTranscript = normalise(transcript);
  const timeouts = await getAITimeoutSettings();

  // @ai-call Class B — transcript analysis producing AI-derived structured data | config: /x/ai-config
  let parsed: AIProfileResponse;
  try {
    const aiResult = await getConfiguredMeteredAICompletion(
      {
        callPoint: "pipeline.extract_profile_fields",
        engineOverride: engine,
        scope: { callId },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(profileFields, transcript, TRANSCRIPT_MAX_CHARS) },
        ],
        maxTokens: Math.max(512, profileFields.length * 120),
        temperature: 0,
        timeoutMs: timeouts.pipelineTimeoutMs,
      },
      { callId, callerId, sourceOp: "pipeline:extract_profile_fields" },
    );
    let jsonContent = aiResult.content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    parsed = JSON.parse(jsonContent) as AIProfileResponse;
  } catch (err: any) {
    log.warn("profile-capture: AI extraction failed (non-blocking)", {
      callId,
      error: err?.message ?? "unknown",
    });
    return { captured: 0, rejected: 0, skippedReason: "ai_no_fields" };
  }

  if (!parsed?.fields || !Array.isArray(parsed.fields) || parsed.fields.length === 0) {
    return { captured: 0, rejected: 0, skippedReason: "ai_no_fields" };
  }

  let captured = 0;
  let rejected = 0;

  for (const field of parsed.fields) {
    // 1. Whitelist guard — key must be declared AND in the profile:* namespace.
    if (!isWhitelistedProfileKey(field.key, declaredKeys)) {
      rejected++;
      appLog("system", PROFILE_VALIDATION_FAILED_SUBJECT, {
        message: "profile-capture rejected a field: key not in whitelist",
        callId,
        fieldKey: typeof field.key === "string" ? field.key : String(field.key),
        rejectedValue: field.value ?? null,
        reason: "key_not_whitelisted",
      });
      continue;
    }
    const key = field.key;

    // 2. Grounding guard — evidence must be a verbatim transcript span.
    const evidence = typeof field.evidence === "string" ? field.evidence.trim() : "";
    if (evidence.length === 0 || !normalisedTranscript.includes(normalise(evidence))) {
      rejected++;
      appLog("system", PROFILE_VALIDATION_FAILED_SUBJECT, {
        message: "profile-capture rejected a field: evidence not grounded in transcript",
        callId,
        fieldKey: key,
        rejectedValue: field.value ?? null,
        reason: "ungrounded_evidence",
      });
      continue;
    }

    // 3. Type validation + coercion.
    const fieldType = typeByKey.get(key)!;
    const coerced = coerceProfileValue(fieldType, field.value);
    if (!coerced.ok) {
      rejected++;
      appLog("system", PROFILE_VALIDATION_FAILED_SUBJECT, {
        message: "profile-capture rejected a field: value failed type validation",
        callId,
        fieldKey: key,
        rejectedValue: field.value ?? null,
        reason: coerced.reason,
      });
      continue;
    }

    const confidence =
      typeof field.confidence === "number" && field.confidence >= 0 && field.confidence <= 1
        ? field.confidence
        : 0.8;

    // 4. Write — isolated to scope PROFILE; full provenance in jsonValue.
    await prisma.callerAttribute.upsert({
      where: { callerId_key_scope: { callerId, key, scope: PROFILE_SCOPE } },
      update: {
        valueType: "JSON",
        jsonValue: {
          value: coerced.value,
          type: fieldType,
          source: "ai-extract",
          sourceCallId: callId,
          evidence,
          extractedAt: new Date().toISOString(),
        },
        confidence,
        sourceSpecSlug: PROFILE_SOURCE_SPEC_SLUG,
      },
      create: {
        callerId,
        key,
        scope: PROFILE_SCOPE,
        valueType: "JSON",
        jsonValue: {
          value: coerced.value,
          type: fieldType,
          source: "ai-extract",
          sourceCallId: callId,
          evidence,
          extractedAt: new Date().toISOString(),
        },
        confidence,
        sourceSpecSlug: PROFILE_SOURCE_SPEC_SLUG,
      },
    });
    captured++;
  }

  log.info("profile-capture: fields written", { callId, captured, rejected });
  return { captured, rejected };
}

/**
 * Resolve the declared `profileFieldsToCapture` for a call's bound module.
 * Reads `Playbook.config.modules[].settings.profileFieldsToCapture` for the
 * authored module matching the bound `CurriculumModule.slug`. Returns `[]`
 * when the flag is off, no module is bound, or the module declares none —
 * every one of which makes `extractProfileFields` a clean no-op.
 */
export async function resolveProfileFieldsForCall(args: {
  playbookId: string | null | undefined;
  curriculumModuleId: string | null | undefined;
}): Promise<ProfileFieldToCapture[]> {
  if (!ieltsModuleSettingsEnabled()) return [];
  if (!args.playbookId || !args.curriculumModuleId) return [];

  const [playbook, module] = await Promise.all([
    prisma.playbook.findUnique({ where: { id: args.playbookId }, select: { config: true } }),
    prisma.curriculumModule.findUnique({
      where: { id: args.curriculumModuleId },
      select: { slug: true },
    }),
  ]);
  if (!playbook?.config || !module?.slug) return [];

  const config = playbook.config as { modules?: Array<{ id?: string; settings?: Record<string, unknown> }> };
  const authored = config.modules?.find((m) => m.id === module.slug);
  const raw = authored?.settings?.profileFieldsToCapture;
  if (!Array.isArray(raw)) return [];

  // Defensive read — only keep well-formed entries (the authored JSON is
  // operator-editable via JourneyJsonFallback in Phase 1).
  return raw.filter(
    (f): f is ProfileFieldToCapture =>
      !!f &&
      typeof f.key === "string" &&
      typeof f.prompt === "string" &&
      (f.type === "text" || f.type === "number" || f.type === "band"),
  );
}
