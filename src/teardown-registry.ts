// Lifecycle-cleanup registry. The card has a handful of resources that
// must be released on `disconnectedCallback`: event listeners, timers,
// subscriptions, observers. Before this module each one was guarded
// by its own `if (this._fooTeardown) { ... }` block, so adding a new
// resource meant adding a new field, a new null-guard, AND remembering
// to call it in disconnectedCallback. The registry replaces that with
// a single push-on-setup / drain-on-disconnect pattern:
//
//   import { TeardownRegistry } from './teardown-registry.js';
//
//   constructor() {
//     super();
//     this._teardown = new TeardownRegistry();
//   }
//
//   firstUpdated() {
//     const observer = new ResizeObserver(...);
//     observer.observe(this);
//     this._teardown.add(() => observer.disconnect());
//   }
//
//   disconnectedCallback() {
//     super.disconnectedCallback();
//     this._teardown.drain();
//   }
//
// The registry is also useful inside extracted modules: an E1
// `setupScrollUx(card)` can push its own listener cleanups, so the
// card's disconnectedCallback no longer needs to know about the
// module's internal listener inventory.
//
// drain() runs every registered fn in registration order and swallows
// per-fn errors (logged to the console) so a single bad teardown
// can't strand the rest. After drain the registry is empty and reusable.

/** A teardown callback — invoked once on drain. May throw; errors are
 *  logged and swallowed so one bad teardown doesn't strand the rest. */
export type TeardownFn = () => void;

export class TeardownRegistry {
  private _fns: TeardownFn[] = [];

  /** Register a teardown function. Non-function inputs are silently
   *  ignored — callers can pass `subscription.unsubscribe` even when
   *  some sources don't return one, without an `if (typeof…)` guard. */
  add(fn: unknown): unknown {
    if (typeof fn === 'function') this._fns.push(fn as TeardownFn);
    return fn;
  }

  /** Run and clear every registered fn. Safe to call multiple times;
   *  the second call is a no-op. */
  drain(): void {
    const fns = this._fns;
    this._fns = [];
    for (const fn of fns) {
      try {
        fn();
      } catch (err) {
        console.error('[teardown-registry]', err);
      }
    }
  }

  /** Number of currently registered teardown functions. Tests use this
   *  to assert that a setup path actually registered something. */
  get size(): number {
    return this._fns.length;
  }
}
