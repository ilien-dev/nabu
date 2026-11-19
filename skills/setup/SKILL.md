---
name: setup
description: Sets up a GitHub repository for outside contributors with the Nabu standard. Run as /nabu:setup [repo-dir].
argument-hint: "[repo-dir]"
disable-model-invocation: true
---

# Nabu setup

Read `../nabu/SKILL.md` (relative to this skill's directory) and follow its steps 1 to 7 for
the repository at `$ARGUMENTS`, or the current directory if empty. Its `scripts/nabu.mjs` is
the `O` it refers to.

If `detect` finds `.github/repo-rules.json`, the repository is already set up: say so and
offer `/nabu:audit` instead of setting it up again.
