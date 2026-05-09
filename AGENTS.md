# AGENTS.md

Conventions for AI-assisted contributions to this repo. Read this if
you're a contributor using Claude Code, Cursor, Codex, Aider, or any
other AI assistant on a fork or a branch — or if you're an AI assistant
yourself reading the repo for the first time.

Everything in [`CONTRIBUTING.md`](CONTRIBUTING.md) still applies. This
file only covers the conventions that genuinely differ for AI-assisted
work.

## Commit attribution

Commits made with AI assistance should carry a `Co-Authored-By:` trailer
that names the tool and model honestly:

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Co-Authored-By: Cursor <noreply@cursor.sh>
Co-Authored-By: Codex <noreply@openai.com>
```

The exact string isn't load-bearing — what matters is that git history
reflects the tool that did the typing. The maintainer's local
trailer is documented in their per-machine `CLAUDE.md` and is not the
canonical form for contributors.

## Comment discipline

Inline comments earn their place by explaining the *why* — a hidden
constraint, a subtle invariant, a workaround. Don't restate code.

```ts
// Bad — restates what the next line obviously does.
// Increment the counter
counter += 1;

// Good — encodes a non-obvious reason.
// HA emits an extra forecast tick at midnight UTC; drop it so the
// chart doesn't grow a phantom column.
counter += 1;
```

Multi-paragraph docstrings on small functions and "why we removed X"
breadcrumbs both add noise. The PR description is the place for
context that doesn't survive the diff.

## Architectural decisions

If your change introduces a new architectural pattern, breaks a
module boundary, swaps a build/quality gate, or deviates from an
existing ADR, it likely needs an ADR of its own. Triggers and the
template live in [`docs/adr/README.md`](docs/adr/README.md). Land the
ADR alongside the code, not after.

Claude Code users in this clone get an automatic prompt for ADR
candidates via the `documentation` skill (see below). Other tools
won't fire that prompt — read `docs/adr/README.md` directly.

## Repo-local skills

Two Claude Code skills are checked into `.claude/skills/`:

- **`commit-guardian`** — runs before any `git commit` and checks the
  staged diff against accepted ADRs and the conventions in
  `CONTRIBUTING.md` / `ARCHITECTURE.md` / `docs/STYLE-GUIDE.md`.
  Findings are reported as a numbered list; the user decides whether
  to proceed.
- **`documentation`** — proactively suggests ADRs when an
  architectural change happens, and flags code changes that contradict
  an existing decision.

These auto-load for Claude Code users in this clone. Other AI tools
(Cursor, Codex, Aider) don't load them — read the `SKILL.md` files
directly to pick up the conventions they enforce.

## Parallel work

When multiple agents (or one agent + a human) might be in the repo at
the same time, two cheap habits avoid collisions:

- **Branch naming**: `<tool-or-initials>/<issue>-<slug>`, e.g.
  `claude/127-parallel-workflow-research`, `cursor/45-fix-scroll`. Makes
  authorship visible in `git branch --remotes` without a team agreement.
- **Issue claiming**: `gh issue edit <N> --add-assignee @me` before
  starting work on an open issue, so other contributors see it's
  taken.

For local working trees, `git worktree add ../wsc-<issue> <branch>`
gives each agent its own `dist/` and `node_modules` and avoids
clobbering across parallel branches. Optional — single-agent flows
don't need it.

## Draft PRs

CI runs the full pipeline (lint + audit + typecheck + tests +
coverage + depcheck + bundle + e2e + visual regression) on every
push, ~6 minutes per run. If you're iterating with several pushes
per branch, **open the PR as a draft** until you expect CI to pass,
then mark ready. The maintainer-facing notification noise (and the
GHA cost) is otherwise multiplied by your iteration count.

## Resolving `dist/` conflicts on rebase

When master advances during your branch's life, you may hit a merge
conflict in `dist/weather-station-card.js`. **Don't hand-merge the
minified bundle.** Take either side, then:

```bash
npm run build
git add dist/weather-station-card.js
git rebase --continue
```

The `verify dist matches HEAD` step in CI would catch a hand-merged
bundle anyway, so re-running the bundler is the only path that holds.
This is a documented consequence of [ADR-0001 (dist committed for
HACS)](docs/adr/0001-dist-committed-for-hacs.md), kept out of an
ADR amendment because the underlying decision still stands.

## Testing UI changes

For changes that need eyeballing against a real Home Assistant
instance, use the Docker recipe in [`LOCAL-TESTING.md`](LOCAL-TESTING.md).
Visual baselines under `tests-e2e/snapshots/` are regenerated only by
the [`update-baselines.yml`](.github/workflows/update-baselines.yml)
workflow on the GHA runner — never commit baselines from a local
Playwright run, the rendering tolerance won't match (see
[ADR-0003](docs/adr/0003-e2e-baselines-pinned-to-gha.md)).
