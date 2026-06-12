// Barrel shim — wizard-tool-executor lives in the sibling directory.
// External callers continue to import from `@/lib/chat/wizard-tool-executor`.
// See ./wizard-tool-executor/index.ts for the dispatcher; per-tool modules
// live under ./wizard-tool-executor/tools/.
export { executeWizardTool, applyStudentExperienceConfig } from "./wizard-tool-executor/index";
export type { WizardToolResult } from "./wizard-tool-executor/index";
