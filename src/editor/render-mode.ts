// Editor render partial — Section 1: "Was zeigt die Karte?"
// Title input + mode radio (Station / Forecast / Combination).
// Always visible regardless of mode.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';

export function renderModeSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, mode } = ctx;
  return html`
    <h3 class="section">${t('mode_question_heading')}</h3>
    <div class="textfield-container">
      <ha-textfield
        label="${t('title')}"
        .value="${cfg.title || ''}"
        @change="${(e: Event) => editor._valueChanged(e as unknown as { target: { value: string } }, 'title')}"
      ></ha-textfield>

      <div class="radio-group">
        <span style="margin-right:8px;font-weight:500;">${t('mode_label')}:</span>
        ${(['station', 'forecast', 'combination'] as const).map((value) => html`
          <div class="radio-item">
            <ha-radio
              name="ws-mode"
              .value=${value}
              .checked=${mode === value}
              @change=${() => editor._setMode(value)}
            ></ha-radio>
            <label>${t(`mode_${value}`)}</label>
          </div>
        `)}
      </div>
    </div>
  `;
}
