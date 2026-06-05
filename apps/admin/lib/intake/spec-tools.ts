// Spec-driven AI tool-use bridge.
//
// `specToUpdateSetupTool(spec)` derives a single `update-setup`
// ToolDefinition from a CrawcusSpec's user-facing fields. The AI calls
// it (one or many fields per call, atomically) instead of replying in
// free text we then regex.
//
// `applyUpdateSetup(session, call, spec)` validates each captured
// arg against the FieldSpec (type + .validates) and writes via the
// existing `setValue` path. Returns the list of fields actually
// applied — fields that fail validation or aren't on the spec are
// silently dropped (the AI will get the resulting snapshot back on
// the next turn and self-correct).
//
// Items 12+13 (tallyseal PR #39, 2026-06-03) made this possible —
// before that, HF had to regex tool calls out of `AIResponse.text`.

import type {
  CrawcusSpec,
  FieldSpec,
  JsonSchemaNode,
  ToolCall,
  ToolDefinition,
  ToolName,
} from "./tallyseal";
import { setValue, type IntakeSession } from "./session-store";

export const UPDATE_SETUP_TOOL_NAME = "update-setup" as ToolName;

interface SpecToolsOptions {
  /**
   * Field keys to omit from the tool — typically internal/derived
   * fields the spec uses for compliance bookkeeping that should not
   * appear to the AI (e.g. `processesArt9`, `classroomToken`).
   */
  readonly excludeFields?: readonly string[];
}

interface SpecPromptOptions extends SpecToolsOptions {
  /**
   * Spec-author-declared field keys that MUST be captured for the
   * intent to become ready. Mirrors what the spec's `readiness()`
   * function asks `has(...)` to check. Exported from the spec module
   * (e.g. `enrollment.intent.ts::REQUIRED_FIELDS`) so a single source
   * drives BOTH the readiness gate AND the prompt's "FIVE required"
   * framing — no parallel hand-edits.
   *
   * When the CRUD surface lands, this list is whatever the admin
   * toggled "required" on in the field editor.
   */
  readonly requiredFields: readonly string[];

  /**
   * Persona / opener / closing pleasantries — the parts of the
   * prompt that are NOT spec-derivable. Defaults to a generic
   * "enrolment assistant" persona. Override per-intent if you want
   * a different tone.
   */
  readonly persona?: string;
}

/**
 * Build the `update-setup` ToolDefinition from a CrawcusSpec.
 * The AI calls this when the learner shares one or more field values.
 */
export function specToUpdateSetupTool(
  spec: CrawcusSpec,
  options: SpecToolsOptions = {},
): ToolDefinition {
  const excluded = new Set(options.excludeFields ?? []);
  const properties: Record<string, JsonSchemaNode> = {};
  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    if (excluded.has(key)) continue;
    properties[key] = fieldSpecToJsonSchema(fieldSpec);
  }
  return {
    name: UPDATE_SETUP_TOOL_NAME,
    description:
      "Capture any setup fields the learner has provided. Call this whenever the learner shares one or more field values — even multiple in a single message. Omit fields they haven't shared. Never invent values; only capture what the learner explicitly stated.",
    inputSchema: {
      type: "object",
      properties,
      additionalProperties: false,
    },
  };
}

/**
 * Apply a tool call's args back into the session via the validated
 * `setValue` path. No-op for tool calls that don't match
 * `UPDATE_SETUP_TOOL_NAME`. Returns the list of fields applied so the
 * caller can decide what to log / show.
 */
export function applyUpdateSetup(
  session: IntakeSession,
  call: ToolCall,
  spec: CrawcusSpec,
  options: SpecToolsOptions = {},
): Array<{ field: string; value: unknown }> {
  if (call.name !== UPDATE_SETUP_TOOL_NAME) return [];
  const args = call.args as Record<string, unknown> | undefined;
  if (!args || typeof args !== "object") return [];

  const excluded = new Set(options.excludeFields ?? []);
  const captured: Array<{ field: string; value: unknown }> = [];

  for (const [key, value] of Object.entries(args)) {
    if (excluded.has(key)) continue;
    const f = spec.fields[key];
    if (!f) continue;
    if (!coerceMatchesBase(f, value)) continue;
    if (f.metadata.options && !f.metadata.options.includes(value)) continue;
    if (f.metadata.validates && !f.metadata.validates(value)) continue;
    setValue(session, key, value);
    captured.push({ field: key, value });
  }
  return captured;
}

function fieldSpecToJsonSchema(field: FieldSpec): JsonSchemaNode {
  const labelEn = localisedEn(field.metadata.label);
  const askHintEn = localisedEn(field.metadata.askHint);
  const description = [labelEn, askHintEn].filter(Boolean).join(" — ") || undefined;
  const common = description ? { description } : {};

  switch (field.base) {
    case "string":
    case "date":
    case "datetime":
    case "reference":
    case "attachment":
      return { type: "string", ...common };
    case "number":
      return { type: "number", ...common };
    case "integer":
      return { type: "integer", ...common };
    case "boolean":
      return { type: "boolean", ...common };
    case "enum": {
      const options = (field.metadata.options ?? []).filter(
        (v): v is string => typeof v === "string",
      );
      return { type: "string", enum: options, ...common };
    }
    case "array":
      return {
        type: "array",
        items: field.of ? fieldSpecToJsonSchema(field.of) : { type: "string" },
        ...common,
      };
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(field.shape ?? {}).map(([k, f]) => [k, fieldSpecToJsonSchema(f)]),
        ),
        ...common,
      };
  }
}

function localisedEn(text: unknown): string | undefined {
  if (typeof text === "string") return text;
  if (text && typeof text === "object" && "en" in text) {
    const en = (text as Record<string, unknown>).en;
    return typeof en === "string" ? en : undefined;
  }
  return undefined;
}

// =====================================================================
// SYSTEM PROMPT — generated from the spec
// =====================================================================
//
// The chat's system prompt MUST NOT hand-curate which fields the AI
// asks about, in what order, or how. All of that comes from the spec.
// When a new field is added to the spec (or a CRUD-surface admin adds
// one), the prompt picks it up automatically. No parallel edits.
//
// The ONLY hand-written piece is `persona` (tone + role framing) —
// because that's a product-marketing concern, not a data-model one.
// Everything else is derived from spec.fields + the spec author's
// `requiredFields` declaration.

const DEFAULT_PERSONA =
  `You are HumanFirst Foundation's enrolment assistant. ` +
  `Be warm, concise, and professional. One short sentence per reply. ` +
  `No emoji, no filler.`;

/**
 * Build the full system prompt from a CrawcusSpec. Pure function —
 * given the same spec + options, returns the same string. Stable
 * enough to participate in the `promptTemplateVersion` audit chain
 * via a content hash (caller hashes the output).
 *
 * The generated prompt:
 *   - lists every non-excluded field in declaration order with its
 *     label + askHint
 *   - flags which are required (per `requiredFields`) vs optional
 *   - enumerates enum option sets inline (so the AI can constrain
 *     values without us hardcoding them in the prompt body)
 *   - tells the AI to stop after one optional-field decline and commit
 *
 * Add a field to the spec → AI asks about it next time someone enrols.
 * Toggle required vs optional in `requiredFields` → readiness gate AND
 * prompt framing both update. Single source of truth.
 */
export function specToSystemPrompt(
  spec: CrawcusSpec,
  options: SpecPromptOptions,
): string {
  const excluded = new Set(options.excludeFields ?? []);
  const required = new Set(options.requiredFields);
  const persona = options.persona ?? DEFAULT_PERSONA;

  const askable: Array<{ key: string; field: FieldSpec; isRequired: boolean }> = [];
  for (const [key, fieldSpec] of Object.entries(spec.fields)) {
    if (excluded.has(key)) continue;
    askable.push({ key, field: fieldSpec, isRequired: required.has(key) });
  }

  if (askable.length === 0) {
    return persona;
  }

  // Order: required first (in declaration order), then optional. Within
  // each tier, declaration order is preserved — that's the spec author's
  // canonical "natural reading order" for the form.
  askable.sort((a, b) => {
    if (a.isRequired !== b.isRequired) return a.isRequired ? -1 : 1;
    return 0; // declaration order via stable sort
  });

  const requiredCount = askable.filter((a) => a.isRequired).length;
  const optionalCount = askable.length - requiredCount;
  const orderList = askable.map((a) => a.key).join(" → ");

  const fieldLines = askable.map(({ key, field, isRequired }, i) =>
    formatFieldLine(i + 1, key, field, isRequired),
  );

  return [
    persona,
    "",
    `Capture ${requiredCount} required value${requiredCount === 1 ? "" : "s"}` +
      (optionalCount > 0
        ? ` and offer ${optionalCount} optional one${optionalCount === 1 ? "" : "s"}`
        : "") +
      ` from the learner.`,
    "",
    "Fields to capture (in this order — one at a time, do not skip ahead):",
    ...fieldLines,
    "",
    "How to capture:",
    `- When the learner shares one or more values — even multiple in a single message — call the \`update-setup\` tool with every value provided. Pass each value under its field key (${askable.map((a) => a.key).join(" / ")}). Omit fields they did not share.`,
    "- Never invent values. Only capture what the learner explicitly stated.",
    "- For enum fields, accept ONLY the listed options. If the learner gives something equivalent (e.g. an age \"32\" for an age-range field), map it to the closest valid option. If they decline a required field, capture 'prefer-not-to-say' when that option exists, otherwise re-ask once.",
    "- For optional fields, if the learner declines, refuses, or types 'skip' / 'no' / 'none' / 'n/a' / 'rather not', DO NOT capture anything (leave it unset) and move on to the next field or to commit.",
    "",
    "How to reply (in the same turn as the tool call):",
    `- Ask in this STRICT order: ${orderList}. One question per reply.`,
    "- If a greeting or affirmation ('hi', 'ok', 'yes') arrives instead of a value, re-ask for that field.",
    "- Never describe your own tool-calling reasoning. Internal scratchpad stays internal.",
    `- When all ${requiredCount} required value${requiredCount === 1 ? "" : "s"} ${requiredCount === 1 ? "is" : "are"} captured AND every optional value has either been provided or declined, confirm enrolment is being submitted and a confirmation email will follow.`,
    "- Do NOT pester. One question per optional field; respect the decline.",
  ].join("\n");
}

function formatFieldLine(
  index: number,
  key: string,
  field: FieldSpec,
  isRequired: boolean,
): string {
  const labelEn = localisedEn(field.metadata.label) ?? key;
  const askHintEn = localisedEn(field.metadata.askHint);
  const flag = isRequired ? "REQUIRED" : "optional";

  const constraints: string[] = [];
  if (field.base === "enum" && field.metadata.options) {
    const opts = field.metadata.options.filter((v): v is string | number | boolean => v !== null && v !== undefined);
    constraints.push(`enum, accept only: ${opts.map((o) => `'${o}'`).join(" | ")}`);
  } else if (field.base === "boolean") {
    constraints.push("boolean");
  } else if (field.base === "number" || field.base === "integer") {
    constraints.push(field.base);
  }

  const constraintSuffix = constraints.length > 0 ? ` (${constraints.join("; ")})` : "";
  const askSuffix = askHintEn ? ` Ask: "${askHintEn}"` : "";

  return `  ${index}. \`${key}\` [${flag}] — ${labelEn}${constraintSuffix}.${askSuffix}`;
}

function coerceMatchesBase(field: FieldSpec, value: unknown): boolean {
  switch (field.base) {
    case "string":
    case "date":
    case "datetime":
    case "enum":
    case "reference":
    case "attachment":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
