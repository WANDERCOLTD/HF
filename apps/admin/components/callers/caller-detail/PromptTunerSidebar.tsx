"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { X, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import "./prompt-tuner.css";
import { usePendingChangesTray } from "@/hooks/use-pending-changes-tray";
import { useIsOperatorOrAbove } from "@/hooks/useIsOperatorOrAbove";
// #911 — type-only import (stripped at build) signals to the audit-epic-100
// `authoringBehTargetBypassCount` static check that this component now reads
// the SYSTEM→PLAYBOOK→CALLER cascade through the canonical bulk helper. The
// helper is server-only (imports prisma); we fetch via the new endpoint at
// `/api/callers/[id]/effective-behavior-targets` rather than calling it
// directly. Type-only import keeps the server module out of the client
// bundle while preserving chain-contract Link 3a parity.
import type { EffectiveBehaviorTarget } from "@/lib/tolerance/getEffectiveBehaviorTargetsForCaller";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parameter from the /api/playbooks/:id/targets endpoint */
export interface TunerParameter {
  parameterId: string;
  name: string;
  definition: string | null;
  domainGroup: string | null;
  interpretationHigh: string | null;
  interpretationLow: string | null;
  systemValue: number | null;
  playbookValue: number | null;
  effectiveValue: number;
  effectiveScope: string;
}

/** A pending change the educator has made */
export interface PendingChange {
  type: "target" | "config";
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
  parameterId?: string;
  numericValue?: number;
  configKey?: string;
  configValue?: string;
  /**
   * #598 Slice 2 — when `true`, warm-recompose every active learner's prompt
   * on save (POST `/api/playbooks/[id]/recompose-all`). When `false` / absent,
   * the change still takes effect on the next call lazily via the stamp-and-
   * check pattern (#825) — the UI shows a "takes effect on next call" banner.
   * Mastery threshold sets this `true`; cadence + decay scale set it `false`.
   */
  recompose?: boolean;
  /**
   * #598 Slice 2 — write-path tag for the three new tolerance fields.
   * `"playbook-config"` lands under `Playbook.config.tolerances.<key>` via
   * `PATCH /api/playbooks/[id]`; `"behavior-target"` routes via the existing
   * target endpoints with `parameterId="TOL-MASTERY-THRESHOLD"`.
   */
  toleranceWritePath?: "playbook-config" | "behavior-target";
  /**
   * For `toleranceWritePath === "playbook-config"` — the nested key under
   * `Playbook.config.tolerances` to write.
   */
  tolerancesConfigKey?: "retrievalCadenceOverride" | "memoryDecayScale";
}

export interface PromptTunerSidebarProps {
  open: boolean;
  llmPrompt: Record<string, any> | null;
  callerId: string;
  callerName: string;
  playbookId: string | null;
  /**
   * Display name of the active playbook (#911) — used in the
   * pending-changes-tray `scopeLabel` so the entry reads
   * `Course <playbookName>` rather than the truncated UUID. Falls back to
   * `playbookId.slice(0,8)` when not supplied so we don't regress existing
   * call sites until they wire this in.
   */
  playbookName?: string | null;
  onApplied: (changes: PendingChange[]) => void;
  /**
   * Required for the fixed-sidebar mode (rendered when `inline` is false) so
   * the X button can dismiss the overlay. Optional in inline mode — the host
   * (e.g. the #641 Tune tab) controls visibility via tab routing.
   */
  onClose?: () => void;
  /** Render inline (inside a panel) instead of as a fixed sidebar overlay */
  inline?: boolean;
}

// ---------------------------------------------------------------------------
// Approach config options
// ---------------------------------------------------------------------------

const STYLE_OPTIONS = [
  { value: "socratic", label: "Socratic", desc: "Lead with questions" },
  { value: "directive", label: "Directive", desc: "Explain first, then check" },
  { value: "reflective", label: "Reflective", desc: "Metacognitive prompts" },
  { value: "open", label: "Open", desc: "Adaptive mix" },
] as const;

const AUDIENCE_OPTIONS = [
  { value: "primary", label: "Primary (5\u201311)" },
  { value: "secondary", label: "Secondary (11\u201316)" },
  { value: "sixth-form", label: "Sixth-form (16\u201319)" },
  { value: "higher-ed", label: "Higher Ed" },
  { value: "adult-professional", label: "Professional" },
  { value: "adult-casual", label: "Casual" },
  { value: "mixed", label: "Mixed / Adaptive" },
] as const;

const MODE_OPTIONS = [
  { value: "recall", label: "Recall", desc: "Spaced retrieval" },
  { value: "comprehension", label: "Comprehension", desc: "Read & discuss" },
  { value: "practice", label: "Practice", desc: "Worked examples" },
  { value: "syllabus", label: "Syllabus", desc: "Structured progression" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: number): string {
  return v.toFixed(2);
}

/** Humanise a BEH-PARAM-NAME into "Param Name" (safety fallback) */
function humanise(parameterId: string): string {
  return parameterId
    .replace(/^BEH-/i, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Generate a unique 2-3 char abbreviation from a parameter name */
function abbreviate(name: string): string {
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  // Use first letter of each word (up to 3)
  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

/** Group parameters by domainGroup, with nice group labels */
function groupParameters(params: TunerParameter[]): { group: string; params: TunerParameter[] }[] {
  const map = new Map<string, TunerParameter[]>();
  for (const p of params) {
    const g = p.domainGroup || "Other";
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(p);
  }
  // Sort groups alphabetically, but put "Other" last
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    })
    .map(([group, params]) => ({ group, params }));
}

/** Extract a config value by sniffing the llmPrompt instructions text */
function extractConfigValue(
  llmPrompt: Record<string, any> | null,
  options: readonly { value: string }[],
  instructionKey: string,
  metadataKey: string,
  fallback: string,
): string {
  const instr = llmPrompt?.instructions;
  if (instr?.[instructionKey] && typeof instr[instructionKey] === "string") {
    const text = instr[instructionKey].toLowerCase();
    for (const opt of options) {
      if (text.includes(opt.value)) return opt.value;
    }
  }
  return llmPrompt?.metadata?.[metadataKey] ?? fallback;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptTunerSidebar({
  open,
  llmPrompt,
  callerId,
  callerName,
  playbookId,
  playbookName,
  onApplied,
  onClose,
  inline,
}: PromptTunerSidebarProps): React.ReactElement | null {
  // #1664 Decision 5 — tooltip interpretation lines + low/high labels
  // are OPERATOR-only. The PromptTuner sits inside the caller's Tune
  // tab which is OPERATOR-gated at the route level today, but the
  // hook is belt-and-suspenders.
  const operatorOrBetter = useIsOperatorOrAbove();
  // --- Fetch real parameters from the targets API ---
  const [parameters, setParameters] = useState<TunerParameter[]>([]);
  const [paramsLoading, setParamsLoading] = useState(false);
  const [paramsError, setParamsError] = useState<string | null>(null);

  // Scope is declared below in the legacy ordering; track it via a ref-shaped
  // closure variable so `refreshParameters` can pick the cascade endpoint at
  // call time without listing `scope` in its dep-list (which would change the
  // identity every time the educator toggles, breaking the open-time effect).
  const [scope, setScope] = useState<"course" | "learner" | null>(null);
  const scopeRef = useRef<"course" | "learner" | null>(null);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  /**
   * Load the slider catalogue. Always hits `/api/playbooks/[id]/targets`
   * first — that endpoint gives us metadata (name, definition, domainGroup,
   * interpretation strings) plus the SYSTEM→PLAYBOOK cascade.
   *
   * #911 — when the educator has chosen scope=learner and a callerId is in
   * context, overlay the SYSTEM→PLAYBOOK→CALLER cascade from the new
   * `/api/callers/[id]/effective-behavior-targets?playbookId=...` endpoint
   * so the slider value at line 940 (`draftTargets[p.parameterId] ??
   * p.effectiveValue`) renders any learner override. The new endpoint reads
   * through the canonical bulk helper (lib/tolerance/getEffectiveBehaviorTargetsForCaller)
   * which honours chain-contract Link 3 (multi-identity MAX).
   *
   * The course-scope path stays untouched so TolerancesSettings and the
   * existing #710 shadow-warning logic don't regress.
   */
  const refreshParameters = useCallback(async (): Promise<TunerParameter[] | null> => {
    if (!playbookId) return null;
    setParamsLoading(true);
    setParamsError(null);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/targets`);
      const result = await res.json();
      if (!result.ok) {
        setParamsError(result.error || "Failed to load parameters");
        return null;
      }

      let merged: TunerParameter[] = result.parameters;

      // #911 — second pass for learner-scope cascade overlay.
      if (scopeRef.current === "learner" && callerId) {
        try {
          const cascadeRes = await fetch(
            `/api/callers/${callerId}/effective-behavior-targets?playbookId=${playbookId}`,
          );
          const cascadeJson = await cascadeRes.json();
          if (cascadeJson?.ok && Array.isArray(cascadeJson.parameters)) {
            const byParam = new Map<string, EffectiveBehaviorTarget>();
            for (const p of cascadeJson.parameters as EffectiveBehaviorTarget[]) {
              byParam.set(p.parameterId, p);
            }
            merged = merged.map((p) => {
              const cascade = byParam.get(p.parameterId);
              if (!cascade) return p;
              return {
                ...p,
                systemValue: cascade.systemValue ?? p.systemValue,
                playbookValue: cascade.playbookValue ?? p.playbookValue,
                effectiveValue: cascade.effectiveValue,
                effectiveScope: cascade.sourceScope,
              };
            });
          }
        } catch (err) {
          // Non-fatal — keep playbook-cascade fallback and surface a log
          // so the next investigation can see why the CALLER layer didn't
          // overlay. The slider still works, just without the override.
          console.warn("[tuner] effective-behavior-targets fetch failed; falling back to playbook cascade", err);
        }
      }

      setParameters(merged);
      return merged;
    } catch (err) {
      setParamsError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setParamsLoading(false);
    }
  }, [playbookId, callerId]);

  useEffect(() => {
    if (!playbookId || !open) return;
    void refreshParameters();
    // Re-fetch when the educator toggles scope so the CALLER overlay applies
    // immediately. `scopeRef` is updated by the effect above; this effect's
    // dep array intentionally includes `scope` (not the ref) to re-run on
    // toggle.
  }, [playbookId, open, scope, refreshParameters]);

  // #857 — feed the pending-changes tray with caller-in-context while the
  // sidebar is open. The tray's Toggle 1 ("Also recompose <name>") uses
  // this to render the caller's name + default ON. Cleared on close.
  const { entries: trayEntries, push: trayPush, setCallerInContext: traySetCaller } = usePendingChangesTray();
  useEffect(() => {
    if (!open) return;
    if (!callerId || !callerName) return;
    traySetCaller({ id: callerId, name: callerName });
    return () => {
      traySetCaller(null);
    };
  }, [open, callerId, callerName, traySetCaller]);

  const lastTrayEntryCountRef = useRef(0);

  // --- Locally remember what we just applied ---
  //
  // The parent's `llmPrompt` is a *snapshot* of the most recent ComposedPrompt
  // row. Since we deliberately stopped auto-recomposing on save (per #602/#603
  // policy), that snapshot stays stale after a config change — it still
  // reflects the pre-save style/audience/mode. Without overriding it the
  // pendingChanges diff never resolves, the PENDING list never clears, and
  // the Apply button is stuck even though the playbook.config write succeeded.
  //
  // appliedConfig captures the values we just persisted and takes precedence
  // over the stale llmPrompt-derived currents. It's reset when the active
  // playbook changes.
  const [appliedConfig, setAppliedConfig] = useState<{
    style?: string;
    audience?: string;
    mode?: string;
  }>({});

  useEffect(() => {
    setAppliedConfig({});
  }, [playbookId]);

  // --- Extract current config from llmPrompt, preferring locally-applied ---
  const currentStyle = useMemo(
    () => appliedConfig.style ?? extractConfigValue(llmPrompt, STYLE_OPTIONS, "teaching_style", "interactionPattern", "open"),
    [llmPrompt, appliedConfig.style],
  );
  const currentAudience = useMemo(
    () => appliedConfig.audience ?? extractConfigValue(llmPrompt, AUDIENCE_OPTIONS, "audience", "audience", "secondary"),
    [llmPrompt, appliedConfig.audience],
  );
  const currentMode = useMemo(
    () => appliedConfig.mode ?? extractConfigValue(llmPrompt, MODE_OPTIONS, "pedagogy_mode", "teachingMode", "comprehension"),
    [llmPrompt, appliedConfig.mode],
  );

  // --- Draft state (persists while component is mounted) ---
  const [draftTargets, setDraftTargets] = useState<Record<string, number>>({});
  const [draftStyle, setDraftStyle] = useState(currentStyle);
  const [draftAudience, setDraftAudience] = useState(currentAudience);
  const [draftMode, setDraftMode] = useState(currentMode);
  // #598 Slice 2 — tolerance drafts. Course tolerances live under
  // `Playbook.config.tolerances`. Learner draft is just the mastery threshold
  // override (the only learner-scoped knob in this slice).
  const [draftCourseTolerances, setDraftCourseTolerances] = useState<{
    masteryThreshold?: number;
    retrievalCadenceOverride?: number;
    memoryDecayScale?: number;
  }>({});
  const [draftLearnerMasteryOverride, setDraftLearnerMasteryOverride] =
    useState<number | undefined>(undefined);
  const [courseTolerances, setCourseTolerances] = useState<{
    masteryThreshold?: number;
    retrievalCadenceOverride?: number;
    memoryDecayScale?: number;
  }>({});
  // #911 — `scope` was previously declared here; moved up next to
  // `refreshParameters` so the fetch can pick the cascade endpoint at call
  // time. Local alias preserved so the existing render code below reads the
  // same name.
  const approachLocked = scope === "learner";
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [activeLearnerCount, setActiveLearnerCount] = useState<number | null>(null);
  // #710 — surface LEARNER-level overrides on this caller so a PLAYBOOK-scope
  // change can warn when it'll be silently shadowed for the active learner.
  const [learnerOverrides, setLearnerOverrides] = useState<
    Array<{ parameterId: string; targetValue: number; origin: "MANUAL_OVERRIDE" | "ADAPTED"; updatedAt: string }>
  >([]);

  useEffect(() => {
    if (!callerId || !open) return;
    let cancelled = false;
    fetch(`/api/callers/${callerId}/behavior-targets`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.overrides)) {
          setLearnerOverrides(data.overrides);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [callerId, open]);

  // #598 Slice 2 — load `Playbook.config.tolerances` for the Tolerances section.
  const refreshCourseTolerances = useCallback(async () => {
    if (!playbookId) return;
    try {
      const res = await fetch(`/api/playbooks/${playbookId}`);
      const data = await res.json();
      const tol = (data?.playbook?.config as Record<string, unknown> | undefined)?.tolerances as
        | { masteryThreshold?: number; retrievalCadenceOverride?: number; memoryDecayScale?: number }
        | undefined;
      setCourseTolerances(tol ?? {});
    } catch {
      // Non-fatal — sidebar still loads, controls just show empty.
    }
  }, [playbookId]);

  useEffect(() => {
    if (!playbookId || !open) return;
    void refreshCourseTolerances();
  }, [playbookId, open, refreshCourseTolerances]);

  // Per-learner mastery threshold override (BehaviorTarget(CALLER) for
  // TOL-MASTERY-THRESHOLD) — derived from the existing learnerOverrides fetch.
  const currentLearnerMasteryOverride = useMemo<number | undefined>(() => {
    const row = learnerOverrides.find((o) => o.parameterId === "TOL-MASTERY-THRESHOLD");
    return row?.targetValue;
  }, [learnerOverrides]);

  // Watch the tray for "external clear" events — fires when the user
  // hits Save & apply OR Discard all on the tray. In either case the
  // pending state has been resolved outside this sidebar, so we
  // refresh from the server and drop any local drafts so PENDING
  // CHANGES (N) and the "Apply to <name> only" CTA disappear in
  // lock-step with the tray.
  useEffect(() => {
    const prevCount = lastTrayEntryCountRef.current;
    lastTrayEntryCountRef.current = trayEntries.length;
    if (prevCount === 0 || trayEntries.length !== 0) return;
    void refreshParameters();
    void refreshCourseTolerances();
    setDraftTargets({});
    setDraftStyle(currentStyle);
    setDraftAudience(currentAudience);
    setDraftMode(currentMode);
    setDraftCourseTolerances(courseTolerances);
    setDraftLearnerMasteryOverride(currentLearnerMasteryOverride);
  }, [
    trayEntries.length,
    refreshParameters,
    refreshCourseTolerances,
    currentStyle,
    currentAudience,
    currentMode,
    courseTolerances,
    currentLearnerMasteryOverride,
  ]);

  // Fetch ACTIVE enrollment count so the Apply button can show consequence up front.
  useEffect(() => {
    if (!playbookId || !open) return;
    let cancelled = false;
    fetch(`/api/playbooks/${playbookId}/enrollments?status=ACTIVE`)
      .then((r) => r.json())
      .then((result) => {
        if (cancelled) return;
        const count =
          result?.count ??
          (Array.isArray(result?.enrollments) ? result.enrollments.length : null);
        if (typeof count === "number") setActiveLearnerCount(count);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [playbookId, open]);

  // Reset scope when panel is closed so next open forces a fresh choice.
  useEffect(() => {
    if (!open) setScope(null);
  }, [open]);

  // Sync draft targets from API data (only when params first load, not on every render)
  useEffect(() => {
    if (parameters.length === 0) return;
    setDraftTargets((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of parameters) {
        if (!(p.parameterId in next)) {
          next[p.parameterId] = p.effectiveValue;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [parameters]);

  // #911 — when the educator toggles scope, drop any drafts so the next
  // render reflects the freshly-fetched cascade (which may now include a
  // CALLER-layer override that should show through immediately). Without
  // this the draft from the previous scope sticks at the old
  // `effectiveValue` and the slider lies after the toggle.
  useEffect(() => {
    setDraftTargets({});
  }, [scope]);

  // Sync config drafts when llmPrompt changes (e.g. after recompose)
  useEffect(() => {
    setDraftStyle(currentStyle);
  }, [currentStyle]);
  useEffect(() => {
    setDraftAudience(currentAudience);
  }, [currentAudience]);
  useEffect(() => {
    setDraftMode(currentMode);
  }, [currentMode]);

  // #598 Slice 2 — keep tolerance drafts in sync with server state.
  useEffect(() => {
    setDraftCourseTolerances(courseTolerances);
  }, [courseTolerances]);
  useEffect(() => {
    setDraftLearnerMasteryOverride(currentLearnerMasteryOverride);
  }, [currentLearnerMasteryOverride]);

  // Flipping to learner scope snaps pending Approach changes back to current —
  // those fields are course-level only and can't be saved per-learner.
  useEffect(() => {
    if (scope === "learner") {
      setDraftStyle(currentStyle);
      setDraftAudience(currentAudience);
      setDraftMode(currentMode);
    }
  }, [scope, currentStyle, currentAudience, currentMode]);

  // Clear stale result/error banner when user starts a new round of changes.
  useEffect(() => {
    if (applyResult) setApplyResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // --- Group parameters ---
  const grouped = useMemo(() => groupParameters(parameters), [parameters]);

  // --- Compute pending changes ---
  const pendingChanges = useMemo(() => {
    const changes: PendingChange[] = [];

    // Target changes
    for (const p of parameters) {
      const draft = draftTargets[p.parameterId];
      if (draft !== undefined && Math.abs(p.effectiveValue - draft) > 0.01) {
        changes.push({
          type: "target",
          key: p.parameterId,
          label: p.name || humanise(p.parameterId),
          oldValue: fmt(p.effectiveValue),
          newValue: fmt(draft),
          parameterId: p.parameterId,
          numericValue: draft,
        });
      }
    }

    // Config changes
    if (draftStyle !== currentStyle) {
      changes.push({
        type: "config", key: "style", label: "Teaching Style",
        oldValue: currentStyle, newValue: draftStyle,
        configKey: "interactionPattern", configValue: draftStyle,
      });
    }
    if (draftAudience !== currentAudience) {
      changes.push({
        type: "config", key: "audience", label: "Audience",
        oldValue: currentAudience, newValue: draftAudience,
        configKey: "audience", configValue: draftAudience,
      });
    }
    if (draftMode !== currentMode) {
      changes.push({
        type: "config", key: "mode", label: "Learning Mode",
        oldValue: currentMode, newValue: draftMode,
        configKey: "teachingMode", configValue: draftMode,
      });
    }

    // #598 Slice 2 — tolerance changes
    if (scope === "course") {
      const masteryDraft = draftCourseTolerances.masteryThreshold;
      const masteryCurrent = courseTolerances.masteryThreshold;
      if (masteryDraft !== masteryCurrent) {
        changes.push({
          type: "target",
          key: "tolerances.masteryThreshold:course",
          label: "Mastery Threshold (course)",
          oldValue: masteryCurrent !== undefined ? fmt(masteryCurrent) : "(default)",
          newValue: masteryDraft !== undefined ? fmt(masteryDraft) : "(default)",
          parameterId: "TOL-MASTERY-THRESHOLD",
          numericValue: masteryDraft,
          recompose: true,
          toleranceWritePath: "behavior-target",
        });
      }
      const cadenceDraft = draftCourseTolerances.retrievalCadenceOverride;
      const cadenceCurrent = courseTolerances.retrievalCadenceOverride;
      if (cadenceDraft !== cadenceCurrent) {
        changes.push({
          type: "config",
          key: "tolerances.retrievalCadenceOverride",
          label: "Retrieval Cadence",
          oldValue: cadenceCurrent !== undefined ? String(cadenceCurrent) : "(preset)",
          newValue: cadenceDraft !== undefined ? String(cadenceDraft) : "(preset)",
          recompose: false,
          toleranceWritePath: "playbook-config",
          tolerancesConfigKey: "retrievalCadenceOverride",
        });
      }
      const decayDraft = draftCourseTolerances.memoryDecayScale;
      const decayCurrent = courseTolerances.memoryDecayScale;
      if (decayDraft !== decayCurrent) {
        changes.push({
          type: "config",
          key: "tolerances.memoryDecayScale",
          label: "Memory Decay Scale",
          oldValue: decayCurrent !== undefined ? fmt(decayCurrent) : "(1.0)",
          newValue: decayDraft !== undefined ? fmt(decayDraft) : "(1.0)",
          recompose: false,
          toleranceWritePath: "playbook-config",
          tolerancesConfigKey: "memoryDecayScale",
        });
      }
    } else if (scope === "learner") {
      // Per-learner mastery threshold override only. Cadence + decay are
      // course-only and intentionally not diffed here.
      if (draftLearnerMasteryOverride !== currentLearnerMasteryOverride) {
        changes.push({
          type: "target",
          key: "tolerances.masteryThreshold:learner",
          label: "Mastery Threshold (this learner)",
          oldValue:
            currentLearnerMasteryOverride !== undefined
              ? fmt(currentLearnerMasteryOverride)
              : "(course default)",
          newValue:
            draftLearnerMasteryOverride !== undefined
              ? fmt(draftLearnerMasteryOverride)
              : "(course default)",
          parameterId: "TOL-MASTERY-THRESHOLD",
          numericValue: draftLearnerMasteryOverride,
          recompose: true,
          toleranceWritePath: "behavior-target",
        });
      }
    }

    return changes;
  }, [
    draftTargets, draftStyle, draftAudience, draftMode,
    parameters, currentStyle, currentAudience, currentMode,
    scope,
    draftCourseTolerances, courseTolerances,
    draftLearnerMasteryOverride, currentLearnerMasteryOverride,
  ]);

  // --- Reset all drafts ---
  const handleDiscard = useCallback(() => {
    const map: Record<string, number> = {};
    for (const p of parameters) {
      map[p.parameterId] = p.effectiveValue;
    }
    setDraftTargets(map);
    setDraftStyle(currentStyle);
    setDraftAudience(currentAudience);
    setDraftMode(currentMode);
    setApplyError(null);
  }, [parameters, currentStyle, currentAudience, currentMode]);

  // --- Apply changes ---
  const handleApply = useCallback(async () => {
    if (!playbookId || !scope || pendingChanges.length === 0) return;
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);

    try {
      const targetChanges = pendingChanges.filter((c) => c.type === "target");
      const configChanges = pendingChanges.filter((c) => c.type === "config");

      // 1. Write target changes — route depends on scope
      if (targetChanges.length > 0) {
        const url =
          scope === "learner"
            ? `/api/callers/${callerId}/behavior-targets`
            : `/api/playbooks/${playbookId}/targets`;
        const payload = targetChanges.map((c) => ({
          parameterId: c.parameterId,
          targetValue: c.numericValue,
        }));
        // Defensive log — surfaces the exact (parameterId, targetValue) pairs
        // being submitted so future "0 instead of 0.30"-style discrepancies
        // can be traced from the browser console without instrumenting the API.
        console.log("[tuner] PATCH targets", url, JSON.stringify(payload));
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: payload }),
        });
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || "Failed to update targets");
        if (Array.isArray(result.rejected) && result.rejected.length > 0) {
          console.warn("[tuner] Server rejected parameters", result.rejected);
        }
      }

      // 2. Write config changes — playbook config is course-scoped only.
      //    Learner-scoped Approach overrides would need a caller-config concept
      //    which doesn't exist yet — block the save with a clear error.
      // #598 Slice 2 — split tolerance config changes from approach config
      // changes; tolerances land under `config.tolerances` as a merged sub-
      // object (the PATCH endpoint shallow-merges so we pre-merge here).
      const tolConfigChanges = configChanges.filter(
        (c) => c.toleranceWritePath === "playbook-config",
      );
      const approachConfigChanges = configChanges.filter(
        (c) => c.toleranceWritePath !== "playbook-config",
      );

      if (approachConfigChanges.length > 0 || tolConfigChanges.length > 0) {
        if (scope === "learner") {
          throw new Error(
            "Teaching Style / Audience / Mode and Tolerance settings can only be changed at the course level. " +
              "Switch scope to 'This course' to apply, or discard these changes.",
          );
        }
        const configUpdate: Record<string, unknown> = {};
        for (const c of approachConfigChanges) {
          if (c.configKey && c.configValue) {
            configUpdate[c.configKey] = c.configValue;
          }
        }
        if (tolConfigChanges.length > 0) {
          // Start from current tolerances so we don't clobber siblings.
          const tolerances: Record<string, number | undefined> = { ...courseTolerances };
          for (const c of tolConfigChanges) {
            if (!c.tolerancesConfigKey) continue;
            const draft =
              c.tolerancesConfigKey === "retrievalCadenceOverride"
                ? draftCourseTolerances.retrievalCadenceOverride
                : draftCourseTolerances.memoryDecayScale;
            if (draft === undefined) delete tolerances[c.tolerancesConfigKey];
            else tolerances[c.tolerancesConfigKey] = draft;
          }
          configUpdate.tolerances = tolerances;
        }
        console.log("[tuner] PATCH playbook config", configUpdate);
        const res = await fetch(`/api/playbooks/${playbookId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: configUpdate }),
        });
        const result = await res.json();
        if (!result.ok) throw new Error(result.error || "Failed to update config");

        // Lock in the new config as our local baseline so the pendingChanges
        // diff resolves and the PENDING list / Apply button can clear. The
        // parent's llmPrompt won't reflect this until the next composition
        // (which we deliberately don't auto-trigger any more).
        setAppliedConfig((prev) => ({
          ...prev,
          ...(typeof configUpdate.interactionPattern === "string"
            ? { style: configUpdate.interactionPattern }
            : {}),
          ...(typeof configUpdate.audience === "string"
            ? { audience: configUpdate.audience }
            : {}),
          ...(typeof configUpdate.teachingMode === "string"
            ? { mode: configUpdate.teachingMode }
            : {}),
        }));
      }

      // 3. #857 — push each change into the global PendingChangesTray.
      //
      //    Previously this branch auto-POSTed `/recompose-all` when any
      //    pending change carried `recompose: true` (mastery threshold).
      //    That silent fan-out is now opt-in via the tray's Toggle 2 —
      //    the safety property of epic #854. Cohort recompose happens
      //    only when the educator explicitly clicks Save & apply on the
      //    tray with Toggle 2 ON; per-caller recompose via Toggle 1.
      //
      //    Underlying writes (sections 1 and 2 above) still happen
      //    immediately at handleApply time. The tray entries serve as
      //    visualisation + the gate for the fan-out decision.
      for (const c of pendingChanges) {
        const trayKey = c.tolerancesConfigKey
          ? `tolerances.${c.tolerancesConfigKey}`
          : c.configKey ?? c.parameterId ?? c.key;
        // #911 — honest scope labels. Course scope reads "Course <name>";
        // learner scope reads "Learner <name>". Falls back to a truncated id
        // when the friendly name isn't threaded through yet.
        const trayScopeLabel =
          scope === "learner"
            ? `Learner ${callerName || (callerId ? callerId.slice(0, 8) : "this learner")}`
            : `Course ${playbookName || (playbookId ? playbookId.slice(0, 8) : "this course")}`;
        trayPush({
          key: trayKey,
          label: c.label,
          scopeLabel: trayScopeLabel,
          beforeValue: c.oldValue,
          afterValue: c.newValue,
          scope: "playbook",
          scopeId: playbookId,
          aiSuggested: false,
          // Mastery-threshold-class changes carried `recompose: true`
          // historically. The tray's A6 pre-check reads the `key` against
          // FANOUT_CLASS_PLAYBOOK_KEYS so the toggle defaults ON for
          // those — preserving the old expectation without bypassing
          // the educator's explicit click.
          fanoutScope: c.recompose ? "caller" : "none",
        });
      }
      setApplyResult(
        "Edit applied — recompose pending. Use the tray to recompose now or wait for the next call.",
      );

      // 4. Hard-reset every draft slice so the page-level PENDING CHANGES
      //    list drops to zero immediately on save success.
      //
      //    Previously this branch only filtered draftTargets against the
      //    refreshParameters() response, which left two failure modes:
      //
      //    (a) BEH params not present in /api/playbooks/<id>/targets
      //        → freshMap.get(pid) === undefined → the filter kept the
      //          draft entry alive forever, so PENDING CHANGES (N) and
      //          the purple "Apply to <name> only" button stayed visible
      //          even after a successful save.
      //    (b) refreshParameters() returning null (network blip, 5xx)
      //        → entire block skipped, drafts untouched.
      //    (c) Style/Audience/Mode/Tolerance drafts had no cleanup at
      //        all, so config changes never cleared until the user
      //        navigated away.
      //
      //    The save itself succeeded (we're past the writes above), so
      //    the user's mental model is "I clicked apply, it worked". The
      //    UI must agree.
      setDraftTargets({});
      setDraftStyle(currentStyle);
      setDraftAudience(currentAudience);
      setDraftMode(currentMode);
      setDraftCourseTolerances(courseTolerances);
      setDraftLearnerMasteryOverride(currentLearnerMasteryOverride);

      // 4a. Re-fetch in the background so `effectiveValue` etc. reflect
      // the newly-saved values on the next render. Not awaited — the
      // drafts are already cleared, so even if this fetch lags the user
      // can immediately drag a slider for a new change.
      void refreshParameters();

      // 4b. #598 Slice 2 — refresh tolerances + learner overrides so the diff
      // resolves after the save.
      void refreshCourseTolerances();
      if (callerId) {
        try {
          const r = await fetch(`/api/callers/${callerId}/behavior-targets`);
          const d = await r.json();
          if (d?.ok && Array.isArray(d.overrides)) setLearnerOverrides(d.overrides);
        } catch { /* non-fatal */ }
      }

      // 5. Notify parent
      onApplied(pendingChanges);
    } catch (err: any) {
      setApplyError(err.message || "Apply failed");
    } finally {
      setApplying(false);
    }
  }, [
    playbookId, playbookName, callerId, callerName, pendingChanges, onApplied, scope,
    refreshParameters, refreshCourseTolerances, courseTolerances, draftCourseTolerances,
    trayPush, currentStyle, currentAudience, currentMode,
    currentLearnerMasteryOverride,
  ]);

  // --- Toggle group collapse ---
  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const hasChanges = pendingChanges.length > 0;

  return (
    <div className={inline ? "ps-tuner-inline" : `ps-tuner-sidebar${open ? "" : " ps-tuner-sidebar--hidden"}`}>
      {/* Header */}
      <div className="ps-tuner-header">
        <div className="ps-tuner-header-text">
          <span className="ps-tuner-title">Prompt Tuner</span>
          <span className="ps-tuner-subtitle">
            {scope === null
              ? "Choose who these changes apply to"
              : scope === "course"
              ? `All learners${activeLearnerCount !== null ? ` (${activeLearnerCount})` : ""}`
              : callerName || "This learner"}
            {hasChanges && (
              <span className="ps-tuner-badge">{pendingChanges.length} change{pendingChanges.length !== 1 ? "s" : ""}</span>
            )}
          </span>
        </div>
        {!inline && (
          <button className="ps-tuner-close" onClick={onClose} aria-label="Close tuner">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="ps-tuner-body">
        {/* Step 1: Scope picker — always shown first, required before tuning */}
        <div className="ps-tuner-section ps-tuner-scope-section">
          <div className="ps-tuner-section-title">Apply changes to</div>
          <div className="ps-tuner-scope-cards">
            <button
              type="button"
              className={`ps-tuner-scope-card${scope === "course" ? " ps-tuner-scope-card--active" : ""}`}
              onClick={() => setScope("course")}
            >
              <span className="ps-tuner-scope-card-title">This course</span>
              <span className="ps-tuner-scope-card-desc">
                {activeLearnerCount !== null
                  ? `All ${activeLearnerCount} active learner${activeLearnerCount === 1 ? "" : "s"}`
                  : "All active learners"}
              </span>
            </button>
            <button
              type="button"
              className={`ps-tuner-scope-card${scope === "learner" ? " ps-tuner-scope-card--active" : ""}`}
              onClick={() => setScope("learner")}
            >
              <span className="ps-tuner-scope-card-title">{callerName || "This learner"}</span>
              <span className="ps-tuner-scope-card-desc">Only this learner</span>
            </button>
          </div>
        </div>

        {scope === null ? (
          <div className="ps-tuner-empty-scope">
            Pick a scope above to start tuning.
          </div>
        ) : (
          <>
        {/* Loading / Error */}
        {paramsLoading && (
          <div className="ps-tuner-loading">
            <span className="hf-spinner hf-spinner-sm" />
            Loading parameters...
          </div>
        )}
        {paramsError && (
          <div className="hf-banner hf-banner-error ps-tuner-error">{paramsError}</div>
        )}

        {/* Approach selectors (always shown first — most intuitive) */}
        <div className={`ps-tuner-section${approachLocked ? " ps-tuner-section--locked" : ""}`}>
          <div className="ps-tuner-section-title">
            Approach
            {approachLocked && (
              <span className="ps-tuner-locked-hint">Course-level only</span>
            )}
          </div>
          <div className="ps-tuner-selectors">
            <label className="ps-tuner-select-row">
              <span className="ps-tuner-select-label">Style</span>
              <select
                value={draftStyle}
                onChange={(e) => setDraftStyle(e.target.value)}
                disabled={approachLocked}
                className={`ps-tuner-select${draftStyle !== currentStyle ? " ps-tuner-select--changed" : ""}`}
              >
                {STYLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="ps-tuner-select-row">
              <span className="ps-tuner-select-label">Audience</span>
              <select
                value={draftAudience}
                onChange={(e) => setDraftAudience(e.target.value)}
                disabled={approachLocked}
                className={`ps-tuner-select${draftAudience !== currentAudience ? " ps-tuner-select--changed" : ""}`}
              >
                {AUDIENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="ps-tuner-select-row">
              <span className="ps-tuner-select-label">Mode</span>
              <select
                value={draftMode}
                onChange={(e) => setDraftMode(e.target.value)}
                disabled={approachLocked}
                className={`ps-tuner-select${draftMode !== currentMode ? " ps-tuner-select--changed" : ""}`}
              >
                {MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Data-driven behavior dials — graphic EQ layout, grouped by domainGroup */}
        <div className="ps-eq-groups">
        {!paramsLoading && grouped.map(({ group, params }) => {
          const isCollapsed = collapsedGroups.has(group);
          const groupChangedCount = params.filter((p) => {
            const draft = draftTargets[p.parameterId];
            return draft !== undefined && Math.abs(p.effectiveValue - draft) > 0.01;
          }).length;

          return (
            <div key={group} className="ps-eq-group">
              <button
                className="ps-eq-group-header"
                onClick={() => toggleGroup(group)}
              >
                <span className="ps-tuner-group-chevron">
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </span>
                <span className="ps-eq-group-title">{group.replace(/_/g, " ").replace(/-/g, " ")}</span>
                <span className="ps-tuner-group-count">{params.length}</span>
                {groupChangedCount > 0 && (
                  <span className="ps-tuner-group-changed">{groupChangedCount} changed</span>
                )}
              </button>

              {!isCollapsed && (
                <div className="ps-eq-grid">
                  {params.map((p) => {
                    const draft = draftTargets[p.parameterId] ?? p.effectiveValue;
                    const changed = Math.abs(p.effectiveValue - draft) > 0.01;
                    const displayName = p.name || humanise(p.parameterId);
                    const abbr = abbreviate(displayName);
                    const lowLabel = operatorOrBetter
                      ? (p.interpretationLow?.split(":")[0] || "Low")
                      : "Low";
                    const highLabel = operatorOrBetter
                      ? (p.interpretationHigh?.split(":")[0] || "High")
                      : "High";
                    const tooltipLines = [
                      displayName,
                      p.definition || "",
                      "",
                      operatorOrBetter && p.interpretationHigh ? `High: ${p.interpretationHigh}` : "",
                      operatorOrBetter && p.interpretationLow ? `Low: ${p.interpretationLow}` : "",
                    ].filter(Boolean).join("\n");

                    return (
                      <div
                        key={p.parameterId}
                        className={`ps-eq-channel${changed ? " ps-eq-channel--changed" : ""}`}
                        title={tooltipLines}
                      >
                        <span className="ps-eq-high-label">{highLabel}</span>
                        <div className="ps-eq-slider-wrap">
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={draft}
                            aria-label={displayName}
                            aria-valuetext={fmt(draft)}
                            onChange={(e) =>
                              setDraftTargets((prev) => ({
                                ...prev,
                                [p.parameterId]: parseFloat(e.target.value),
                              }))
                            }
                            className="ps-eq-slider"
                          />
                        </div>
                        <span className="ps-eq-low-label">{lowLabel}</span>
                        <span className="ps-eq-value">{fmt(draft)}</span>
                        <span className="ps-eq-abbr">{abbr}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        </div>{/* ps-eq-groups */}

        {/* Tolerances — Mastery Threshold only (split per #849 follow-up).
         *
         * Course-only knobs (Retrieval Cadence Override, Memory Decay Scale)
         * moved to Course Design → Tolerances. The per-learner Mastery
         * Threshold override stays here because that's where educators tune
         * an individual learner.
         *
         * Course scope writes BehaviorTarget(scope=PLAYBOOK, parameterId=
         * TOL-MASTERY-THRESHOLD) via /api/playbooks/[id]/targets.
         * Learner scope writes BehaviorTarget(scope=CALLER) via
         * /api/callers/[id]/behavior-targets (fans out across identities
         * per #836). Both bump composeInputsUpdatedAt via #830's helpers.
         */}
        <div className="ps-tuner-section">
          <div className="ps-tuner-section-title">Tolerances</div>

          <div className="ps-tuner-tolerance-row">
            <label className="ps-tuner-tolerance-label" htmlFor="tol-mastery">
              Mastery Threshold
              <span className="ps-tuner-tolerance-sublabel">
                {scope === "learner"
                  ? "Per-learner override; falls back to course default when cleared."
                  : "0–1. Higher = caller stays longer on each LO before mastery."}
              </span>
            </label>
            <div className="ps-tuner-tolerance-control">
              <input
                id="tol-mastery"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={
                  scope === "learner"
                    ? draftLearnerMasteryOverride ?? 0.7
                    : draftCourseTolerances.masteryThreshold ?? 0.7
                }
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (scope === "learner") setDraftLearnerMasteryOverride(v);
                  else setDraftCourseTolerances((p) => ({ ...p, masteryThreshold: v }));
                }}
                className="ps-eq-slider"
                data-testid={`tuner-tolerance-mastery-${scope ?? "none"}`}
              />
              <span className="ps-eq-value">
                {scope === "learner"
                  ? draftLearnerMasteryOverride !== undefined
                    ? fmt(draftLearnerMasteryOverride)
                    : "(course default)"
                  : draftCourseTolerances.masteryThreshold !== undefined
                    ? fmt(draftCourseTolerances.masteryThreshold)
                    : "(preset default)"}
              </span>
            </div>
          </div>

          <div className="hf-text-xs hf-text-muted hf-mt-sm">
            Course-wide retrieval cadence + memory decay live on the
            Course&nbsp;Design&nbsp;tab → Tolerances.
          </div>
        </div>

        {/* Pending changes */}
        {hasChanges && (
          <div className="ps-tuner-section">
            <div className="ps-tuner-section-title">
              Pending Changes ({pendingChanges.length})
            </div>
            <div className="ps-tuner-pending">
              {pendingChanges.map((c) => (
                <div key={c.key} className="ps-tuner-pending-item">
                  <span className="ps-tuner-pending-label">{c.label}</span>
                  <span className="ps-tuner-pending-values">
                    <span className="ps-tuner-pending-old">{c.oldValue}</span>
                    <span className="ps-tuner-pending-arrow">&rarr;</span>
                    <span className="ps-tuner-pending-new">{c.newValue}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback banners */}
        {applyError && (
          <div className="hf-banner hf-banner-error ps-tuner-error">
            {applyError}
          </div>
        )}
        {applyResult && !applyError && (
          <div className="hf-banner hf-banner-success ps-tuner-error">
            {applyResult}
          </div>
        )}
        {/* #710 — shadowing warning when PLAYBOOK-scope change targets a parameter
            this learner already has a per-learner override on. */}
        {scope === "course" && (() => {
          const shadowed = pendingChanges
            .filter((c) => c.type === "target" && c.parameterId)
            .map((c) => learnerOverrides.find((o) => o.parameterId === c.parameterId))
            .filter((o): o is NonNullable<typeof o> => o != null);
          if (shadowed.length === 0) return null;
          const manualCount = shadowed.filter((o) => o.origin === "MANUAL_OVERRIDE").length;
          const adaptedCount = shadowed.filter((o) => o.origin === "ADAPTED").length;
          const parts: string[] = [];
          if (manualCount > 0) parts.push(`${manualCount} manual override${manualCount === 1 ? "" : "s"}`);
          if (adaptedCount > 0) parts.push(`${adaptedCount} ADAPT result${adaptedCount === 1 ? "" : "s"}`);
          return (
            <div className="hf-banner hf-banner-warning ps-tuner-error">
              <strong>Will be shadowed for {callerName || "this learner"}.</strong>{" "}
              {parts.join(" and ")} on the same parameter{shadowed.length === 1 ? "" : "s"} ({shadowed.map((o) => o.parameterId).join(", ")}){" "}
              will keep winning over this PLAYBOOK change. Other learners on this course are unaffected — switch to learner scope if you want this to land for {callerName || "this learner"}.
            </div>
          );
        })()}
          </>
        )}
      </div>

      {/* Sticky footer */}
      <div className="ps-tuner-footer">
        {scope === null ? (
          <div className="ps-tuner-no-changes">
            Pick a scope to start tuning
          </div>
        ) : hasChanges ? (
          <>
            <button
              className="hf-btn hf-btn-primary ps-tuner-apply"
              onClick={handleApply}
              disabled={applying || !playbookId}
            >
              {applying ? (
                <>
                  <span className="hf-spinner hf-spinner-sm" />
                  Applying...
                </>
              ) : scope === "course" ? (
                `Apply to course${activeLearnerCount !== null ? ` (${activeLearnerCount} learner${activeLearnerCount === 1 ? "" : "s"})` : ""}`
              ) : (
                `Apply to ${callerName || "this learner"} only`
              )}
            </button>
            <button
              className="hf-btn hf-btn-secondary ps-tuner-discard"
              onClick={handleDiscard}
              disabled={applying}
            >
              <RotateCcw size={12} />
              Discard
            </button>
          </>
        ) : (
          <div className="ps-tuner-no-changes">
            Adjust dials or approach to see changes
          </div>
        )}
      </div>
    </div>
  );
}
