# Nabu

Nabu is an agent skill that gets a GitHub repository ready for outside contributors, or audits
one that already is, against a single standard, whatever the project's language. It protects
the default branch, fixes how branches and titles are named, writes CONTRIBUTING.md, a short PR
template, issue forms and a contribution skill for AI agents, and makes versions and releases
automatic with release-please. A script does that work, not the agent's reading of a prompt.

## What every repository gets

- Branches `<type>/<1-5 lowercase words>` and Conventional Commit titles with the same type.
- One change per pull request, squash merge, one approval from anyone with write access.
- A PR format a maintainer can review fast: What, Why, How, Risk, Measurement (optional),
  Evidence, Checklist, each with a character limit.
- A `PR rules` check that enforces all of it, plus: changes to what users install must
  publish a version, visual changes need a screenshot, measured repositories need numbers,
  and website repositories close any PR that does not start from an issue.
- Versions nobody writes by hand: `feat` raises the minor number, `fix`/`perf`/`revert` the
  patch, `!` the major. Release builds for desktop and mobile, and npm publishing with
  trusted publishing, when the project needs them.
- GitHub settings: ruleset, squash-only merges, auto-merge, secret scanning and push
  protection, private vulnerability reporting, a warning before the release token expires.

## Install

In Claude Code:

```
/plugin install nabu --marketplace ilien-dev/nabu
```

Then run one of the plugin's commands, or just ask your agent ("get this repo ready for
contributors", "audit this repo against my standard"):

- `/nabu:setup [repo-dir]` sets up the repository (the current directory by default).
- `/nabu:audit [repo-dir]` lists every difference from the standard and fixes them once you
  agree.

Agents that read `.agents/skills` can use `skills/nabu/` directly.

## Commands

```
node skills/nabu/scripts/nabu.mjs detect       --repo <dir>   # what the repository has today
node skills/nabu/scripts/nabu.mjs init         --repo <dir> --answers answers.json
node skills/nabu/scripts/nabu.mjs render       --repo <dir> [--check] [--remove-obsolete]
node skills/nabu/scripts/nabu.mjs verify       --repo <dir>   # self-tests of the result
node skills/nabu/scripts/nabu.mjs scan-secrets --repo <dir>   # before going public
node skills/nabu/scripts/nabu.mjs github       --repo <dir> [--dry-run] [--public]
node skills/nabu/scripts/nabu.mjs audit        --repo <dir>   # every difference from the standard
```

`skills/nabu/SKILL.md` is the order an agent follows; `skills/nabu/references/` explains the answers file, the PR
format and versioning by release kind (Claude Code plugin, npm, desktop, mobile, library).

## Requirements

Node 18 or later, `git`, and `gh` signed in with admin rights on the repository.

## Tests

```
node tests/run.mjs
```
