/**
 * Shared focus guard for global keyboard handlers.
 *
 * Returns true when the keypress originated from an editable surface
 * (INPUT, TEXTAREA, or contenteditable element). Global shortcuts —
 * the `?` help overlay (#686) and the H/G chord engine (#688) — must
 * use this to avoid hijacking a user who is just typing text.
 *
 * Escape hatch: any element with `data-hf-allow-chord` overrides the
 * block (rare; used by surfaces that want global shortcuts even when
 * the user is technically focused inside them).
 */
export function isFocusBlocked(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target.dataset?.hfAllowChord !== undefined) return false;

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}
