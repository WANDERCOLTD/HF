// ── Tool result type ────────────────────────────────────

export interface WizardToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  /** Fields to auto-inject as a client-side update_setup call (e.g. resolved entity IDs). */
  autoInjectFields?: Record<string, unknown>;
}

/** Per-tool return shape — dispatcher injects tool_use_id. */
export type WizardToolExec = Omit<WizardToolResult, "tool_use_id">;
