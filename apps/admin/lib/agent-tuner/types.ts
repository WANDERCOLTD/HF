/**
 * AgentTuner shared types.
 *
 * Used by the <AgentTuner /> component, the /api/agent-tuner/interpret route,
 * and the derive/params utilities. No React or Next.js imports — pure TS.
 */

// ── Pill types ────────────────────────────────────────

export interface PillEffect {
  parameterId: string;   // e.g. "BEH-WARMTH"
  parameterName: string; // e.g. "Warmth Level"
  atFull: number;        // target value at full intensity (0-1)
  atZero: number;        // baseline/current value (0-1)
}

export interface AgentTunerPill {
  id: string;            // kebab-case slug, e.g. "warm-tone"
  label: string;         // display name, e.g. "Warm Tone"
  description: string;   // one-sentence explanation
  intensity: number;     // 0-1, how strongly to apply this concept
  source: "intent" | "suggestion";
  parameters: PillEffect[];
}

// ── Component types ───────────────────────────────────

export interface AgentTunerOutput {
  pills: AgentTunerPill[];
  parameterMap: Record<string, number>; // parameterId → derived value
}

export interface AgentTunerProps {
  initialPills?: AgentTunerPill[];
  context?: InterpretContext;
  onChange: (output: AgentTunerOutput) => void;
  label?: string; // override default "Advanced: Tune behavior"
  bare?: boolean; // render without AdvancedSection wrapper (for when parent provides its own section header)
}

// ── API types ─────────────────────────────────────────

export interface InterpretContext {
  personaSlug?: string;
  subjectName?: string;
  domainName?: string;
}

export interface InterpretRequest {
  intent: string;        // natural language, min 3 chars
  context?: InterpretContext;
}

export interface InterpretResponse {
  ok: boolean;
  pills?: AgentTunerPill[];
  interpretation?: string; // AI's brief summary
  error?: string;
}
