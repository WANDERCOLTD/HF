/**
 * Designer-shell section renderer registry.
 *
 * Single source of truth for "given a `ComposeSectionKey`, which React
 * component renders its Inspector panel?". S4 ships the registry empty;
 * the follow-on epic (Renderers v2 — `docs/draft-issues/followon-designer-renderers-v2.md`)
 * populates it.
 *
 * Type-safety contract:
 *
 *   - `registerPreviewRenderer<S>(section, renderer)` constrains `section`
 *     to `ComposeSectionKey`. Passing a typo / removed key is a TS compile
 *     error (the union narrows it).
 *   - Each renderer's `data` shape is its own concern; the registry stores
 *     the renderer type-erased and the caller widens at lookup time. We
 *     trade a small amount of dynamic type narrowing for the ability to
 *     register renderers from anywhere without a giant central type map.
 *
 * Acceptance criteria for S4 (#1559):
 *   - Registry empty at story-close → `getPreviewRenderer(any)` returns null
 *   - Type-safe registration → wrong-section is a compile error
 *   - No runtime behaviour change in the existing Preview today
 */

import type { ComponentType } from "react";

import type { ComposeSectionKey } from "@/lib/compose";

import type { DesignerSelection } from "./useDesignerSelection";

/**
 * Renderer-side prop shape. `TData` is the section-specific data
 * envelope (defined where the renderer lives — usually the same module
 * that hosts the renderer component).
 */
export interface PreviewRendererProps<TData = unknown> {
  data: TData;
  selection: DesignerSelection;
}

export type PreviewRenderer<TData = unknown> = ComponentType<
  PreviewRendererProps<TData>
>;

/**
 * Internal store. Type-erased — each entry's `TData` is whatever the
 * registering site declared. Keys are `ComposeSectionKey`, so getter
 * lookups are safe; setter is generic-constrained so registration is
 * type-checked at the call site.
 */
const PREVIEW_RENDERERS: Partial<Record<ComposeSectionKey, PreviewRenderer>> =
  {};

/**
 * Register a renderer for a section. The generic constraint enforces
 * that `section` is a real `ComposeSectionKey` — typos / removed keys
 * fail at compile time.
 *
 * The renderer type is intentionally widened to the unknown-data form
 * for storage; callers should pass their own renderer typed with its
 * specific data shape, and the type system will preserve that at the
 * call site even though the registry holds an erased form.
 */
export function registerPreviewRenderer<S extends ComposeSectionKey, TData>(
  section: S,
  renderer: PreviewRenderer<TData>,
): void {
  // The cast bridges the per-renderer TData to the registry's unknown
  // form. Type-safety is preserved at the use site (`getPreviewRenderer`
  // returns the unknown-typed form; the caller widens via its own type
  // assertion or runtime guard).
  PREVIEW_RENDERERS[section] = renderer as PreviewRenderer;
}

/**
 * Look up the renderer for a section. Returns `null` when no renderer
 * has been registered.
 *
 * S4 ships with the registry empty, so this always returns null today.
 * Follow-on epic populates the map; existing Preview behaviour stays
 * intact (the Inspector slot just won't mount renderer content yet).
 */
export function getPreviewRenderer(
  section: ComposeSectionKey,
): PreviewRenderer | null {
  return PREVIEW_RENDERERS[section] ?? null;
}

/**
 * Test-only — reset the registry between tests so a renderer registered
 * in one test doesn't leak into the next. Not exported from the barrel.
 */
export function __resetPreviewRenderersForTesting(): void {
  for (const key of Object.keys(PREVIEW_RENDERERS) as ComposeSectionKey[]) {
    delete PREVIEW_RENDERERS[key];
  }
}
