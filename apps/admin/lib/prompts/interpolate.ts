/**
 * Template Interpolation
 *
 * Replaces {{var}} placeholders in prompt templates with runtime values.
 * Used by consumers of getPromptTemplate() when the prompt has templateVars.
 */

/**
 * Replace all {{key}} placeholders in a template with their values.
 *
 * @example
 * interpolateTemplate("Hello {{name}}", { name: "World" })
 * // => "Hello World"
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value),
    template,
  );
}
