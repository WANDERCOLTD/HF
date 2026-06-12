/**
 * Wizard Tool Executor — server-side execution of wizard tool calls.
 *
 * @canonical-doc docs/WIZARD-DATA-BAG.md §5
 * @canonical-doc docs/CONTENT-PIPELINE.md §4
 *
 * Tool definitions live in conversational-wizard-tools.ts (CONVERSATIONAL_TOOLS).
 * This file is the dispatcher; each per-tool module under `./tools/` owns its
 * own server-side execution (resolving entities, creating institutions /
 * courses, returning results to the AI loop).
 */

import { applyStudentExperienceConfig } from "./_shared/apply-student-experience";
import { execute as executeShowOptions } from "./tools/show_options";
import { execute as executeShowUpload } from "./tools/show_upload";
import { execute as executeShowSuggestions } from "./tools/show_suggestions";
import { execute as executeMarkComplete } from "./tools/mark_complete";
import { execute as executeSuggestWelcomeMessage } from "./tools/suggest_welcome_message";
import { execute as executeCreateInstitution } from "./tools/create_institution";
import { execute as executeUpdateCourseConfig } from "./tools/update_course_config";
import { execute as executeUpdateSetup } from "./tools/update_setup";
import { execute as executeCreateCommunity } from "./tools/create_community";
import { execute as executeCreateCourse } from "./tools/create_course";
import type { WizardToolResult } from "./_shared/types";

export { applyStudentExperienceConfig };
export type { WizardToolResult };

/**
 * Execute a wizard tool call.
 *
 * NOTE: show_* tools and update_setup don't have server-side effects —
 * they return confirmation messages that let the AI continue the conversation.
 * The ACTUAL side effects (rendering panels, saving data) happen client-side
 * by inspecting the tool_use blocks in the AI response.
 *
 * create_institution and create_course DO have server-side effects.
 */
export async function executeWizardTool(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  setupData?: Record<string, unknown>,
): Promise<WizardToolResult & { tool_use_id: string }> {
  // Placeholder tool_use_id — will be replaced by caller
  const base = { tool_use_id: "" };

  switch (toolName) {
    case "update_setup":
      return { ...base, ...(await executeUpdateSetup(input, userId, setupData)) };

    case "show_options":
      return { ...base, ...(await executeShowOptions()) };

    case "show_upload":
      return { ...base, ...(await executeShowUpload(input, userId, setupData)) };

    case "show_suggestions":
      return { ...base, ...(await executeShowSuggestions(input, userId, setupData)) };

    case "create_institution":
      return { ...base, ...(await executeCreateInstitution(input, userId, setupData)) };

    case "create_course":
      return { ...base, ...(await executeCreateCourse(input, userId, setupData)) };

    case "create_community":
      return { ...base, ...(await executeCreateCommunity(input, userId, setupData)) };

    case "update_course_config":
      return { ...base, ...(await executeUpdateCourseConfig(input, userId, setupData)) };

    case "suggest_welcome_message":
      return { ...base, ...(await executeSuggestWelcomeMessage(input, userId, setupData)) };

    case "mark_complete":
      return { ...base, ...(await executeMarkComplete(input, userId, setupData)) };

    default: {
      return { ...base, content: `Unknown tool: ${toolName}`, is_error: true };
    }
  }
}
