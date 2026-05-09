// Shared render helper for editor section headings (v1.10.2 #92).
// Each section's `<h3 class="section">` is wrapped with this helper so
// the reset-to-defaults icon button appears uniformly across all 7
// sections. Click → editor._resetSection(sectionKey) → SECTION_KEYS
// lookup → delete keys from config → DEFAULTS take over.

import { html, type TemplateResult } from 'lit';
import type { EditorLike } from './types.js';

interface SectionHeaderArgs {
  editor: EditorLike;
  title: string;
  sectionKey: string;
  resetLabel: string;
}

export function renderSectionHeader(args: SectionHeaderArgs): TemplateResult {
  const { editor, title, sectionKey, resetLabel } = args;
  return html`
    <h3 class="section section-header-with-reset">
      <span class="section-title">${title}</span>
      <ha-icon-button
        class="section-reset"
        title="${resetLabel}"
        aria-label="${resetLabel}"
        @click=${() => editor._resetSection(sectionKey)}
      >
        <ha-icon icon="mdi:restore"></ha-icon>
      </ha-icon-button>
    </h3>
  `;
}
