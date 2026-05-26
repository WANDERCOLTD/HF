/**
 * PromptTemplateCompiler - Compiles prompt templates from AnalysisSpecs
 *
 * New architecture: Each AnalysisSpec can have a promptTemplate that gets
 * compiled at prompt composition time with runtime values.
 *
 * Template syntax:
 *   {{value}}           - The measured value (0-1 for MEASURE specs)
 *   {{label}}           - "high", "medium", "low" based on value
 *   {{param.name}}      - Parameter name
 *   {{param.definition}} - Parameter definition
 *   {{param.highLabel}} - What high means
 *   {{param.lowLabel}}  - What low means
 *   {{memories.facts}}   - JSON array of FACT memories
 *   {{memories.preferences}} - JSON array of PREFERENCE memories
 *   {{memories.all}}     - All memories for user
 *   {{user.name}}        - User name if available
 *   {{#if high}}...{{/if}} - Conditional for high values (>= 0.7)
 *   {{#if medium}}...{{/if}} - Conditional for medium values (0.3-0.7)
 *   {{#if low}}...{{/if}} - Conditional for low values (< 0.3)
 *   {{#if hasMemories}}...{{/if}} - Conditional for having memories
 *
 * Example template:
 *   "The caller scores {{value}} on {{param.name}} ({{label}}).
 *    {{#if high}}Be warm and conversational.{{/if}}
 *    {{#if low}}Be direct and efficient.{{/if}}"
 */

import { MemoryCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMemoriesByCategory } from "@/lib/constants";

export interface TemplateContext {
  // For MEASURE specs
  value?: number;
  parameterId?: string;

  // Caller info
  callerId?: string;

  // All parameter values (for cross-referencing)
  parameterValues?: Record<string, number>;

  // Memories (optional - will be fetched if callerId provided and not passed)
  memories?: CallerMemory[];
}

export interface CallerMemory {
  category: string;
  key: string;
  value: string;
  confidence: number;
  decayFactor?: number;
}

export interface CompiledSpecPrompt {
  specId: string;
  specSlug: string;
  specName: string;
  outputType: string;
  domain: string | null;
  renderedPrompt: string;
  templateUsed: string;
  context: {
    value?: number;
    label?: string;
    parameterId?: string;
    parameterName?: string;
  };
}

export interface SpecPromptComposition {
  prompts: CompiledSpecPrompt[];
  totalSpecs: number;
  specsWithTemplates: number;
  memoriesIncluded: number;
  composedAt: string;
}

/**
 * Gather and compile all prompt templates from active AnalysisSpecs
 */
export async function composePromptsFromSpecs(
  context: TemplateContext
): Promise<SpecPromptComposition> {
  // Get all active specs with templates
  const specs = await prisma.analysisSpec.findMany({
    where: {
      isActive: true,
      promptTemplate: { not: null },
    },
    include: {
      triggers: {
        include: {
          actions: {
            include: {
              parameter: true,
            },
          },
        },
      },
    },
    orderBy: [{ priority: "desc" }, { domain: "asc" }, { name: "asc" }],
  });

  // Fetch memories if we have a callerId and they weren't provided
  let memories = context.memories;
  if (!memories && context.callerId) {
    const dbMemories = await prisma.callerMemory.findMany({
      where: {
        callerId: context.callerId,
        supersededById: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [{ confidence: "desc" }, { extractedAt: "desc" }],
      take: 100,
    });

    memories = dbMemories.map((m) => ({
      category: m.category,
      key: m.key,
      value: m.value,
      confidence: m.confidence,
      decayFactor: m.decayFactor,
    }));
  }

  const prompts: CompiledSpecPrompt[] = [];

  for (const spec of specs) {
    if (!spec.promptTemplate) continue;

    // Get parameter info from spec's actions
    const parameterFromSpec = getParameterFromSpec(spec);
    const parameterId = context.parameterId || parameterFromSpec?.parameterId;

    // Get value for this spec
    const value =
      context.value !== undefined
        ? context.value
        : parameterId && context.parameterValues
          ? context.parameterValues[parameterId]
          : undefined;

    // Build template context for this spec
    const templateData = buildTemplateData(
      spec,
      value,
      parameterId,
      parameterFromSpec,
      memories,
      context
    );

    // Render the template
    const renderedPrompt = renderTemplate(spec.promptTemplate, templateData);

    // Skip if template rendered to empty (all conditionals failed)
    if (renderedPrompt.trim()) {
      prompts.push({
        specId: spec.id,
        specSlug: spec.slug,
        specName: spec.name,
        outputType: spec.outputType,
        domain: spec.domain,
        renderedPrompt,
        templateUsed: spec.promptTemplate,
        context: {
          value,
          label: templateData.label,
          parameterId,
          parameterName: parameterFromSpec?.name,
        },
      });
    }
  }

  return {
    prompts,
    totalSpecs: specs.length,
    specsWithTemplates: specs.filter((s) => s.promptTemplate).length,
    memoriesIncluded: memories?.length || 0,
    composedAt: new Date().toISOString(),
  };
}

/**
 * Get the primary parameter from a spec (from its first MEASURE action)
 */
function getParameterFromSpec(spec: any): any | null {
  for (const trigger of spec.triggers || []) {
    for (const action of trigger.actions || []) {
      if (action.parameter) {
        return action.parameter;
      }
    }
  }
  return null;
}

/**
 * Build the data object for template rendering
 */
function buildTemplateData(
  spec: any,
  value: number | undefined,
  parameterId: string | undefined,
  parameter: any | null,
  memories: CallerMemory[] | undefined,
  context: TemplateContext
): Record<string, any> {
  const label = getValueLabel(value);

  const data: Record<string, any> = {
    // Value info
    value: value !== undefined ? value.toFixed(2) : "",
    label,
    high: value !== undefined && value >= 0.7,
    medium: value !== undefined && value >= 0.3 && value < 0.7,
    low: value !== undefined && value < 0.3,

    // Spec info
    spec: {
      name: spec.name,
      slug: spec.slug,
      domain: spec.domain || "",
      outputType: spec.outputType,
    },

    // Parameter info
    param: parameter
      ? {
          id: parameter.parameterId,
          name: parameter.name,
          definition: parameter.definition || "",
          highLabel: parameter.interpretationHigh || "High",
          lowLabel: parameter.interpretationLow || "Low",
        }
      : {
          id: parameterId || "",
          name: "",
          definition: "",
          highLabel: "High",
          lowLabel: "Low",
        },

    // Memories - grouped using centralized helper
    memories: {
      all: memories || [],
      ...getMemoriesByCategory(memories || []),
    },
    hasMemories: memories && memories.length > 0,

    // Caller info (can be extended)
    caller: {
      id: context.callerId || "",
      name: "", // Would need to fetch from Caller table
    },

    // All parameter values for cross-referencing
    parameters: context.parameterValues || {},
  };

  return data;
}

/**
 * Get a label for a value
 */
function getValueLabel(value: number | undefined): string {
  if (value === undefined) return "";
  if (value >= 0.7) return "high";
  if (value >= 0.3) return "medium";
  return "low";
}

/**
 * Render a template with data using simple Mustache-style syntax
 */
export function renderTemplate(
  template: string,
  data: Record<string, any>
): string {
  let result = template;

  // Handle section blocks first: {{#sectionName}}...{{/sectionName}}
  // These are Mustache-style blocks that scope variables to an object
  result = processSectionBlocks(result, data);

  // Handle conditionals: {{#if condition}}...{{/if}}
  result = processConditionals(result, data);

  // Handle inverse conditionals: {{#unless condition}}...{{/unless}}
  result = processInverseConditionals(result, data);

  // Handle loops: {{#each items}}...{{/each}}
  result = processLoops(result, data);

  // Handle simple variable substitution: {{variable}}
  result = substituteVariables(result, data);

  // Clean up any remaining unmatched tags
  result = result.replace(/\{\{[^}]+\}\}/g, "");

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

/**
 * Process Mustache-style section blocks: {{#sectionName}}...{{/sectionName}}
 * If sectionName is an object, variables inside are scoped to that object
 * If sectionName is an array, it iterates over items
 * If sectionName is falsy, the section is removed
 */
function processSectionBlocks(
  template: string,
  data: Record<string, any>
): string {
  // Match {{#name}}...{{/name}} but NOT {{#if, {{#unless, {{#each
  const sectionRegex = /\{\{#(?!if\s|unless\s|each\s)(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

  return template.replace(sectionRegex, (match, sectionPath, content) => {
    const sectionData = getNestedValue(data, sectionPath);

    // If falsy, remove the section
    if (!isTruthy(sectionData)) {
      return "";
    }

    // If it's an array, iterate over items
    if (Array.isArray(sectionData)) {
      return sectionData
        .map((item, index) => {
          // For each item, recursively render with item as context
          // Replace {{property}} with item.property within this section
          let itemContent = content;
          if (typeof item === "object" && item !== null) {
            // Replace direct property references like {{name}} with item.name
            itemContent = itemContent.replace(
              /\{\{(\w+)\}\}/g,
              (m: string, prop: string) => {
                // Check if it's a property of the current item
                if (prop in item) {
                  return item[prop] !== undefined ? String(item[prop]) : "";
                }
                // Fall through to global data
                return m;
              }
            );
          }
          return itemContent;
        })
        .join("\n");
    }

    // If it's an object, scope variables to that object
    if (typeof sectionData === "object" && sectionData !== null) {
      // Replace {{property}} with sectionData.property within this section
      const scopedContent = content.replace(
        /\{\{(\w+)\}\}/g,
        (m: string, prop: string) => {
          if (prop in sectionData) {
            const val = sectionData[prop];
            return val !== undefined && val !== null ? String(val) : "";
          }
          // Check in global data too
          if (prop in data) {
            const val = data[prop];
            return val !== undefined && val !== null ? String(val) : "";
          }
          return m;
        }
      );
      // Recursively process any nested sections
      return processSectionBlocks(scopedContent, { ...data, ...sectionData });
    }

    // For truthy primitives, just return the content
    return content;
  });
}

/**
 * Process {{#if condition}}...{{/if}} blocks
 */
function processConditionals(
  template: string,
  data: Record<string, any>
): string {
  const ifRegex = /\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g;

  return template.replace(ifRegex, (match, condition, content) => {
    const value = getNestedValue(data, condition);
    if (isTruthy(value)) {
      return content;
    }
    return "";
  });
}

/**
 * Process {{#unless condition}}...{{/unless}} blocks
 */
function processInverseConditionals(
  template: string,
  data: Record<string, any>
): string {
  const unlessRegex =
    /\{\{#unless\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/unless\}\}/g;

  return template.replace(unlessRegex, (match, condition, content) => {
    const value = getNestedValue(data, condition);
    if (!isTruthy(value)) {
      return content;
    }
    return "";
  });
}

/**
 * Process {{#each items}}...{{/each}} blocks
 */
function processLoops(template: string, data: Record<string, any>): string {
  const eachRegex =
    /\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g;

  return template.replace(eachRegex, (match, arrayPath, content) => {
    const items = getNestedValue(data, arrayPath);
    if (!Array.isArray(items) || items.length === 0) {
      return "";
    }

    return items
      .map((item, index) => {
        // Replace {{this.property}} with item.property
        let itemContent = content.replace(
          /\{\{this\.(\w+)\}\}/g,
          (m: string, prop: string) => {
            return item[prop] !== undefined ? String(item[prop]) : "";
          }
        );
        // Replace {{this}} with the item itself (for primitives)
        itemContent = itemContent.replace(/\{\{this\}\}/g, String(item));
        // Replace {{@index}} with the index
        itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));
        return itemContent;
      })
      .join("\n");
  });
}

/**
 * Substitute simple variables: {{variable}} or {{nested.path}}
 */
function substituteVariables(
  template: string,
  data: Record<string, any>
): string {
  const varRegex = /\{\{(\w+(?:\.\w+)*)\}\}/g;

  return template.replace(varRegex, (match, path) => {
    const value = getNestedValue(data, path);
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split(".");
  let current = obj;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Check if a value is truthy for conditional purposes
 */
function isTruthy(value: any): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Compile a single template (for testing/preview)
 */
export function compileTemplate(
  template: string,
  context: {
    value?: number;
    parameterName?: string;
    parameterDefinition?: string;
    highLabel?: string;
    lowLabel?: string;
    memories?: CallerMemory[];
    userName?: string;
  }
): string {
  const data = {
    value: context.value !== undefined ? context.value.toFixed(2) : "",
    label: getValueLabel(context.value),
    high: context.value !== undefined && context.value >= 0.7,
    medium:
      context.value !== undefined &&
      context.value >= 0.3 &&
      context.value < 0.7,
    low: context.value !== undefined && context.value < 0.3,
    param: {
      name: context.parameterName || "",
      definition: context.parameterDefinition || "",
      highLabel: context.highLabel || "High",
      lowLabel: context.lowLabel || "Low",
    },
    memories: {
      all: context.memories || [],
      facts: context.memories?.filter((m) => m.category === "FACT") || [],
      preferences:
        context.memories?.filter((m) => m.category === "PREFERENCE") || [],
    },
    hasMemories: context.memories && context.memories.length > 0,
    user: {
      name: context.userName || "",
    },
  };

  return renderTemplate(template, data);
}
