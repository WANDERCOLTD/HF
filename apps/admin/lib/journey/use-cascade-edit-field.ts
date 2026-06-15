/**
 * useCascadeEditField — canonical hook for the inline cascade-aware edit
 * pattern, codifying `VoiceConfigSection`'s autosave loop.
 *
 *   1. Caller provides: `contract` (JourneySettingContract), `value`
 *      (current effective value), `cascadeSource` (origin layer),
 *      `onSave(newValue) → Promise<void>`.
 *   2. Hook returns: `draftValue`, `setDraftValue`, `isDirty`,
 *      `isSaving`, `commit()`, `reset()`, `glow`.
 *   3. Toggles / selects / radios should call `commit()` immediately on
 *      change. Text / number / textarea should call `commit()` on blur
 *      OR after the auto-debounce (default 600ms).
 *   4. On commit error: draft stays, isDirty stays true, caller
 *      surfaces the error. The glow auto-removes (failure path).
 *   5. When the upstream `value` prop changes (e.g. websocket update
 *      or cascade re-resolved), the hook resets the draft IF the user
 *      is not dirty. If dirty, the new server value is ignored until
 *      `reset()` is called explicitly.
 *
 * Sister hook: `useGlowState` (this hook composes it).
 *
 * Phase 1 ships this; Phase 2 wires it into every Inspector renderer.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { JourneySettingContract } from "./setting-contracts";
import { useGlowState, type UseGlowStateResult } from "./use-glow-state";

const DEFAULT_DEBOUNCE_MS = 600;

export interface UseCascadeEditFieldOptions<T> {
  /** The contract entry. */
  contract: JourneySettingContract;
  /** Current effective value (post-cascade). */
  value: T;
  /** Save handler — typically a debounced PATCH route call. */
  onSave: (next: T) => Promise<void>;
  /** Debounce ms for blur/auto save. Default 600. */
  debounceMs?: number;
}

export interface UseCascadeEditFieldResult<T> {
  /** Current draft (uncommitted) value. */
  draftValue: T;
  /** Update the draft without saving. */
  setDraftValue: (next: T) => void;
  /** True when draft !== upstream value. */
  isDirty: boolean;
  /** True while a save is in flight. */
  isSaving: boolean;
  /** Commit the current draft. */
  commit: () => Promise<void>;
  /** Commit the current draft after `debounceMs` (cancel pending). */
  commitDebounced: () => void;
  /** Drop the draft and reset to upstream value. */
  reset: () => void;
  /** Glow handle for the inline save-flash. */
  glow: UseGlowStateResult;
}

export function useCascadeEditField<T>(
  options: UseCascadeEditFieldOptions<T>,
): UseCascadeEditFieldResult<T> {
  const { value, onSave, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const [draft, setDraft] = useState<T>(value);
  const [isSaving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const upstreamRef = useRef(value);
  const glow = useGlowState();

  const isDirty = !objectEqual(draft, value);

  // Upstream changed and user isn't dirty → adopt new value.
  useEffect(() => {
    const prevUpstream = upstreamRef.current;
    if (objectEqual(prevUpstream, value)) return;
    const userWasDirty = !objectEqual(draftRef.current, prevUpstream);
    upstreamRef.current = value;
    if (userWasDirty) {
      // dirty — leave the user's draft alone
      return;
    }
    setDraft(value);
  }, [value]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const commit = useCallback(async () => {
    const current = draftRef.current;
    if (objectEqual(current, upstreamRef.current)) return;
    setSaving(true);
    try {
      await glow.run(onSave(current));
    } finally {
      setSaving(false);
    }
  }, [glow, onSave]);

  const commitDebounced = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void commit();
    }, debounceMs);
  }, [commit, debounceMs]);

  const reset = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDraft(upstreamRef.current);
  }, []);

  return {
    draftValue: draft,
    setDraftValue: setDraft,
    isDirty,
    isSaving,
    commit,
    commitDebounced,
    reset,
    glow,
  };
}

/** Cheap structural equality. Handles primitives, arrays, plain objects.
 *  Sufficient for setting values; not a deep clone helper. */
function objectEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (
      !objectEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false;
    }
  }
  return true;
}
