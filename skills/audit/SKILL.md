---
name: audit
description: Audits a GitHub repository against the Nabu standard and lists every difference. Run as /nabu:audit [repo-dir].
argument-hint: "[repo-dir]"
disable-model-invocation: true
---

# Nabu audit

Read `../nabu/SKILL.md` (relative to this skill's directory) and follow its "Audit mode" for
the repository at `$ARGUMENTS`, or the current directory if empty. Its `scripts/nabu.mjs` is
the `O` it refers to.

Report the differences first. Change files or GitHub settings only after the user agrees, on a
`ci/` branch and one PR as that section says. If the repository has no rules and no older
setup either, say it was never set up and offer `/nabu:setup`.
