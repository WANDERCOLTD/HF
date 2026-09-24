"use client";

/**
 * CueCardRowEditor — inline expand-to-edit row in the Content tab cue-card list.
 *
 * Closes S6 of the EOD #2185 handoff. Wires the CueCardType admin-UI consumer
 * (per `.claude/rules/bdd-typed-unions-coverage.md`) and lets operators tune a
 * single cue card without leaving the Content tab.
 *
 * Storage: `Playbook.config.modules[i].settings.cueCardPool`. The contract
 * `moduleCueCardPool` (#1701 / G8) addresses the slot via `arrayKey: "id"` +
 * runtime `arraySelector`. Save dispatches a single PATCH to
 * `/api/courses/[courseId]/journey-setting` with the FULL updated pool —
 * mirrors `JourneyArrayEditor`'s pattern in the Inspector.
 *
 * Why the full pool, not a row-scoped writer: per
 * `.claude/rules/lattice-survey.md`, the existing journey-setting PATCH route
 * IS the chokepoint. Hand-rolling a row-scoped writer would create sibling-
 * writer drift with `JourneyArrayEditor`.
 *
 * Internal-only `type` tag: `CueCardType` ("personal" / "abstract") is
 * internal — drives compose-side prep-phase scaffold, never leaks to the
 * learner. The select label here is operator-facing per
 * `.claude/rules/learner-ui-leak-coverage.md`.
 */

import { useState, useCallback, useEffect } from "react";

import {
  CUE_CARD_TYPE_VALUES,
  type CueCardType,
} from "@/lib/types/json-fields";

import type { CueCardItem } from "./types";

/**
 * Local type guard against the canonical `CUE_CARD_TYPE_VALUES` SET — mirrors
 * the wizard-enum-coverage pattern (`.claude/rules/wizard-enum-coverage.md`)
 * but stays inline here because this editor is NOT a chat-tool merge path.
 * The select's `<option>` set is also pinned to `CUE_CARD_TYPE_VALUES` so
 * an invalid value can't reach the change handler in normal flow.
 */
function isCueCardType(value: string): value is CueCardType {
  return (CUE_CARD_TYPE_VALUES as readonly string[]).includes(value);
}

/**
 * Per-type author-facing helper copy.
 *
 * The branch on the canonical literals (`=== "personal"` / `=== "abstract"`)
 * is intentionally explicit — the `.claude/rules/bdd-typed-unions-coverage.md`
 * Coverage gate scans for this exact shape in adminUI source to count this
 * editor as the consumer for the `CueCardType.<value>.adminUI` cells.
 */
function helperForType(value: CueCardType | ""): string {
  if (value === "personal") {
    return "Anchor on lived experience — the learner draws from memories. Bullets should prompt for specific people, places, and moments.";
  }
  if (value === "abstract") {
    return "Anchor on a conceptual framing — the learner explores ideas, not lived experience. Bullets should prompt for hypotheticals, principles, or speculation.";
  }
  return "Pick personal (lived experience) or abstract (conceptual framing) to surface the prep-phase scaffold guidance.";
}

export interface CueCardRowEditorProps {
  /** Course (Playbook) id — used to build the PATCH URL. */
  courseId: string;
  /** The row being edited. */
  item: CueCardItem;
  /**
   * The full current pool for this row's module. Required because the PATCH
   * route accepts the full array; the editor splices the edited row back
   * before dispatch.
   */
  poolForModule: CueCardItem[];
  /** Called after a successful save with the new pool — parent reloads. */
  onSaved?: (newPool: Array<{ topic: string; bullets: string[]; type?: CueCardType }>) => void;
  /** Override the fetch implementation (testing). */
  fetchImpl?: typeof fetch;
}

interface DraftState {
  topic: string;
  bullets: string[];
  type: CueCardType | "";
}

function toDraft(item: CueCardItem): DraftState {
  return {
    topic: item.topic,
    bullets: item.bullets.length > 0 ? [...item.bullets] : [""],
    type: item.type ?? "",
  };
}

/**
 * Inline expand-to-edit row.
 *
 * Collapsed: renders the row summary identical to the read-only cue-card row.
 * Expanded: renders a type select + topic input + bullet-array editor + Save.
 */
export function CueCardRowEditor({
  courseId,
  item,
  poolForModule,
  onSaved,
  fetchImpl,
}: CueCardRowEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<DraftState>(() => toDraft(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft when the underlying row changes (e.g. parent reload after
  // a sibling row was saved).
  useEffect(() => {
    setDraft(toDraft(item));
  }, [item]);

  const setTopic = useCallback((v: string) => {
    setDraft((d) => ({ ...d, topic: v }));
  }, []);

  const setType = useCallback((v: string) => {
    if (v === "" || isCueCardType(v)) {
      setDraft((d) => ({ ...d, type: v as CueCardType | "" }));
    }
  }, []);

  const setBullet = useCallback((idx: number, v: string) => {
    setDraft((d) => {
      const next = [...d.bullets];
      next[idx] = v;
      return { ...d, bullets: next };
    });
  }, []);

  const addBullet = useCallback(() => {
    setDraft((d) => ({ ...d, bullets: [...d.bullets, ""] }));
  }, []);

  const removeBullet = useCallback((idx: number) => {
    setDraft((d) => {
      const next = d.bullets.filter((_, i) => i !== idx);
      return { ...d, bullets: next.length === 0 ? [""] : next };
    });
  }, []);

  const moveBullet = useCallback((idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      const next = [...d.bullets];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return d;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return { ...d, bullets: next };
    });
  }, []);

  const onSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Build the next pool by splicing the edited row in at its index.
      const nextRow: { topic: string; bullets: string[]; type?: CueCardType } = {
        topic: draft.topic,
        bullets: draft.bullets.filter((b) => b.trim().length > 0),
      };
      if (draft.type !== "") {
        nextRow.type = draft.type;
      }
      const nextPool = poolForModule.map((row, i) =>
        i === item.index
          ? nextRow
          : {
              topic: row.topic,
              bullets: row.bullets,
              ...(row.type ? { type: row.type } : {}),
            },
      );

      const doFetch = fetchImpl ?? fetch;
      const res = await doFetch(
        `/api/courses/${encodeURIComponent(courseId)}/journey-setting`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            settingId: "moduleCueCardPool",
            value: nextPool,
            arraySelector: item.module.moduleId,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Save failed (HTTP ${res.status})`);
      }
      onSaved?.(nextPool);
      setExpanded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [courseId, draft, item, poolForModule, onSaved, fetchImpl]);

  const onCancel = useCallback(() => {
    setDraft(toDraft(item));
    setError(null);
    setExpanded(false);
  }, [item]);

  if (!expanded) {
    return (
      <li
        className="hf-card hf-card-compact hf-content-row"
        data-testid={`hf-content-cue-${item.id}`}
      >
        <div className="hf-content-row-main">
          <div className="hf-content-row-headline">
            <p className="hf-content-row-title">{item.topic}</p>
            {item.type ? (
              <span
                className="hf-content-prov-chip"
                data-testid={`hf-content-cue-type-chip-${item.id}`}
              >
                <span className="hf-content-prov-label">Type</span>
                <span className="hf-content-prov-value">{item.type}</span>
              </span>
            ) : null}
          </div>
          {item.bullets.length > 0 ? (
            <ul className="hf-content-bullets">
              {item.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}
          <div className="hf-content-row-meta">
            <span
              className="hf-content-prov-chip"
              data-testid="hf-content-prov-module"
            >
              <span className="hf-content-prov-label">Module</span>
              <span className="hf-content-prov-value">
                {item.module.moduleLabel}
              </span>
            </span>
          </div>
          <div className="hf-content-row-actions">
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              onClick={() => setExpanded(true)}
              data-testid={`hf-content-cue-edit-${item.id}`}
            >
              Edit
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      className="hf-card hf-card-compact hf-content-row hf-content-row-editing"
      data-testid={`hf-content-cue-${item.id}`}
    >
      <div className="hf-content-row-main">
        <div className="hf-content-edit-grid">
          <label className="hf-label" htmlFor={`hf-cue-type-${item.id}`}>
            Type
            <span className="hf-content-edit-hint">
              Internal scaffold tag — drives Part 2 prep-phase prompt; learner
              never sees this label.
            </span>
          </label>
          <select
            id={`hf-cue-type-${item.id}`}
            className="hf-input"
            value={draft.type}
            onChange={(e) => setType(e.target.value)}
            data-testid={`hf-content-cue-type-select-${item.id}`}
          >
            <option value="">— Unspecified —</option>
            {CUE_CARD_TYPE_VALUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <p
            className="hf-content-edit-hint"
            data-testid={`hf-content-cue-type-help-${item.id}`}
          >
            {helperForType(draft.type)}
          </p>

          <label className="hf-label" htmlFor={`hf-cue-topic-${item.id}`}>
            Topic
            <span className="hf-content-edit-hint">
              The cue card framing the learner sees, e.g. &ldquo;Describe a
              memorable holiday&rdquo;.
            </span>
          </label>
          <input
            id={`hf-cue-topic-${item.id}`}
            type="text"
            className="hf-input"
            value={draft.topic}
            onChange={(e) => setTopic(e.target.value)}
            data-testid={`hf-content-cue-topic-${item.id}`}
          />

          <label className="hf-label">
            Bullets
            <span className="hf-content-edit-hint">
              Talking points the learner can lean on during the monologue.
              Use the arrows to reorder.
            </span>
          </label>
          <div className="hf-content-bullets-edit">
            {draft.bullets.map((b, i) => (
              <div
                key={i}
                className="hf-content-bullet-row"
                data-testid={`hf-content-cue-bullet-row-${item.id}-${i}`}
              >
                <input
                  type="text"
                  className="hf-input"
                  value={b}
                  onChange={(e) => setBullet(i, e.target.value)}
                  placeholder="Bullet…"
                  data-testid={`hf-content-cue-bullet-${item.id}-${i}`}
                />
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary"
                  onClick={() => moveBullet(i, -1)}
                  disabled={i === 0}
                  aria-label="Move bullet up"
                  data-testid={`hf-content-cue-bullet-up-${item.id}-${i}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary"
                  onClick={() => moveBullet(i, 1)}
                  disabled={i === draft.bullets.length - 1}
                  aria-label="Move bullet down"
                  data-testid={`hf-content-cue-bullet-down-${item.id}-${i}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary"
                  onClick={() => removeBullet(i)}
                  aria-label="Remove bullet"
                  data-testid={`hf-content-cue-bullet-remove-${item.id}-${i}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="hf-btn hf-btn-secondary"
              onClick={addBullet}
              data-testid={`hf-content-cue-bullet-add-${item.id}`}
            >
              + Add bullet
            </button>
          </div>
        </div>

        {error ? (
          <div
            className="hf-banner hf-banner-error"
            data-testid={`hf-content-cue-error-${item.id}`}
          >
            {error}
          </div>
        ) : null}

        <div className="hf-content-row-actions">
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={onSave}
            disabled={saving}
            data-testid={`hf-content-cue-save-${item.id}`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={onCancel}
            disabled={saving}
            data-testid={`hf-content-cue-cancel-${item.id}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </li>
  );
}
