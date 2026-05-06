// Defensive shadow-root query helper.
//
// Custom-element callers often hit `this.shadowRoot.querySelector(...)`
// before Lit's first render has built the shadow tree — `set hass`,
// scroll-event handlers, ResizeObserver callbacks, and timer-driven
// updates can all fire in that window. Without a guard, every such
// site has to inline `this.shadowRoot && this.shadowRoot.querySelector`
// and the codebase ends up with 6+ copies of the same null-check.
//
// Usage:
//   import { safeQuery } from './utils/safe-query.js';
//   const card = safeQuery(this.shadowRoot, 'ha-card');
//   if (!card) return;
//
// Returns null if `root` is falsy or if the query finds nothing —
// callers must continue to check the result.
export function safeQuery<T extends Element = Element>(
  root: ParentNode | null | undefined,
  selector: string,
): T | null {
  return root ? root.querySelector<T>(selector) : null;
}
