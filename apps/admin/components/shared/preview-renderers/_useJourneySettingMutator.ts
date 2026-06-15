"use client";

/**
 * _useJourneySettingMutator — shared hook for all 11 PREVIEW_RENDERERS
 * that need to write a journey setting back through the PATCH route.
 *
 * Underscore-prefix marks this as renderer-internal — not part of the
 * `preview-renderers/index.ts` barrel. External callers should mount
 * `<JourneyField>` directly.
 *
 * Each renderer calls this once per mount:
 *
 *   const onSave = useJourneySettingMutator(courseId);
 *   return <JourneyField contract={c} value={v} onSave={(next) => onSave(c.id, next)} />;
 */

import { useCallback } from "react";

export interface MutatorError extends Error {
  code?: string;
  status?: number;
}

export function useJourneySettingMutator(
  courseId: string | null,
): (settingId: string, value: unknown) => Promise<void> {
  return useCallback(
    async (settingId: string, value: unknown) => {
      if (!courseId) {
        throw new Error("useJourneySettingMutator: courseId is required");
      }
      const res = await fetch(`/api/courses/${courseId}/journey-setting`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settingId, value }),
      });
      if (!res.ok) {
        type ErrBody = { ok?: boolean; error?: string; code?: string };
        let body: ErrBody | null = null;
        try {
          body = (await res.json()) as ErrBody;
        } catch {
          body = null;
        }
        const err: MutatorError = new Error(body?.error ?? `HTTP ${res.status}`);
        err.code = body?.code;
        err.status = res.status;
        throw err;
      }
    },
    [courseId],
  );
}
