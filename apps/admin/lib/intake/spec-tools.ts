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
