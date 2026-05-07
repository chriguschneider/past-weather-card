// Whole-card action handler: pointer-based tap / hold / double-tap
// detection on the ha-card root, plus the HA-action dispatcher that
// it fires.
//
// Lifted out of main.js in v1.1 — previously these were two methods
// (_setupActionHandler, _runAction) with intertwined comments that
// drifted next to scroll-ux during earlier refactors. Coupling to the
// card instance: card.shadowRoot (cursor + listener attach), card.config
// (action map + cursor decision), card._hass (callService),
// card._fire (event dispatch), card._dragMoved (read — drag-to-scroll
// suppresses the trailing tap/hold), card._actionHandlerTeardown
// (mutated for the disconnectedCallback path).
//
// Why pointer events vs. plain click: we need hold detection (fires
// before pointerup) and a way to suppress the trailing tap. A 250 ms
// tap delay is required to disambiguate single from double — that's
// the same window HA's own action-handler uses.
//
// Why we don't import HA's frontend handle-action: the import path
// has changed names across HA versions; doing the dispatch ourselves
// keeps the card portable.

import { safeQuery } from './utils/safe-query.js';

const HOLD_MS = 500;
const DBL_MS = 250;

/** A single configured user action. Mirrors HA's `ui_action` selector
 *  output — every shape the editor can produce, plus a few legacy
 *  aliases (`service` for `perform_action`, `service_data` for `data`)
 *  that older YAML may carry. */
export interface ActionConfig {
  action?: 'none' | 'more-info' | 'navigate' | 'url' | 'toggle'
    | 'perform-action' | 'call-service' | 'assist' | 'fire-dom-event'
    | string;
  entity?: string;
  navigation_path?: string;
  navigation_replace?: boolean;
  url_path?: string;
  perform_action?: string;
  service?: string;
  data?: Record<string, unknown>;
  service_data?: Record<string, unknown>;
  target?: { entity_id?: string | string[]; device_id?: string | string[]; area_id?: string | string[] };
  [k: string]: unknown;
}

/** Subset of HA's `HomeAssistant` we touch: just `callService`. The
 *  full type lives in custom-card-helpers — keeping it loose here
 *  avoids a cross-cutting dependency at this layer. */
interface HassLike {
  callService(domain: string, service: string, data?: Record<string, unknown>, target?: ActionConfig['target']): unknown;
}

/** Subset of the card the handler reads/writes. */
export interface ActionHandlerCard {
  shadowRoot: ShadowRoot | null;
  config: {
    tap_action?: ActionConfig;
    hold_action?: ActionConfig;
    double_tap_action?: ActionConfig;
    sensors?: { temperature?: string };
    [k: string]: unknown;
  } | null;
  _hass: HassLike | null;
  _dragMoved: boolean;
  _actionHandlerTeardown: (() => void) | null;
  _fire(eventName: string, detail: unknown): void;
}

interface BoundHaCard extends HTMLElement {
  _wsActionHandlerBound?: boolean;
}

// Pointer events that originate on a card-internal control button
// (mode-toggle, jump-to-now, scroll indicators) are part of that
// control's own gesture — they must NOT trigger the card-level
// tap/hold/double-tap action.
function isCardControl(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as Element;
  return typeof el.closest === 'function'
    && el.closest('button, ha-icon-button, [role="button"]') !== null;
}

export function setupActionHandler(card: ActionHandlerCard): void {
  const haCard = safeQuery<BoundHaCard>(card.shadowRoot, 'ha-card');
  if (!haCard) return;

  // Cursor reflects "is anything wired" — refresh on every call so
  // toggling tap_action in the editor flips the hand cursor on/off
  // immediately, not only on first render.
  const cfg0 = card.config || ({});
  const isLive = (a: ActionConfig | undefined): boolean => !!(a?.action && a.action !== 'none');
  haCard.style.cursor = (isLive(cfg0.tap_action) || isLive(cfg0.hold_action) || isLive(cfg0.double_tap_action))
    ? 'pointer' : '';

  if (haCard._wsActionHandlerBound) return;
  haCard._wsActionHandlerBound = true;

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdFired = false;
  let lastTapAt = 0;
  let pendingTap: ReturnType<typeof setTimeout> | null = null;

  const fire = (kind: 'tap' | 'hold' | 'double_tap'): void => {
    const cfg = card.config || ({});
    const map: Record<typeof kind, ActionConfig | undefined> = {
      tap: cfg.tap_action,
      hold: cfg.hold_action,
      double_tap: cfg.double_tap_action,
    };
    runAction(card, map[kind]);
  };

  const clearHold = (): void => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  };

  const onPointerDown = (ev: PointerEvent): void => {
    if (isCardControl(ev.target)) return;
    holdFired = false;
    clearHold();
    holdTimer = setTimeout(() => {
      // If the user has been dragging the chart to scroll, the hold
      // is part of that gesture — don't fire a hold_action for it.
      if (card._dragMoved) return;
      holdFired = true;
      fire('hold');
    }, HOLD_MS);
  };

  const onPointerUp = (ev: PointerEvent): void => {
    if (isCardControl(ev.target)) return;
    clearHold();
    if (holdFired) return;
    // Drag-to-scroll consumed this gesture; suppress the trailing tap.
    // _dragMoved is reset on the next macrotask by the scroll-ux drag
    // handler, so a fresh gesture immediately afterwards still detects
    // normally.
    if (card._dragMoved) return;
    const now = Date.now();
    if (now - lastTapAt < DBL_MS) {
      // Second tap inside the double-tap window — cancel the queued
      // single tap and fire double_tap instead.
      lastTapAt = 0;
      if (pendingTap) { clearTimeout(pendingTap); pendingTap = null; }
      fire('double_tap');
      return;
    }
    lastTapAt = now;
    pendingTap = setTimeout(() => {
      pendingTap = null;
      fire('tap');
    }, DBL_MS);
  };

  const onPointerCancel = (): void => {
    clearHold();
    holdFired = false;
  };

  haCard.addEventListener('pointerdown', onPointerDown);
  haCard.addEventListener('pointerup', onPointerUp);
  haCard.addEventListener('pointercancel', onPointerCancel);
  haCard.addEventListener('pointerleave', onPointerCancel);

  card._actionHandlerTeardown = () => {
    haCard.removeEventListener('pointerdown', onPointerDown);
    haCard.removeEventListener('pointerup', onPointerUp);
    haCard.removeEventListener('pointercancel', onPointerCancel);
    haCard.removeEventListener('pointerleave', onPointerCancel);
    clearHold();
    if (pendingTap) clearTimeout(pendingTap);
    haCard._wsActionHandlerBound = false;
  };
}

/** Dispatches a configured action via the HA frontend's standard
 *  event / service contract. Mirrors the surface the editor exposes
 *  through ha-selector ui_action: more-info, navigate, url, toggle,
 *  perform-action (a.k.a. call-service), assist, fire-dom-event.
 *  'none' / unconfigured actions are no-ops.
 *
 *  Exported so unit tests can exercise each branch without rigging up
 *  pointer-event timing; the runtime path is via the fire() closure
 *  inside `setupActionHandler` above. */
export function runAction(card: ActionHandlerCard, actionConfig: ActionConfig | undefined): void {
  if (!actionConfig?.action || actionConfig.action === 'none') return;
  const hass = card._hass;
  const fallbackEntity = (card.config?.sensors?.temperature) || '';
  const action = actionConfig.action;

  if (action === 'more-info') {
    const entityId = actionConfig.entity || fallbackEntity;
    if (entityId) card._fire('hass-more-info', { entityId });
    return;
  }
  if (action === 'navigate') {
    if (!actionConfig.navigation_path) return;
    window.history.pushState(null, '', actionConfig.navigation_path);
    // HA listens for `location-changed` on window to drive the router;
    // bubbles:true so it reaches the panel regardless of who fired it.
    const ev = new Event('location-changed', { bubbles: true, composed: true, cancelable: false }) as Event & { detail?: unknown };
    ev.detail = { replace: actionConfig.navigation_replace === true };
    window.dispatchEvent(ev);
    return;
  }
  if (action === 'url') {
    if (!actionConfig.url_path) return;
    window.open(actionConfig.url_path);
    return;
  }
  if (action === 'toggle') {
    const entityId = actionConfig.entity || fallbackEntity;
    if (!entityId || !hass) return;
    const domain = entityId.split('.')[0];
    hass.callService(domain, 'toggle', { entity_id: entityId });
    return;
  }
  if (action === 'perform-action' || action === 'call-service') {
    // HA renamed `service` → `perform_action` in 2024.8; keep both for
    // backwards compatibility with older YAML.
    const svc = actionConfig.perform_action || actionConfig.service;
    if (!svc || !hass) return;
    const dot = svc.indexOf('.');
    if (dot < 0) return;
    const domain = svc.slice(0, dot);
    const service = svc.slice(dot + 1);
    const data = actionConfig.data || actionConfig.service_data || {};
    const target = actionConfig.target;
    hass.callService(domain, service, data, target);
    return;
  }
  if (action === 'assist') {
    card._fire('hass-action-assist', actionConfig);
    return;
  }
  if (action === 'fire-dom-event') {
    card._fire('ll-custom', actionConfig);
    
  }
}
