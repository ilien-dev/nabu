# Contributing to Nabu

Thanks for wanting to help. A contribution does not have to be a pull request: a clear issue
that reports a bug or proposes an improvement is a contribution too.

Nabu gets a GitHub repository ready for outside contributors, or audits one, against a single standard checked by scripts. **A contribution that drifts away from that purpose will be rejected**,
however well it is made.

<!-- This file is generated from .github/repo-rules.json by Nabu (https://github.com/ilien-dev/nabu).
     Project-specific notes go in .github/contributing-notes.md, which is copied below. -->

## Nothing is guaranteed

Opening an issue or a pull request does not guarantee that it will be accepted or merged.
Every change is reviewed before it goes in, the maintainer's own included. A change can be
declined for its scope, its approach or the cost of maintaining it.

## Before you start

- **Search first.** Look through the [pull requests](https://github.com/ilien-dev/nabu/pulls?q=is%3Apr)
  and the [issues](https://github.com/ilien-dev/nabu/issues?q=is%3Aissue), open and closed. If someone
  already works on it, or it was declined, add to that conversation instead.
- **For anything bigger than a small fix, open an issue first** and wait for an answer. It is the
  cheapest way to find out whether the change fits before you write it.

## Issues

Use the forms: **Bug report** or **Feature request**. One issue per problem or idea. A bug report
says what you did, what you expected and what happened; a feature request says the problem
first and the solution after. Never paste tokens, keys or private data.

## One change per pull request

Each pull request does **one thing**. A new feature comes alone: no settings change, no visual
tweak elsewhere, no unrelated cleanup. Those go in their own pull requests. The smaller and more
focused a PR is, the faster it can be reviewed and merged; a PR that mixes changes will be asked
to split, or closed.

## Branch name

```
<type>/<1 to 5 words>
```

`<type>` is the Conventional Commit type of the change, the same one the title starts with:
`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style` or `revert`. Then 1 to 5 words of lowercase letters and digits joined by single
hyphens.

- `feat/export-cover-image` ✓
- `fix/progress-bar-width` ✓
- `feat/Export-Cover` ✗ (uppercase)
- `feature/export-cover-image` ✗ (the type is `feat`)
- `fix/add-a-new-progress-bar-width` ✗ (more than 5 words)

## Title and versions

The title is a [Conventional Commit](https://www.conventionalcommits.org/) of at most
72 characters, with the same type as the branch: `feat: export the cover image`. Pull
requests are squash-merged, so the title becomes the commit on `main`, and it decides
the next version:

| Title | Version |
|---|---|
| `feat: ...` | new minor version (1.4.0 → 1.5.0) |
| `fix: ...`, `perf: ...`, `revert: ...` | new patch version (1.4.0 → 1.4.1) |
| `feat!: ...` or any type with `!` | new major version (1.4.0 → 2.0.0) |
| `docs`, `test`, `ci`, `chore`, `refactor`, `build`, `style` | no new version |

**Nobody writes a version number.** A workflow publishes the version, the changelog and the
release after every merge. Do not edit version numbers or `CHANGELOG.md`.
A change to what users install (`skills/**` and `.claude-plugin/**`) has to publish a version, or they never get it:
its title must be `feat`, `fix`, `perf` or `revert`. The check rejects any other type for those files.

## Description

Start from the template GitHub fills in
([`.github/pull_request_template.md`](.github/pull_request_template.md)). It is short on purpose:
it holds what a reviewer needs to decide quickly, and nothing else.

| Section | Limit | What goes in it |
|---|---|---|
| **What** | 280 characters | The one change this PR makes. |
| **Why** | 280 characters | The problem it solves. Link the issue (`Closes #12`). |
| **How** | 500 characters | The approach, and the main files it touches. |
| **Risk** | 200 characters | What could break, and how to undo it. |
| **Evidence** | 300 characters of text | How you checked it, how a reviewer can check it; screenshots. |
| **Checklist** | — | Every box ticked. |

**Screenshots** are always welcome, one or as many as it takes to make the change easy to
understand, and required for a visual change: before and after. Take them yourself
or ask your agent to; capture only that window or page, never the whole screen. Drag the files
into the description box on GitHub. Images, GIFs and links do not count toward the limit.

A check verifies the branch, the title and the description. Run it before opening the PR:

```
node .github/scripts/check-pr.cjs --branch feat/export-cover-image \
  --title "feat: export the cover image" --body-file pr.md --files-from-git main
```

## Before you push

```
node tests/run.mjs
```

Every command must pass; CI runs them again on the pull request.

## Review

A pull request is merged after an approval from someone with write access to the repository and
with every check green. A new push dismisses an earlier approval. Answer review comments in the
PR; keep extra changes for another PR.

## Working with an AI agent

The rules are the same. Agents that read `.claude/skills` or `.agents/skills` have an
`uncontributing` skill that walks through them step by step and checks the result.

## Project notes

## Notes for this repository

- Tests and evals never reach real GitHub: `gh` goes through `tests/gh-stub.mjs` (`NABU_GH_STUB`, `NABU_GH_LOG`), and fixtures use remotes of an owner that does not exist.
- `skills/nabu/scripts/nabu.mjs` runs on Node 18+ with no dependencies.
- `skills/nabu/assets/` is the standard itself: every repository gets a change there on its next `render`. Fix a gap there, never by patching a managed file in one repository.
- `skills/nabu/assets/github/scripts/check-pr.cjs` stays CommonJS so it runs in repositories with `"type": "module"`.
- In templates `{{name}}` is a Nabu variable and `${{ ... }}` is GitHub's; variable names never contain spaces.

