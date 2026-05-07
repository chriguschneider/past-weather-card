// Editor render partial — Section B: Sensors.
//
// Per-metric sensor field list. Most filter by `device_class`; wind
// direction has no canonical class but a stable unit (degrees) so it
// gets a runtime predicate. UV index has neither a class nor a universal
// unit and gets a name/id pattern match. Each entry's `key` is the
// YAML key under `sensors:` and doubles as the i18n key (see locale.js
// `editor` blocks).
//
// We use a single ha-form with the schema below rather than explicit
// ha-entity-pickers — going through ha-form ensures ha-entity-picker
// is registered through the selector pipeline (direct use renders
// blank in some HA builds).

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, HomeAssistant } from './types.js';

interface SensorState {
  state: string;
  attributes?: {
    device_class?: string;
    unit_of_measurement?: string;
    friendly_name?: string;
  };
}

interface HassWithStates extends HomeAssistant {
  states?: Record<string, SensorState | undefined>;
}

function buildSensorFields(hass: HassWithStates | null): Array<{ key: string; candidates: string[] }> {
  const all: Array<[string, SensorState]> = hass?.states
    ? (Object.entries(hass.states).filter(([, s]) => !!s) as Array<[string, SensorState]>)
    : [];
  const byDeviceClass = (classes: string[]): string[] => all
    .filter(([id, s]) => id.startsWith('sensor.') &&
      classes.includes((s.attributes?.device_class) || ''))
    .map(([id]) => id);

  const directionEntities = all
    .filter(([id, s]) => id.startsWith('sensor.') &&
      ((s.attributes?.unit_of_measurement) === '°' ||
       (s.attributes?.unit_of_measurement) === 'deg'))
    .map(([id]) => id);

  const uvRegex = /(?:^|[._-])uv(?:[._-]|index|$)/i;
  const uvNameRegex = /\buv[\s_-]?index\b|\buv\b/i;
  const uvEntities = all
    .filter(([id, s]) => {
      if (!id.startsWith('sensor.')) return false;
      const name = (s.attributes?.friendly_name) || '';
      return uvRegex.test(id) || uvNameRegex.test(name);
    })
    .map(([id]) => id);

  return [
    { key: 'temperature',         candidates: byDeviceClass(['temperature']) },
    { key: 'humidity',            candidates: byDeviceClass(['humidity']) },
    { key: 'illuminance',         candidates: byDeviceClass(['illuminance']) },
    { key: 'precipitation',       candidates: byDeviceClass(['precipitation']) },
    { key: 'pressure',            candidates: byDeviceClass(['atmospheric_pressure', 'pressure']) },
    { key: 'wind_speed',          candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'gust_speed',          candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'wind_direction',      candidates: directionEntities },
    { key: 'uv_index',            candidates: uvEntities },
    { key: 'dew_point',           candidates: byDeviceClass(['temperature']) },
    { key: 'sunshine_duration',   candidates: [] },
  ];
}

export function buildSensorsSchema(hass: HassWithStates | null): Array<{ name: string; selector: object }> {
  return buildSensorFields(hass).map((f) => ({
    name: f.key,
    selector: {
      entity: f.candidates.length > 0
        ? { include_entities: f.candidates }
        : { domain: 'sensor' },
    },
  }));
}

export function renderSensorsSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, sensorsConfig } = ctx;
  return html`
    <!-- ─── B. Sensors ──────────────────────────────────────────── -->
    <!-- No heading: ha-form renders each picker with its label as a
         Material floating label inside the field, so the section is
         self-explanatory. -->
    <div class="textfield-container" style="margin-top:24px;">
      <ha-form
        .data=${sensorsConfig}
        .schema=${buildSensorsSchema(editor.hass)}
        .hass=${editor.hass}
        .computeLabel=${(s: { name: string }) => t(s.name)}
        @value-changed=${editor._sensorsChanged}
      ></ha-form>
    </div>
  `;
}
