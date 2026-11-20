---
name: nabu
description: Sets up a GitHub repository to be open source and ready for outside contributors, or audits one that already is, against one fixed standard - protected default branch, <type>/ branch names, Conventional Commit titles, CONTRIBUTING.md, a short PR format, an agent contribution skill, automatic versioning and releases with release-please, optional measured-change rule, issue-first rule for website repos. Use whenever the user wants to open-source a project, "prepare this repo for collaborators", protect main, add contribution rules or a PR template, automate versions or releases, or check that a repo follows their collaboration standard, for any language (Claude Code plugin, npm package, desktop or mobile app, library).
---

# Nabu

One standard for every repository, whatever its language. `scripts/nabu.mjs` (Node 18+, no
dependencies, needs `git` and `gh`) owns everything that can be decided by rules: it writes the
files from fixed templates, applies the GitHub settings, scans for secrets and tests that the
result works. Your part is the few facts that only the project can give (step 2) and the
judgement calls the script hands back. Never write a managed file by hand: change
`.github/repo-rules.json` or the template, then `render` again, so every repository stays
identical.

`O` below means `node <this-skill-dir>/scripts/nabu.mjs --repo <repo>`.

## What the standard fixes (the same everywhere)

- Branch `<type>/<1-5 lowercase words>`; title `<type>: <summary>` (Conventional Commit, at most
  72 characters), same type in both. Types: feat, fix, perf, refactor, docs, test, build, ci,
  chore, style, revert.
- One change per pull request; squash merge only; one approval from anyone with write access;
  a new push dismisses it; the last pusher cannot approve their own push.
- PR format: What, Why, How, Risk, (Measurement), Evidence, Checklist, each with a limit
  (`references/pr-format.md` explains why each one is there).
- Versions: nobody writes one. release-please opens and merges the release PR on every push to
  the default branch; the Release is a draft until every build, npm and `finish` job succeeds,
  then it is published as latest. `feat` → minor, `fix`/`perf`/`revert` → patch, `!` → major, other types
  release nothing. A PR that touches files users install (`shipped`) must use a releasing type.
- The `PR rules` check (`check-pr.cjs`) runs on `pull_request_target` from the default
  branch, so forks are checked without approval and a PR cannot change the rules it is judged by.

## Steps

### 1. Look before asking

Run `O detect`. It reports the GitHub repo, default branch, visibility, version files, CI job
names, submodules, leftovers of older setups (cog.toml, branch-name.yml...) and the latest
release and tag. If `.github/repo-rules.json` already exists, this is an **audit**: go to
"Audit mode".

### 2. Ask only what the project decides

Fill an answers file (shape in `references/answers.md`) from what you read: README for the
purpose, CI and scripts for the commands, `detect` for versions. Then ask the user, in one
message, only what you could not infer, and always these three:

1. **Measured changes?** For AI tools and anything that promises users a measurable result
   (accuracy, speed, ranking), changes to what users get must carry numbers before and after.
   Purely visual or content projects usually say no. If yes, ask or propose how to measure here
   (evals, benchmarks, test that fails before and passes after).
2. **Release kind**: claude-plugin, npm, desktop, mobile, library (version and GitHub Release
   only) or none. Then read the matching section of `references/versioning.md`.
3. **Is this a website kept as a submodule of a main project?** Those repos get `issueFirst`:
   a PR without `Closes #N` to an open issue is closed automatically.

Also confirm `shipped` (paths that reach users). If there is no LICENSE, ask which one; never choose for the user.

### 3. Write the rules and the files

```
O init --answers <answers.json>
O render --remove-obsolete
O verify
```

`verify` runs the check against valid and invalid sample PRs built from the rules, matches the
ruleset's required checks to workflow job names (matrix names included), and checks every
version file carries the version. Fix what it lists. A `generic` version file needs the
`x-release-please-version` comment on the version line: add it in the source (and run the
project's own sync step if it copies files).

Then, by hand (they are the project's own files):
- `CLAUDE.md` and `AGENTS.md` get one line: `CONTRIBUTING.md` - branches, PR format and limits;
  load the `uncontributing` skill before a branch, commit, issue or PR. Keep them identical.
- Project-specific contribution notes go in `.github/contributing-notes.md`; `render` copies it
  into CONTRIBUTING.md. Never edit CONTRIBUTING.md directly.
- Run the project's tests: the version annotations must not break anything.

### 4. Before the repository goes public

```
O scan-secrets
```

It scans every commit of every branch for tokens, keys and secret-looking files and records the
result for the current HEAD; `github --public` refuses without a clean scan. A finding is either
a real secret (stop: the history must be cleaned and the secret rotated, which is the user's
call) or a false positive you explain to the user. Making a repository public cannot be undone
in practice: get the user's explicit yes first.

### 5. One pull request for the setup

Commit everything on a `ci/<words>` branch (the setup is `ci`: it releases nothing) and open
the PR with the new template filled in. The new `PR rules` check cannot run on this PR (it runs
the default branch's copy), so the user merges it as admin. Say so.

### 6. GitHub settings, after the merge

```
O github --dry-run          # show every call first
O github [--public]
```

It sets squash-only merges, auto-merge, branch deletion, update-branch, private vulnerability
reporting, secret scanning and push protection (public only), fork PR approval only for
brand-new GitHub accounts, the `accepted` label for issue-first repos, and the ruleset. It
refuses the ruleset while the standard `pr-rules.yml` is not on the default branch, or while a
required CI check has never been reported by GitHub (rename `ci.requiredChecks` to the exact
names of a real run). Run it again after the setup PR is merged; it only changes what differs.

What only the user can do, hand over with exact steps:
- **RELEASE_TOKEN**: a fine-grained token of a repository admin, this repository only, Contents
  and Pull requests read and write, saved with `gh secret set RELEASE_TOKEN -R <repo>`.
  `token-check.yml` opens an issue 30 days before it expires.
- **npm**: trusted publisher on npmjs.com for this repository and `release.yml` (once).
- **Signing keys** for desktop or mobile builds, saved as the secrets named in `buildSecrets`.

### 7. Report

List what `github` did, what is pending for the user, and the commands they can rerun. End with
`O audit` showing zero differences, or the ones that remain and why.

## Audit mode

For a repository that already has rules, or one set up by an older process:

```
O audit
```

Every line is a difference from the standard: managed files that are missing, differ or are
obsolete; CLAUDE.md/AGENTS.md pointers; GitHub settings; rulesets; RELEASE_TOKEN. Fix files with
`render --remove-obsolete` on a `ci/` branch and one PR, then `github` after the merge. A repo
set up before the standard has no `repo-rules.json`: run `detect`, write the answers from its
current CONTRIBUTING.md (keep its purpose, commands and measuring methods), and move anything
project-specific into `.github/contributing-notes.md`. Older release tooling (Cocogitto, deploy
keys) is replaced by release-please: after the merge, delete the deploy key and its secret with
the user's agreement.

A main repository with a website submodule: audit the main repository and the website
repository separately; only the website gets `issueFirst`.

## When something does not fit

If a project needs something the standard does not do, do not patch the managed files in that
repository. Tell the user what is missing; the fix belongs in this skill's templates so every
repository gets it.
