# Documentation style guide

Conventions for writing or extending docs in this repo. The goal is to keep the
docs **scannable, current, and TL;DR-resistant** — every addition must earn its place.

→ Back to [README](../README.md)

## File naming

| Pattern | Used for | Examples |
| --- | --- | --- |
| `ALL-CAPS.md` at repo root | Top-level meta-docs | `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `MIGRATION.md`, `TESTING.md`, `LICENSE.md` |
| `ALL-CAPS.md` in `docs/` | User reference docs | `docs/CONFIGURATION.md`, `docs/CONDITIONS.md`, `docs/SENSORS.md`, `docs/TROUBLESHOOTING.md` |
| Lowercase | Special-purpose | `info.md` (HACS install dialog), `README.md` (GitHub) |

## Header pattern

Every doc starts with the same three-block header:

```markdown
# Title

[1–2 descriptive sentences: what this covers, who it's for.]

→ Back to [README](../README.md)
```

The "Back to README" link is the navigation anchor — never skip it.

## Voice by doc-type

Pick the voice that matches the reader's mode:

| Doc-type | Voice | Examples in this repo |
| --- | --- | --- |
| **Procedural** (do-this-then-that) | Imperative, direct: *"Run X. Open Y. Set Z."* | `CONTRIBUTING.md`, `TESTING.md`, `MIGRATION.md` |
| **Reference** (lookup) | Tables + concise prose. Cold neutral tone. | `docs/CONFIGURATION.md`, `docs/CONDITIONS.md` |
| **Explainer** (concept) | Prose with code-path traces, *why*-focused. | `ARCHITECTURE.md` |
| **Q&A** (problem/solution) | Question-as-heading + direct answer. | `docs/TROUBLESHOOTING.md` |

All English, casual but precise. No filler ("simply", "just", "very") — these are
fluff that adds words without information.

## Tables vs. prose

- Use a **table** when items have ≥ 3 attributes (config keys: name + type + default + desc).
- Use **prose** when explaining *why* something exists or *how* it interacts with other parts.
- Don't sprawl: ≤ 5 columns per table; wrap descriptions inside cells.

## Code-block conventions

Always tag the language:

```yaml
forecast:
  show_sunshine: true
```

```bash
npm run build
```

```ts
import { lightenColor } from '../format-utils.js';
```

Never use bare ` ``` `. The tag drives syntax highlighting on GitHub.

## Cross-linking

| From | To | Pattern |
| --- | --- | --- |
| Within same doc | Section | `[Section name](#section-anchor)` (auto-generated) |
| README | `docs/X.md` | `[docs/X.md](docs/X.md)` |
| `docs/X.md` | `docs/Y.md` | `[X → Y](Y.md#y-anchor)` |
| `docs/X.md` | README | `→ Back to [README](../README.md)` (top of file) |
| Any doc | Issues / PRs | Full GitHub URL, e.g. `https://github.com/chriguschneider/weather-station-card/issues/15` |

Never use absolute URLs to files in this repo — relative paths survive forks.

## Length targets (the TL;DR enforcement)

These limits exist to prevent doc-bloat:

| File | Max lines | Why |
| --- | --- | --- |
| `README.md` | 300 | First impression. Anything more = users skim, miss the pitch |
| `docs/*.md` | 250 | Reference docs benefit from depth, but past 250 lines you stop scanning |
| `info.md` | 50 | HACS dialog has a narrow column — long descriptions wrap badly |

If a single section approaches ~150 lines, **split it** into a new doc rather
than extending the existing one. See "When to split" below.

## When to add a new doc vs. extend an existing one

| You're documenting… | Goes in… |
| --- | --- |
| Config keys / their effect | `docs/CONFIGURATION.md` |
| Single FAQ entry | `docs/TROUBLESHOOTING.md` |
| Sensor wiring recipe | `docs/SENSORS.md` |
| Classifier rule / threshold | `docs/CONDITIONS.md` |
| Migration footnote | `MIGRATION.md` |
| Architecture nuance | `ARCHITECTURE.md` |
| Build / test / release how-to | `CONTRIBUTING.md` / `TESTING.md` |
| Topic with its own audience and reference value beyond a single use case | **New file in `docs/`** |

When in doubt: extend, don't fragment.

## The TL;DR principle

The central rule: **every section must answer "what does the reader gain?"**

Decision algorithm before adding any new content:

1. Can I link to existing content instead of repeating? → **Link.**
2. Does the addition replace something redundant? → Add it, remove the redundancy.
3. Does it pass the cold-read test (a new reader skims the doc and the addition stands on its own)? → Add.
4. None of the above? → **Don't add.**

When asked to expand: ask "what becomes shorter?"

## Anchor naming

GitHub auto-generates anchors from headings: lowercase, spaces → hyphens, special
chars stripped. So `## A. Setup` becomes `#a-setup`.

Add a manual `<a id="..."></a>` only when:

- The same heading appears twice in a doc (anchors collide).
- A short, stable, externally-linkable anchor matters more than the heading text.

When manual: kebab-case, prefixed with the file context (`config-setup`, not bare
`setup`). Example pattern: `docs/CONFIGURATION.md` uses `#config-setup` etc.

## Versioning notes

Add `(since vX.Y)` inline after a key — only when:

- The key was added in **v1.0 or later**, AND
- A HACS user pinned to an older version might wonder why their YAML isn't recognised.

Don't retroactively annotate every key — it's noise. Removed keys live in
`MIGRATION.md`, not the reference.

Example:

```markdown
| `forecast.type` | `'daily' \| 'hourly' \| 'today'` | `'daily'` | … The `'today'` mode (since v1.4) renders a 24-hour window centred on "now". |
```

## Image conventions

| Type | Format | Source | Example |
| --- | --- | --- | --- |
| **Screenshots** of the rendered card | PNG via e2e baseline | `tests-e2e/snapshots/render-modes.spec.ts/*.png` | `daily-combination-sunshine.png` |
| Screenshots of the editor or non-rendered UI | PNG, hand-made | `images/` | `images/editor.png` |
| Diagrams, logo | SVG | `images/` | `images/logo.svg` |
| Animated hero (≤ 2 MB) | GIF | `images/` | (none currently) |

Prefer e2e snapshots over hand-made PNGs for any rendered-card screenshot —
they're auto-regenerated on every `update-baselines.yml` run, so the README
stays current without manual upkeep.

For light/dark adaptive rendering on GitHub:

```html
<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="tests-e2e/snapshots/render-modes.spec.ts/X-dark.png" />
  <img alt="Description" src="tests-e2e/snapshots/render-modes.spec.ts/X.png" />
</picture>
```

All images carry meaningful `alt` text.

## CHANGELOG format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and SemVer. Header:

```markdown
## [X.Y.Z] — YYYY-MM-DD

[1-line release theme]

### Added
- ...
### Changed
- ...
### Fixed
- ...
### Removed
- ...
### Deprecated
- ...
### Deferred to vX.Y+1
- ...
```

Reference issues / PRs as `(#123)` or full URL on first mention.

## Migration entries

For each breaking change in `MIGRATION.md`:

```markdown
### `oldKey` → `newKey` (since vX.Y)

**Why**: [the constraint or motivation]

**Before**:
```yaml
oldKey: foo
```

**After**:
```yaml
newKey: bar
```
```

Always include *why* — the next person reading MIGRATION.md is figuring out
whether to roll forward or pin; they need the reasoning, not just the syntax.
