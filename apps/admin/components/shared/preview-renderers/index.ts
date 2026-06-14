/**
 * Preview renderers barrel — Epic #1606.
 *
 * Each module imported here calls `registerPreviewRenderer()` at module
 * load. Import this barrel once from the surface that mounts
 * `DesignerShell` so registrations fire before the Inspector tries to
 * look up a renderer.
 */

export { FirstCallModeRenderer } from "./FirstCallModeRenderer";
export type { FirstCallModeRendererData } from "./FirstCallModeRenderer";
