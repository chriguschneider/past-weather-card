// Editor render partial — Section 7: "Aktionen" (Actions).
// Tap / hold / double-tap action selectors. Always visible.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';

export function renderTapSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg } = ctx;
  return html`
    <h3 class="section">${t('actions_section_heading')}</h3>
    <div class="textfield-container">
      ${[
        ['tap_action', 'tap_action_label'],
        ['hold_action', 'hold_action_label'],
        ['double_tap_action', 'double_tap_action_label'],
      ].map(([key, labelKey]) => html`
        <ha-selector
          .hass=${editor.hass}
          .selector=${{ ui_action: {} }}
          .value=${cfg[key]}
          .label=${t(labelKey)}
          @value-changed=${(e: CustomEvent<{ value: unknown }>) => editor._actionChanged(key, e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `;
}
